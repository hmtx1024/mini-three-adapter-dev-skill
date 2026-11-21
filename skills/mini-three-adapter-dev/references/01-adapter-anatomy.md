# 01 · 适配层解剖与 API 速查

> 依据 `mini-three-adapter@0.1.9` 源码逐文件核对（`src/**`，2026-11-21）。与上游 README/docs 冲突处以源码为准；0.1.1→0.1.7 见 `05-workflows.md` §13，0.1.7→0.1.9 见 §14。

## 1.1 一句话模型

**构建期**：Vite/Rollup 插件用 Babel 作用域分析，把 `node_modules` 中 three 生态模块里的**自由全局引用**（`window`、`document`、`Image`…）改写成 `__m3().window` 形式，并注入 `import { getActiveScope as __m3 } from 'mini-three-adapter/scope'`。
**运行期**：`createWeChatGameRuntime()` 组装出一个可 `dispose()` 的 `MiniThreeRuntime`，把 wx 返回的原始 canvas **就地**补成 DOM 风格对象，同时提供作用域对象、触摸桥、帧调度、窗口信息。

两阶段互不依赖：`build/*` 不 import `core/*`，`core/*` 不 import `platforms/*`，`src/**` 不 import `three`。

```
构建期(Node)                              运行期(小游戏 JS 引擎)
three/addons 源码                         PlatformBinding(wx)
  └─ @babel/parser + scope                 └─ createRuntime()
      └─ MagicString: window → __m3().window     ├─ patchCanvas(in-place)
      └─ 扫描 *.wasm/*worker*.js                ├─ MiniThreeScope(伪 window)
          └─ emitFile + mini-three-assets.json   ├─ PointerBridge(touch→pointer)
                                                 ├─ FrameScheduler
                                                 └─ WindowInfoStore
                    __m3() = getActiveScope() ─────┘
```

## 1.2 十条架构不变量（改适配层源码时不得破坏）

1. 只有一个上屏画布：`wx.createCanvas()` 仅在 `getScreenCanvas()` 调用一次并缓存。能力探测优先 `wx.createOffscreenCanvas()`；只有小游戏在上屏画布**已解析**、离屏 API **存在**时才允许回退第二次 `createCanvas()`，并必须用候选画布集合做身份校验（ADR-0007/0008）。
2. 对象身份不变：canvas / image 永远是 wx 返回的那个对象；禁止 `new Proxy` / `Object.setPrototypeOf` / 克隆。就地 `defineProperty` 只补缺或接管宿主自己的 accessor；宿主读取为**数据属性**的成员（如图片 `src`）不得接管（ADR-0012）。
3. 默认零全局污染：只有 `installGlobals()` 写 `globalThis`，显式且可逆。
4. `three` 零运行时依赖：`src/` 不 import `three`（optional peer + external）。
5. 平台无关核心：`core/` 不认识 `wx`，差异收敛到 `PlatformBinding`。
6. 构建/运行隔离：`build/*` 不 import `core/*` / `platforms/*`；`node:fs` 只在 `build/`。
7. 单一生命周期：所有订阅/定时器/全局注入登记到 `disposers`，`dispose()` 后无残留。
8. WebGL2 优先：`document.createElement('canvas')` 默认 webgl2；无 WebGL2 明确告警，不静默降级。
9. AST 改写只针对自由变量：必须走 `path.scope.hasBinding(name, true)`。
10. 破坏性行为必须显式 opt-in：全局注入、WebGPU rewrite、深度缓冲补丁。

## 1.3 子路径导出（package.json `exports`）

| 子路径 | 内容 |
| --- | --- |
| `mini-three-adapter` | 汇总导出（含全部平台，tree-shaking 较差） |
| `mini-three-adapter/core` | 平台无关运行时 |
| `mini-three-adapter/scope` | `getActiveScope()` 等 —— **插件注入 import 的目标** |
| `mini-three-adapter/wechat-game` | 小游戏入口（推荐） |
| `mini-three-adapter/wechat-miniprogram` | 小程序入口 |
| `mini-three-adapter/browser` | 浏览器 / H5 / Node 测试 |
| `mini-three-adapter/polyfills` | 独立 polyfill |
| `mini-three-adapter/vite` | Vite 插件（default export `miniThree`） |
| `mini-three-adapter/rollup` | Rollup 插件（named `miniThree`）+ 高级 API |
| `mini-three-adapter/plugin` | `vite` 的别名 |
| `mini-three-adapter/package.json` | 读包元信息 |

