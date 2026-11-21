# 07 · 可直接复制的代码配方

> 与 `assets/scaffold/` 保持同一套契约。片段中的 `...` 表示省略的注释/日志。所有片段默认 TypeScript + ESM。

## 1. 入口：求值顺序（最关键）

```ts
// src/main.ts —— 唯一入口，禁止静态 import three
import { bootstrap } from './platform/bootstrap.js';

// 小游戏启动时部分 wx 配置尚未就绪，延后一拍再 bootstrap（社区实测）
function defer(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  } else {
    setTimeout(fn, 50);
  }
}

setTimeout(() => defer(() => {
  void bootstrap().catch((error: unknown) => console.error('[game] bootstrap failed', error));
}), 0);
```

```ts
// src/platform/bootstrap.ts —— 唯一 import 适配层运行时代码的文件
import { createWeChatGameRuntime } from 'mini-three-adapter/wechat-game';
import type { MiniThreeRuntime } from 'mini-three-adapter';
import { RUNTIME_OPTIONS } from '../config/constants.js';

export async function bootstrap(): Promise<MiniThreeRuntime> {
  const runtime = await createWeChatGameRuntime(RUNTIME_OPTIONS);
  // 能力报告，必须保留：webgl2Source = probe / inferred / override
  console.log(runtime.report());
  runtime.on('error', (e) => console.error('[runtime]', e));

  // ★ three 及所有场景代码在此之后才求值
  const { GameApp } = await import('../app/GameApp.js');
  const app = new GameApp(runtime);
  await app.start();

  // 小游戏一般不需要主动 dispose；小程序页面 onUnload 时调用 app.destroy()
  return runtime;
}
```

> 无法改成动态 import 的老项目兜底：`createWeChatGameRuntime({ ...RUNTIME_OPTIONS, installGlobals: true })`。它是**可逆**的逃生舱，不是默认路径。

## 2. 构建配置（扁平选项 + CommonJS 真分包）

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

export default defineConfig({
  plugins: [
    miniThree({
      webgpu: 'warn',
      outputDir: 'assets/three',   // ★ 顶层扁平，不要写 assets: { outputDir }
      brotli: true,
      roots: ['public/decoders'],
      report: true,
    }),
  ],
  build: {
    target: 'es2019',              // 消除 ?. / ?? 触发的开发者工具语法错误
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    modulePreload: false,          // 垫片引用 window / dispatchEvent，小游戏没有
    rollupOptions: {
      input: 'src/main.ts',
      preserveEntrySignatures: false, // ★ input 级；否则 chunk 会反向 require 入口
      output: {
        format: 'cjs',             // ★ 小游戏模块系统就是 CJS，require 必定可用
        entryFileNames: 'game.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
        manualChunks(id) {
          // ★ 必须带 /node_modules/ 前缀；否则项目目录名含 mini-three-adapter 时全部模块进一组
          if (id.includes('/node_modules/mini-three-adapter/')) return 'adapter';
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/src/config/') || id.includes('/src/core/')) return 'shared'; // 共用模块必须拆出
        },
      },
    },
  },
});
```

> **不要用 `inlineDynamicImports: true`**：它不保留惰性，three 组件会被打进入口并在脚本求值阶段执行，抛出 `Scoped global "__THREE__" was read before a runtime was created`。
> 产物形态：`game.js`（约 1.3KB）+ `chunks/three-*.js`（约 543KB）+ `chunks/adapter-*.js`（约 50KB）+ `chunks/GameApp-*.js` + `chunks/shared-*.js`。

```json
// package.json（关键字段）
{
  "type": "module",
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build && node scripts/postbuild.mjs",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "h5:build": "vite build --config vite.h5.config.ts",
    "h5": "npm run h5:build && vite preview --config vite.h5.config.ts --port 4173",
    "smoke": "node scripts/smoke.cjs",
    "check": "npm run typecheck && npm run build && npm run smoke"
  },
  "dependencies": { "mini-three-adapter": "0.1.9", "three": "0.187.0" },
  "devDependencies": { "@types/three": "0.187.0", "typescript": "^5.7.0", "vite": "^6.0.0" }
}
```

## 3. 渲染器 + resize + 释放

```ts
// src/render/Renderer.ts
import * as THREE from 'three';
import type { MiniThreeRuntime } from 'mini-three-adapter';
import { DisposalGroup } from '../core/DisposalGroup.js';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  disposals: DisposalGroup;
}

export function createRenderContext(runtime: MiniThreeRuntime): RenderContext {
  const { windowInfo } = runtime;
  // runtime.rendererHints 已含 canvas / antialias / alpha / powerPreference /
  // preserveDrawingBuffer / outputColorSpace；这里只补尺寸与 DPR。
  const renderer = new THREE.WebGLRenderer(runtime.rendererHints);
  renderer.setPixelRatio(windowInfo.pixelRatio);
  renderer.setSize(windowInfo.width, windowInfo.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, windowInfo.width / windowInfo.height, 0.1, 200);
  const disposals = new DisposalGroup();

  disposals.add(runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(info.pixelRatio);
    renderer.setSize(info.width, info.height, false);
  }));
  disposals.add(runtime.on('contextlost', () => console.warn('[render] WebGL context lost')));
  disposals.add(() => {
    renderer.setAnimationLoop(null);   // ★ 必须先停循环
    renderer.dispose();
  });

  return { renderer, scene, camera, disposals };
}
```

## 4. 统一释放组 + 帧循环

```ts
// src/core/DisposalGroup.ts
export type Disposer = () => void;

export class DisposalGroup {
  private items: Disposer[] = [];
  private done = false;

  add(...items: Disposer[]): this { if (this.done) throw new Error('DisposalGroup already disposed'); this.items.push(...items); return this; }

  track<T extends { dispose(): void }>(resource: T): T { this.add(() => resource.dispose()); return resource; }

  trackObject(root: import('three').Object3D): void {
    this.add(() => {
      root.traverse((child) => {
        const mesh = child as import('three').Mesh;
        mesh.geometry?.dispose?.();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of materials) {
          for (const value of Object.values(m)) {
            if (value && typeof value === 'object' && 'isTexture' in value) {
              (value as { dispose(): void }).dispose();
            }
          }
          m.dispose();
        }
      });
      root.removeFromParent();
    });
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (const fn of this.items.splice(0).reverse()) {
      try { fn(); } catch (e) { console.warn('[dispose] failed', e); }
    }
  }
}
```

```ts
// src/app/Loop.ts
import type * as THREE from 'three';

export class Loop {
  private running = false;
  private last = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly tick: (deltaMs: number, timeMs: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.renderer.setAnimationLoop((time: number) => {
      if (!this.running) return;
      const t = Number.isFinite(time) ? time : Date.now();
      const delta = this.last === 0 ? 16.67 : Math.min(t - this.last, 100); // 防止切后台回来大跳
      this.last = t;
      this.tick(delta, t);
      this.renderer.render(this.scene, this.camera);
    });
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null); // 真正注销回调，避免后台耗电
    this.last = 0;
  }

  resume(): void { this.start(); }
}
```

> 与脚手架 `src/app/Loop.ts` 一致：先 `setAnimationLoop(null)` 再停止，切后台不会残留 rAF。

## 5. 资源清单与 loader 工厂

```ts
// src/config/constants.ts
export const DECODER_BASE = 'assets/three/';   // ★ 必须与 mini-three-assets.json 的 decoderPaths 一致
export const RUNTIME_OPTIONS = {
  pixelRatioCap: 2,
  logLevel: 'warn' as const,
  slowFrameThreshold: 33,
};
export const ASSET_CDN = 'https://cdn.example.com/game/';  // 必须在合法域名白名单
```

```ts
// src/assets/manifest.ts —— 单一数据源
export const ASSETS = {
  hero:       { id: 'hero',       url: 'models/hero.glb',       kind: 'gltf',  subpackage: 'stage1' },
  envHdr:     { id: 'envHdr',     url: 'textures/env.ktx2',     kind: 'ktx2',  subpackage: 'stage1' },
  uiAtlas:    { id: 'uiAtlas',    url: 'textures/ui.png',       kind: 'image', subpackage: null },
} as const;

export type AssetId = keyof typeof ASSETS;
export type AssetEntry = (typeof ASSETS)[AssetId];
```

```ts
// src/assets/loaders.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DECODER_BASE } from '../config/constants.js';
import { DisposalGroup } from '../core/DisposalGroup.js';