`sideEffects` 只声明两个平台入口文件。`three` / `vite` / `rollup` 均为 optional peer；运行时依赖只有 `@babel/parser`、`@babel/traverse`、`magic-string`（**只在 Node 侧**）。

## 1.4 生命周期 API

```ts
createWeChatGameRuntime(options?): Promise<MiniThreeRuntime>
createWeChatGameBinding(options?): PlatformBinding            // 同步
createWeChatMiniProgramRuntime({ selector, selectorCtx?, queryDelay?, ... }): Promise<MiniThreeRuntime>
createBrowserRuntime(options?): Promise<MiniThreeRuntime>
createRuntime(platform: PlatformBinding | PlatformFactory, options?): Promise<MiniThreeRuntime>
getScreenCanvas(wx, supplied?): WxCanvas
resetScreenCanvasCache(): void                                 // 仅测试
```

`WeChatGameOptions`：`wx?`（注入 mock）、`canvas?`（复用已有上屏画布）、`capabilities?`（覆盖探测，`webgl2Source` 变为 `'override'`）、`diagnostics?`、`preferredFps?`（内部调 `wx.setPreferredFramesPerSecond`）。

`getScreenCanvas` 取值顺序：`options.canvas` → 模块级缓存 → `GameGlobal.screencanvas` → `globalThis.canvas`（weapp-adapter 遗留）→ `wx.createCanvas()`（**唯一一次**）。

作用域辅助函数（`mini-three-adapter/scope`）：

```ts
getActiveScope(): MiniThreeScope          // runtime 前返回占位对象
hasActiveScope(): boolean
getEarlyScopeReads(): readonly string[]   // runtime 前被读过的环境全局名
clearEarlyScopeReads(): void
installGlobals(scope, options?): () => void
```

### `MiniThreeRuntime` 成员

| 成员 | 说明 |
| --- | --- |
| `canvas` | 已就地补丁的上屏画布（`HTMLCanvasElement` 类型） |
| `scope` | `MiniThreeScope`，伪 window |
| `document` | `createElement` / `createElementNS` / `body` / `documentElement` / `defaultView` / `visibilityState` |
| `capabilities` | `Capabilities` 探测结果（含 `webgl2Source`） |
| `diagnostics` | 分级日志、`warnOnce` |
| `frames` | `FrameScheduler`（`request`/`cancel`/`loop`/`setFpsCap`/`fps`） |
| `bridge` | `PointerBridge`（`dispatch`/`dispatchMouse`/`setRect`/`activePointerCount`） |
| `windowInfo` | 实时 `WindowInfo` getter |
| `rendererHints` | `{ canvas, antialias:false, alpha:false, powerPreference:'high-performance', preserveDrawingBuffer:false, outputColorSpace:'srgb' }` |
| `disposed` | 是否已释放 |
| `handleTouch(event, {propagate?, computeRect?})` | 手动转发触摸（**小程序必需**） |
| `resize(): Promise<void>` | 重新测量并广播 resize |
| `installGlobals(opts?): Disposer` | 显式全局注入，返回还原函数 |
| `createCanvas(w?, h?, type?)` | 额外的离屏画布 |
| `on(event, listener): Disposer` | 订阅，返回取消订阅 |
| `report(): string` | 可粘贴的能力报告文本 |
| `dispose()` | 释放全部副作用 |

`RuntimeEvents`：`resize(info)`、`visibilitychange(visible)`、`contextlost()`、`dispose()`、`error(Error)`。

> `error` 在 0.1.9 的类型里有、但 runtime 目前没有生产方；不要把它当唯一错误出口。真实错误仍走 `diagnostics` / `wx.onError` / `wx.onUnhandledRejection`，`runtime.on('error')` 可保留作前向兼容。