export function createLoaderFactory(renderer: THREE.WebGLRenderer, group: DisposalGroup) {
  const draco = group.track(new DRACOLoader());
  draco.setDecoderPath(DECODER_BASE);
  const ktx2 = group.track(new KTX2Loader());
  ktx2.setTranscoderPath(DECODER_BASE).detectSupport(renderer);

  const gltf = new GLTFLoader();
  gltf.setDRACOLoader(draco);
  gltf.setKTX2Loader(ktx2);
  return { gltf, draco, ktx2 };
}
```

> `DRACOLoader` / `KTX2Loader` 的 `dispose()` 会终止 Worker；Worker 并发上限 1，切换场景时确保旧的先释放。
>
> 网络纹理不要直接依赖慢 `img.src`：适配层的图片事件 watchdog 按包内纹理设 2 秒，超时派发 `image-events-timeout` 并在裸 console 打 `warnOnce`。先 `wx.downloadFile` 拿到本地路径，再交给 `TextureLoader` / `new THREE.Texture(image)`。
>
> 真机 `wx.createImage()` 的 `src` 可能是数据属性（写入经宿主 interceptor 触发加载）：0.1.9 对此完全直通，**不要**再 `Object.defineProperty(img, 'src', …)` 包一层。这类宿主读不了 `mini-three-blob:` 对象 URL；GLTF 内嵌贴图先转 `data:` URI 或写入 `wx.env.USER_DATA_PATH`，否则会看到 `image-src-object-url` 告警。

## 6. 分包 / Worker 预下载

```ts
// src/platform/subpackage.ts
export function loadSubpackage(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const wxAny = wx as unknown as {
      loadSubpackage?: (o: { name: string; success?: () => void; fail?: (e: unknown) => void }) => void;
    };
    if (typeof wxAny.loadSubpackage !== 'function') { reject(new Error('loadSubpackage unavailable')); return; }
    wxAny.loadSubpackage({ name, success: () => resolve(), fail: (e) => reject(e) });
  });
}

export function preDownloadWorkers(): Promise<void> {
  return new Promise((resolve, reject) => {
    const wxAny = wx as unknown as {
      preDownloadSubpackage?: (o: { packageType: 'workers'; success?: () => void; fail?: (e: unknown) => void }) => void;
    };
    if (typeof wxAny.preDownloadSubpackage !== 'function') { resolve(); return; } // 老基础库：worker 在主包
    wxAny.preDownloadSubpackage({ packageType: 'workers', success: () => resolve(), fail: (e) => reject(e) });
  });
}
```

## 7. 生命周期 / 内存 / 错误上报

```ts
// src/platform/lifecycle.ts —— 与脚手架一致
import type { DisposalGroup } from '../core/DisposalGroup.js';

export interface LifecycleHandlers {
  onShow?: () => void;
  onHide?: () => void;
  onMemoryWarning?: (level: number) => void;
}

export function wirePlatformLifecycle(group: DisposalGroup, handlers: LifecycleHandlers): void {
  if (typeof wx === 'undefined') return;

  if (handlers.onShow && typeof wx.onShow === 'function') {
    const cb = handlers.onShow;
    wx.onShow(cb);
    group.add(() => wx.offShow?.(cb));
  }
  if (handlers.onHide && typeof wx.onHide === 'function') {
    const cb = handlers.onHide;
    wx.onHide(cb);
    group.add(() => wx.offHide?.(cb));
  }
  if (handlers.onMemoryWarning && typeof wx.onMemoryWarning === 'function') {
    const handler = handlers.onMemoryWarning;
    const cb = (event: { level?: number }): void => handler(event?.level ?? 0);
    wx.onMemoryWarning(cb);
    group.add(() => wx.offMemoryWarning?.(cb));
  }

  const onError = (error: unknown): void => console.error('[wx:error]', error);
  if (typeof wx.onError === 'function') {
    wx.onError(onError);
    group.add(() => wx.offError?.(onError));
  }
  const onRejection = (error: unknown): void => console.error('[wx:unhandledRejection]', error);
  if (typeof wx.onUnhandledRejection === 'function') {
    wx.onUnhandledRejection(onRejection);
    group.add(() => wx.offUnhandledRejection?.(onRejection));
  }
}
```

## 8. 设备适配（胶囊 / 安全区）

```ts
// src/platform/device.ts
export interface UiInsets { top: number; bottom: number; left: number; right: number; }