### `RuntimeOptions` 全表

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `pixelRatioCap` | `2` | 限制 DPR，`0` = 不封顶 |
| `propagatePointerEvents` | `true` | 同时派发到 document / window |
| `emitMouseEvents` | `true` | 额外发 `mouse*` / `click` |
| `defaultContextType` | `'webgl2'` | `createElement('canvas')` 的默认上下文 |
| `cacheContexts` | `true` | 缓存 `getContext()`，保证上下文身份稳定 |
| `normalizeWebGL` | `true` | 修正 `getExtension` 返回值、`drawingBufferWidth/Height` |
| `fpsCap` | `0` | 逻辑帧率上限 |
| `slowFrameThreshold` | `0` | 慢帧告警阈值 ms |
| `logLevel` | `'warn'` | `silent/error/warn/info/debug` |
| `reporter` | console | 自定义日志出口 |
| `capabilities` | — | 覆盖探测结果（机型分级 / 测试），`webgl2Source` 记为 `'override'` |
| `installGlobals` | `false` | 启动时立即注入全局（可逆） |

> `diagnostics` 是平台 options（`WeChatGameOptions` / `BrowserPlatformOptions`）的字段，不在 `RuntimeOptions` 里；runtime 用 `logLevel` + `reporter` 建自己的 diagnostics。

### 关键类型

```ts
interface Capabilities {
  platform: 'wechat-game' | 'wechat-miniprogram' | 'browser' | 'unknown';
  webgl2: boolean;
  /** 'probe' 实测 / 'inferred' 按基础库推断 / 'override' 调用方覆盖 */
  webgl2Source?: 'probe' | 'inferred' | 'override';
  webgl1: boolean; offscreenCanvas: boolean;
  worker: boolean; wasm: boolean; brotliWasm: boolean; nativeImage: boolean;
  triggerGC: boolean; getWindowInfo: boolean; windowResizeEvent: boolean;
  baseLibraryVersion: string;
}
interface WindowInfo {
  width: number; height: number; pixelRatio: number; rawPixelRatio: number; safeArea?: Rect;
}
interface Rect { top: number; left: number; width: number; height: number; right: number; bottom: number; }
interface TouchLikeEvent { type: string; touches?: ArrayLike<TouchPoint>; changedTouches?: ArrayLike<TouchPoint>; timeStamp?: number; [k: string]: unknown; }
```

`PlatformBinding`（新增平台时实现）：`kind`、`wx?`、`rawCanvas`、`capabilities`、`imageFactory`、`nativeEventTarget?`、`createEvent?(type, init)`、`getCanvasRect()`、`createOffscreenCanvas(w,h,type)`、`watchTouch(handler)`、`watchVisibility(handler)`、`requestAnimationFrame`、`cancelAnimationFrame`、`now()`、`dispose()`。`nativeEventTarget: true` 表示宿主自带原生事件系统（浏览器），适配层不替换事件方法，只补缺失的 DOM 成员（ADR-0010）。

## 1.5 机制细节（排错用）

### 作用域 `MiniThreeScope`

- `window === self === globalThis === scope`（均为 getter）。
- 领域对象：`document`、`navigator`、`screen`、`performance`、`getComputedStyle`、`matchMedia`。
- 尺寸为 live getter：`innerWidth/Height`、`outerWidth/Height`、`devicePixelRatio`、`pageXOffset/Y`。
- 事件构造器：`Event`、`EventTarget`、`CustomEvent`、`PointerEvent`、`MouseEvent`、`TouchEvent`、`MessageEvent`、`ProgressEvent`、`KeyboardEvent`、`DOMException`。
- DOM 构造器 shim：`HTMLElement`、`HTMLCanvasElement`、`HTMLImageElement`、`OffscreenCanvas`、`Image`、`ImageData`、`DOMRect`、`WebGLRenderingContext`、`WebGL2RenderingContext`、`AudioContext`。
- 网络/编码：`Blob`、`URL`、`TextEncoder/Decoder`、`fetch`、`XMLHttpRequest`、`AbortController/AbortSignal`、`atob/btoa`。
- **恒为 `undefined`**：`createImageBitmap`、`FileReader`、`WebSocket`、`HTMLVideoElement`；`ResizeObserver` 是 no-op 类。让 three 自动走降级分支，不要伪造半实现。
- `Worker` / `WebAssembly` 透传宿主全局（`WebAssembly` 或 `WXWebAssembly`）。
- 未创建 runtime 时 `getActiveScope()` 返回占位对象：`window/self/globalThis` 指向自身（`typeof` 为 `'object'`）；`document/navigator/screen/location/history` 读作 `undefined`（`typeof window.document` 也不抛）；其余键读取即抛 `Scoped global "xxx" was read before a runtime was created`。
- 那些读作 `undefined` 的早读会被记录；`createRuntime()` 启动时 `warnOnce` 汇总一次后清空，`getEarlyScopeReads()` 可随时查询。它只说明「有模块求值过早」，不阻断启动。