export function readUiInsets(): UiInsets {
  try {
    const info = wx.getWindowInfo();
    const safe = info.safeArea;
    const menu = (wx as unknown as {
      getMenuButtonBoundingClientRect?: () => { bottom?: number } | null;
    }).getMenuButtonBoundingClientRect?.();
    // 胶囊可能返回 null / 异常尺寸，必须容错
    const menuBottom = menu && typeof menu.bottom === 'number' && menu.bottom > 0 && menu.bottom < info.windowHeight
      ? menu.bottom : (safe?.top ?? 0);
    return {
      top: Math.max(safe?.top ?? 0, menuBottom),
      bottom: safe ? info.windowHeight - safe.bottom : 0,
      left: safe?.left ?? 0,
      right: safe ? info.windowWidth - safe.right : 0,
    };
  } catch {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
}
```

## 9. 小程序接线（WXML 事件转发）

```ts
// pages/index/index.ts
import { createWeChatMiniProgramRuntime } from 'mini-three-adapter/wechat-miniprogram';
import type { MiniThreeRuntime } from 'mini-three-adapter';

Page({
  runtime: null as MiniThreeRuntime | null,
  async onReady() {
    const runtime = await createWeChatMiniProgramRuntime({
      selector: '#gl', selectorCtx: this, queryDelay: 0, pixelRatioCap: 2,
    });
    this.runtime = runtime;
    await runtime.resize();                 // 确保 PointerBridge 的 rect 就绪
    const { startScene } = await import('./scene.js');
    startScene(runtime);
  },
  onTouch(e: WechatMiniprogram.TouchEvent) { this.runtime?.handleTouch(e); },
  onUnload() { this.runtime?.dispose(); this.runtime = null; },
});
```

```html
<!-- pages/index/index.wxml -->
<canvas type="webgl2" id="gl"
  bindtouchstart="onTouch" bindtouchmove="onTouch" bindtouchend="onTouch"
  bindtouchcancel="onTouch" bindtap="onTouch" />
```

## 10. H5 双端冒烟（同一份场景代码）

```ts
// src/platform/bootstrap.h5.ts —— 仅 H5 构建入口使用
import { createBrowserRuntime } from 'mini-three-adapter/browser';
import type { MiniThreeRuntime } from 'mini-three-adapter';
import { RUNTIME_OPTIONS } from '../config/constants.js';

async function bootstrapH5(): Promise<void> {
  const canvas = document.getElementById('gl');
  const runtime: MiniThreeRuntime = await createBrowserRuntime({
    ...RUNTIME_OPTIONS,
    canvas: canvas instanceof HTMLCanvasElement ? canvas : undefined,
  });
  console.log(runtime.report());
  const { GameApp } = await import('../app/GameApp.js');
  await new GameApp(runtime).start();
}

void bootstrapH5().catch((error: unknown) => console.error('[h5] bootstrap failed', error));
```

> 因为三端返回同一个 `MiniThreeRuntime`，`app/` / `scenes/` 完全不用改。用 `npm run h5`（build + preview）在浏览器里验证业务逻辑，是日常迭代最快的一环。**不要用 `vite dev`**：AST 重写只在构建期生效，dev server 下 three 会读到未激活的作用域全局。0.1.7 起浏览器原生 `pointer*` / `wheel` 直接驱动 OrbitControls，不需要再手工转发事件。

## 11. 构建报告读取

```ts
// scripts/report.mjs（在构建宿主中调用）
const plugin = miniThree({ report: false });
// ... 把它传给 vite/rollup 并在 build 之后：
const r = plugin.api.report();
if (r.parseFailures.length) throw new Error(`parse failures: ${r.parseFailures.join('\n')}`);
if (r.webgpuWarnings.length) console.warn('[mini-three] WebGPU imports detected');
console.table({ scanned: r.modulesScanned, rewritten: r.modulesRewritten,
               rewrites: r.rewrites, missing: r.missingAssets.length });
```