### AST 改写（`src/build/scope-rewrite.ts`）

- `ReferencedIdentifier` visitor + `isNonComputedKey()` 排除对象键/类成员键/成员属性 + `path.scope.hasBinding(name, true)` 排除局部绑定。
- `typeof window` → `typeof __m3().window`（结果 `'object'`，让 three 走浏览器分支）；`typeof document` → `typeof (__m3Has() ? __m3().document : undefined)`，runtime 前得到 `'undefined'` 而不是抛错。
- `new TextDecoder()` → `new (__m3().TextDecoder)()`：括号必须加在 callee 成员链根上，否则会被解析成 `(new __m3()).TextDecoder()`，真机报 `Class constructor ... cannot be invoked without 'new'`（0.1.2 修复）。
- 对象简写 `{ TextDecoder }` → `{ TextDecoder: (__m3().TextDecoder) }`：简写属性的 key/value 是区间相同的两个节点，原地替换会产出语法错误（0.1.2 修复）。
- `typeof` 守卫只覆盖直接操作数；`typeof window.document` 这类成员链由占位作用域把 `document` 读作 `undefined` 兜住（ADR-0009）。
- `globalThis` **故意不在**默认清单（three 用它挂 `__THREE_DEVTOOLS__` 等调试钩子）。
- `DEFAULT_FORCE_UNDEF = ['createImageBitmap']`：改写后作用域里恒为 `undefined`，强制 three 走非 Blob 分支。
- 解析失败 → 记入 `parseFailures`、告警、**原样返回**，绝不产出半改写代码。
- 默认 include：`/node_modules/three/`、`three@<ver>`、`three-stdlib`、`@react-three`、`@tresjs`、`.vite/deps/three*`。应用代码默认**不改写**（`includeUserCode: true` 才开）。
- Vite 插件的 `config()` 设置 `optimizeDeps.exclude: ['three','three-stdlib','three/examples/jsm']`，防止预打包成不透明 blob。

### WebGPU 策略

| `webgpu` | 行为 |
| --- | --- |
| `'warn'`（默认） | 构建告警，记入 `report.webgpuWarnings` |
| `'error'` | 直接失败，强制改用 `WebGLRenderer` |
| `'rewrite'` | `three/webgpu`→`three`、`WebGPURenderer`→`WebGLRenderer`（**有损**，仅限未用 TSL/NodeMaterial 的简单场景） |
| `'ignore'` | 不处理 |

### 就地画布补丁

`patchElement()` 在**原对象**上 `defineProperty`：`style`（width/height 为响应式 getter）、`clientWidth/Height`、`offsetTop/Left`、`getBoundingClientRect()`、`setAttribute`、`ownerDocument`、`getRootNode`、`setPointerCapture` 等，并 `patchEventTarget()` 补事件系统。
`nativeEventTarget: true` 时（浏览器真实 canvas）：**跳过** `patchEventTarget()`，且只补宿主缺失的成员；`addEventListener` / `dispatchEvent` / `style` / `getBoundingClientRect` / `setPointerCapture` / `nodeType` 一律保留原生实现（0.1.7，ADR-0010）。
`patchCanvas()` 额外补 `getContext`（类型缓存 + `webgl2` 归一化）、`toDataURL`、`nodeType/tagName/nodeName`，并把对象注册进 `HTMLCanvasElementShim` / `HTMLElementShim` 的 `WeakSet`，让 `instanceof` 成立。

`normalizeWebGL`：把部分 Android 基础库返回数字/布尔的 `getExtension()` 归一成对象或 `null`，并补 `drawingBufferWidth/Height` getter。

### 触摸桥（touch → pointer）

`PointerBridge` 维护 `Map<pointerId, {x,y}>` + capture 表，`TYPE_MAP`：`touchstart→pointerdown`、`touchmove→pointermove`、`touchend→pointerup`、`touchcancel→pointercancel`；同时按 `MOUSE_TYPE_MAP` 发 `mousedown/mousemove/mouseup` 与合成 `click`。坐标 `offsetX = clientX - rect.left`。`tap`（小程序常无 touches）会合成点位并派发 click。`touchcancel` 清理指针计数。rect 未就绪时 `warnOnce` 并丢弃事件（提示 `await runtime.resize()`）。

0.1.7 起：`nativeEventTarget: true` 时用 `binding.createEvent` 构造**真实 DOM 事件**，且不再向 scoped `document` / `window` 转派（浏览器自己冒泡）；`dispatchMouse({ type: 'wheel' })` 产出真正的 `wheel` 并携带 `deltaY`。`MiniEventTarget.dispatchEvent()` 只对 `MiniEvent` 写 `target/currentTarget`，不会碰真实事件上的只读字段。

### 资源管线

- `collectAssetReferences()` 扫模块内字符串字面量，按关键字过滤：`draco/basis/ktx2/rhino3dm/zstd/meshopt/ammo/worker/decoder/transcoder/lottie/sdf`。
- 默认 roots：`three/examples/jsm/libs`、`three/examples/jsm`、`three-stdlib`、`public`、`static`，加用户 `roots`。
- `brotli: true` 时一并拷 `.wasm.br`；找不到只记 `missingAssets` 告警，不阻断构建。
- 输出 `mini-three-assets.json`：`entries[]`、`gameJsonSuggestion`（`workers: {path, isSubpackage:true}` + `subpackages`）、`decoderPaths`、`build` 报告、`output`。
- `BuildReport`：`modulesScanned`、`modulesRewritten`、`rewrites`、`globalsSeen`、`assetReferences`、`missingAssets`、`webgpuWarnings`、`parseFailures`。

### 图片事件桥接（纹理加载）

`wx.createImage()` 返回对象的形状因宿主而异，且**模拟器与真机是不同形态**。`createImageFactory` 在 `patchElement` **之前**抓取原生入口，按以下顺序建立桥接：

1. 原生 `addEventListener('load' | 'error')`；
2. 直接赋值 `img.onload` / `img.onerror` 槽位；
   - 1、2 两级**并行**接线，不是 else-if：真机的 `addEventListener` 可能是「只注册、从不派发」的空壳（0.1.9 真机探针），只挂第 1 级会让槽位永远不接线。`finish` 幂等，双通道也只收敛一次；watchdog 超时的 `path` 报组合值（如 `addEventListener+onload`）。
   - 用户访问器在**非派发期间 getter 恒回桥接函数**，只有 `dispatchEvent` 行内派发期间返回登记的业务回调。真机在事件触发时**读 `image.onload` 属性**再调用，而 three 只用 `addEventListener`、从不赋 `onload`；旧 getter 回登记表会让它读到 `undefined`（0.1.7 真机空白根因，ADR-0011）。`finish` 幂等保证「既存又读」的宿主不会双发。
3. `wx.getImageInfo`（只解码元数据，**不能**合成 `load`，只用于诊断/失败归因）；
4. **2 秒 watchdog**（无条件）：`src` 赋值即上闹钟；到点 `complete` 为真派发 `load`，否则派发带 `reason: 'image-events-timeout'` 的 `error` 并 `warnOnce('image-events-timeout', …, { path, src })`。

`src` **按捕获的描述符分流**（ADR-0012）：

- **accessor（或无描述符）**：安装 shim 访问器，写入时把 `mini-three-blob:` 对象 URL 改写为 `data:` 并触发兜底；宿主原生 setter 直写。
- **数据属性（真机形态）**：完全不安装访问器、绝不 `defineProperty`。普通写入直达宿主的属性 interceptor，原生加载钩子保持完好。兜底由有界轮询驱动：100ms 一次、最多 120 次（12s）等待**首次 `src` 赋值**——这不是把加载超时放宽到 12s，加载仍由 2s watchdog 判定；`finish` 或封顶后自动停表，创建后从未赋值的图片不保留定时器。
- 数据属性宿主读不了 `mini-three-blob:` 对象 URL：检测到时 `warnOnce('image-src-object-url', …, { src })`。需先转 `data:` URI 或落盘 `wx.env.USER_DATA_PATH`（上游文件桥仍是待办）。

真实事件优先，终态只派发一次；`complete` 在成功与失败后都为 `true`，`decode()` 失败时 reject。`crossOrigin` / `fetchPriority` 预置为可写数据成员（three 的 `ImageLoader` 会写 `fetchPriority`），避免给宿主新增未知成员。退化路径的 `warnOnce` payload 带 `onload` / `onerror` / `src` 的槽位形态（`accessor|data|data-readonly|missing`）、`addEventListener`、`getImageInfo`、`ownNames`，可直接贴 issue。

> 2 秒只适合包内纹理。网络大图先 `wx.downloadFile` 到本地路径，或预加载后 `new THREE.Texture(image)`；否则会被 watchdog 判失败。

## 1.6 构建插件选项（**源码核实版**）

`MiniThreePluginOptions extends AssetOptions`，所以 `AssetOptions` 的字段是**顶层扁平**的：

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `include` | `(id) => boolean` | 匹配 three 生态 |
| `exclude` | `(id) => boolean` | `() => false` |
| `includeUserCode` | `boolean` | `false` |
| `rewrite` | `RewriteOptions` | — |
| `webgpu` | `'warn'\|'error'\|'rewrite'\|'ignore'` | `'warn'` |
| `roots` | `string[]` | three jsm/libs、three-stdlib、public、static |
| `outputDir` | `string` | `'assets/three'` |
| `brotli` | `boolean` | `true` |
| `manifest` | `boolean` | `true` |
| `cwd` | `string` | `process.cwd()` |
| `report` | `boolean` | `true` |
| `debug` | `boolean` | `false` |

`RewriteOptions`：`globals`（替换默认清单）、`extraGlobals`（追加）、`forceUndef`（默认 `['createImageBitmap']`）、`accessor`（默认 `'__m3'`）、`scopeModule`（默认 `'mini-three-adapter/scope'`）。

高级导出（`mini-three-adapter/rollup`）：`rewriteGlobals`、`DEFAULT_GLOBAL_NAMES`、`DEFAULT_FORCE_UNDEF`、`collectAssetReferences`、`collectAssets`、`copyAssets`、`miniThreePlugin`。

> ⚠️ **上游文档 bug**：`README.md` 快速开始、`docs/07`、`examples/*/vite.config.ts` 里写成 `miniThree({ assets: { outputDir, brotli } })`。源码中没有 `assets` 字段，该对象会被静默忽略（恰好默认值相同所以示例仍能跑）。自定义输出目录时务必用扁平写法。

> ⚠️ **另一处需注意**：`src/build/vite.ts` 的 `config()` 返回 `build.rollupOptions.output.manualChunks: undefined`，即插件本身不分组。项目必须在自己的 `rollupOptions.output` 里写 `manualChunks`（three 必须独立成 chunk），构建后核对 `dist/chunks/` 出现 `three-*`，且没有 chunk 反向 `require` 入口。

> 0.1.7 把 `transform` 的 `map` 类型改为具名 `BuildSourceMap`，修复了 Vite 6 下 `TS2769`；0.1.6 及以前在 Vite 6 项目里类型检查会报错。

## 1.7 三端接线差异

| 平台 | runtime 工厂 | 触摸来源 | 画布来源 |
| --- | --- | --- | --- |
| 小游戏 | `createWeChatGameRuntime()` | 自动订阅 `wx.onTouch*` | 唯一上屏画布，自动获取并缓存 |
| 小程序 | `createWeChatMiniProgramRuntime({ selector, selectorCtx })` | WXML `bindtouch*` → `runtime.handleTouch(e)` | `createSelectorQuery().fields({node,rect,size})` 异步取节点 |
| 浏览器/H5 | `createBrowserRuntime({ canvas? })` | 浏览器原生 `pointer*` / `wheel`（支持 PointerEvent 时不重复合成 touch） | 真实 DOM canvas：`nativeEventTarget: true`，事件方法与 DOM 成员不被覆盖（0.1.7） |

三端返回同一个 `MiniThreeRuntime`，因此 `scene` 层代码可完全复用 —— 这是 H5 双端调试的基础。

## 1.8 能力边界

**做**：补全 three 生态用到的浏览器全局 / DOM 属性 / `instanceof`；touch→pointer；统一尺寸、DPR、resize、可见性、帧循环；构建期收集 worker/wasm；H5 双端。
**不做**：完整 DOM / CSS 布局 / 事件冒泡树（DOM 密集型 UI 用 WebView）；WebGPU 模拟；运行时改写 `WebGLRenderer`；默认改写业务代码；物理 / 动画 / UI 引擎能力。
