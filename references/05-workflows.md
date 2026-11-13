# 05 · 任务型工作流与配方

> 每节给出「目标 → 步骤 → 验收」。可整段复制为 AI 提示词模板。代码见 `07-code-recipes.md` 与 `assets/scaffold/`。

## 1. 新建工程

```bash
node <SKILL_DIR>/scripts/new_project.mjs ./my-game --name "My 3D Game" --appid wx1234567890
cd my-game
npm install
npm run check
npm run h5:build
node <SKILL_DIR>/scripts/check_project.mjs .
node <SKILL_DIR>/scripts/check_bundle.mjs ./dist
```

验收：`dist/game.js` 只有几 KB、`dist/chunks/three-*.js` 存在、`dist/game.json` 存在、`mini-three-assets.json` 无 `missingAssets`、`npm run smoke` 通过、检查脚本无 ERROR。用微信开发者工具（**小游戏模式**）打开项目根，`miniprogramRoot = dist/`。

## 2. 把适配层接入已有小游戏项目

1. 依赖：`npm i mini-three-adapter@0.1.7 three@<精确版本>`、`npm i -D vite @types/three`（three ≥ 0.163，脚手架用 0.187.0）。0.1.7 修复了图片事件、能力探测、`new`/简写改写与 H5 原生事件，低于它先按 §13 升级。
2. `vite.config.ts` 加 `miniThree({ outputDir, brotli, roots, webgpu:'warn' })`（**扁平选项**；上游 README / `docs/07` 的 `assets: {}` 是无效写法），`build.target:'es2019'`，`rollupOptions.input: 'src/main.ts'`，`output.format:'cjs'` + `entryFileNames:'game.js'` + `chunkFileNames:'chunks/[name]-[hash].js'` + `manualChunks`（adapter / three / 共享目录）。**不要用 `inlineDynamicImports`**，也不要用 `build.lib.formats:['es']`（上游 `docs/07` 示例仍是这样，小游戏产物必须是 CJS），见 `04-pitfalls.md` A11/C11。
3. **改造入口**（最关键）：把 `main.ts` 里所有静态 three / 场景 import 删掉，改成：

   ```ts
   import { bootstrap } from './platform/bootstrap.js';
   bootstrap().catch(e => console.error('[game] bootstrap failed', e));
   // bootstrap 内：runtime = await createWeChatGameRuntime(...);
   //              const { GameApp } = await import('../app/GameApp.js');
   ```

4. 渲染器：`new THREE.WebGLRenderer(runtime.rendererHints)`，删掉任何 `document.createElement('canvas')` / `appendChild(renderer.domElement)`。
5. 帧循环：`renderer.setAnimationLoop(...)`；事件接线 `resize` / `visibilitychange` / `contextlost` / `dispose`。
6. `game.json` 合并 `mini-three-assets.json` 的 `gameJsonSuggestion`；`project.config.json` 设 `compileType: "game"`、`miniprogramRoot: "dist/"`。
7. `postbuild.mjs` 拷贝 `game.json` 到 `dist/`。
8. 跑 `check_project.mjs` → typecheck → build → H5 冒烟（`npm run h5`，build + preview，不是 `vite dev`）→ 真机。

验收：`plugin.api.report().modulesRewritten > 0`、`parseFailures` 为空；`runtime.capabilities.webgl2Source` 有值；真机出图且 OrbitControls 可用。

## 3. 加载 GLTF / DRACO / KTX2 模型

1. 把 decoder 目录放进 `roots`（或依赖 three 自带的 `examples/jsm/libs`）。
2. 构建后读 `dist/mini-three-assets.json` 的 `decoderPaths`，确认 `DECODER_BASE`（`config/constants.ts`）一致。
3. loader 工厂（见 `07-code-recipes.md` §5）：`DRACOLoader.setDecoderPath(DECODER_BASE)`、`KTX2Loader.setTranscoderPath(DECODER_BASE).detectSupport(renderer)`。
4. 若 decoder 用了 Worker：先 `await wx.preDownloadSubpackage({ packageType:'workers' })`，且**同时只跑一个 decoder 管线**（并发上限 1）。
5. 远程模型放 CDN + 合法域名；包内模型用 `wx.getFileSystemManager().readFile()` 转 ArrayBuffer 再 `loader.parse()`。
6. 加载后把 GLTF 里所有 geometry/material/texture 登记进 `DisposalGroup`。
7. 纹理走 `TextureLoader` 时注意 2 秒 watchdog：包内 PNG/JPEG 正常；网络大图先 `wx.downloadFile` 到本地路径或预加载，否则会被判 `image-events-timeout`。

验收：真机能出模型；切换模型 20 次内存不持续增长；`missingAssets` 为空；没有图片事件超时告警。

## 4. 后处理 / PMREM / 环境贴图黑屏

- 小游戏 WebGL2 可用，但部分设备深度缓冲残留 → 在渲染循环里**应用层显式** `renderer.clearDepth()`（仅在确认需要时开启，有额外开销）。
- `EffectComposer` 的 render target 尺寸要跟随 `runtime.on('resize')` 一并 `composer.setSize(w, h)`，并考虑 `pixelRatio`（先 `setSize` 再 `setPixelRatio`）。
- 不要用 `WebGPURenderer` / TSL / NodeMaterial。
- 纹理尺寸受设备上限约束（部分机型 2048/4096），按能力分级提供 LOD。

## 5. 多指交互与射线拾取

- 控制器挂 `renderer.domElement`（已补丁画布），适配层自动把 `wx.onTouch*` 转成 `pointer*`。
- 小程序：WXML 五个事件（`bindtouchstart/move/end/cancel` + `bindtap`）全部转发 `runtime.handleTouch(e)`，自定义组件传 `selectorCtx: this`。
- 拾取用 `runtime.bridge` 派发事件的 `offsetX/offsetY`；不要自己按 DPR 二次换算（事件已是 CSS 像素）。
- 测试：`touchcancel` 后 `runtime.bridge.activePointerCount === 0`。

## 6. resize / 横竖屏 / 前后台

```ts
runtime.on('resize', info => { camera.aspect = info.width/info.height; camera.updateProjectionMatrix();
                              renderer.setPixelRatio(info.pixelRatio); renderer.setSize(info.width, info.height, false); });
runtime.on('visibilitychange', visible => visible ? loop.resume() : loop.pause());
runtime.on('contextlost', () => { /* 标记需重建；onShow 时重建 RenderTarget/纹理 */ });
```

- 无 `wx.onWindowResize` 的基础库：`wx.onShow` 里 `await runtime.resize()`。
- `game.json` 的 `deviceOrientation` 决定是否允许转屏；两者都要真机验证。

## 7. 性能 / 包体优化（有基线的迭代）

1. 记录基线：`plugin.api.report()`、`dist` 各文件体积、`runtime.frames.fps`、真机内存峰值。
2. 按顺序执行，每步都要能独立回退：
   - 关阴影、降 `pixelRatioCap`、减粒子与光源；
   - 合并几何 / `InstancedMesh` 降 drawcall（>100/帧明显掉帧）；
   - KTX2 / Basis 压缩纹理、DRACO 压缩几何；
   - 帧内零分配 + 对象池；
   - 动态 import 拆非首屏代码；
   - 大资源上 CDN；
   - 最后才考虑小程序分包（把 chunk 输出到分包目录并在 `game.json` 声明；`manualChunks` 只切 chunk 边界，不移动体积）。
3. `check_bundle.mjs` 对照 4MB 预算（>3.2MB 预警）。
4. iOS 若开高性能模式：内存峰值控制在 1.2~1.3G 以内。

**禁止**：静默删除资源、隐式改写 `WebGLRenderer`、破坏 worker 单目录约束、无基线的「优化」。

## 8. 升级 three 大版本

1. 查官方 Migration Guide，列出新增/移除的浏览器全局与 DOM 依赖。
2. 对照 `DEFAULT_GLOBAL_NAMES`（`src/build/scope-rewrite.ts`）与 `patchElement` 属性表，列出差异。
3. 检查 `three/addons/*` vs `three/examples/jsm/*` 路径、`outputColorSpace`、`setAnimationLoop`、`RGBELoader→HDRLoader` 等破坏性改名（r180+）。
4. 在 H5（`createBrowserRuntime`）先跑通所有场景，再上真机。
5. 更新 `docs/compat.md`：three 版本、基础库、机型、结果、新增 polyfill。
6. 精确锁定版本（`save-exact`），禁止 `^` 漂移。

## 9. three 报 `X is not defined` / `X is not a constructor`

按「缺的是全局标识符 / DOM 属性 / 构造器」分类：

| 类别 | 改哪里 |
| --- | --- |
| 全局标识符 | `DEFAULT_GLOBAL_NAMES` → `MiniThreeScope` 接口 + `GLOBAL_KEYS` → `runtime.ts` scope 组装 |
| DOM 属性 | `patchElement()`（canvas 专属放 `canvas.ts` 的 `extra`） |
| 构造器 / `instanceof` | 复用或新建 `*Shim`（`createMockClass`），补丁时注册 |
| 不可用且必须走降级 | 设为 `undefined` 并加入 `DEFAULT_FORCE_UNDEF`，**不要伪造半实现** |

改完补测试（polyfills / scope-rewrite / runtime 三处），更新上游 `docs/03`、`docs/04`、`CHANGELOG.md`。

## 10. 新增平台（如抖音小游戏）

1. 新建 `src/platforms/<name>.ts` 实现 `PlatformBinding`（参考 `docs/08`）。
2. 复用 `wechat-common.ts` 能复用的 rAF / touch / visibility / 离屏画布。
3. 导出 `create<Name>Binding()` 与 `create<Name>Runtime()`；加 `package.json` exports 与 `Capabilities['platform']` 字面量。
4. 用可注入 mock 宿主补测试；加 `examples/<name>/`。
5. 业务侧只需在 `platform/bootstrap.ts` 增加一个分支 —— 这是分层的收益。

## 11. CI 门禁

```yaml
- run: npm ci
- run: npm run typecheck
- run: node <SKILL_DIR>/scripts/check_project.mjs .
- run: npm run build
- run: npm run h5:build
- run: node <SKILL_DIR>/scripts/check_bundle.mjs ./dist
- run: node -e "/* 打印 plugin.api.report()，断言 parseFailures.length === 0 */"
```

把 `missingAssets` 做成白名单（允许业务自行放置的 decoder），把 `runtime.report()` 附到 bug issue 模板。

## 12. 可直接复制的 AI 提示词模板

### 新场景

```
上下文：本 Skill 的 references/02-project-architecture.md §2.3 导入规则、assets/scaffold/src/scenes/boot/index.ts。
任务：新增场景 scenes/<name>/index.ts，实现 <玩法>。
约束：
1) 只依赖 three / render / core / assets / config，不 import mini-three-adapter 或 wx；
2) 通过 SceneContext 拿 runtime / renderer / quality，不自行创建画布；
3) 所有订阅与资源登记到 DisposalGroup；
4) 帧回调内不分配新对象；
5) 在 SceneManager 注册 id，并在 docs/compat.md 记录。
验收：check_project.mjs 无 ERROR、typecheck 通过、H5 冒烟能出图。
```

### 排错

```
上下文：references/04-pitfalls.md、runtime.report() 输出、plugin.api.report() 输出。
任务：真机 <症状>，请按「构建期证据 → 启动期证据 → H5 复现分层 → 最小化」定位。
要求：先给出最可能的 3 个根因及各自验证方法，再改代码；不要一上来就改求值顺序或加 installGlobals。
约束：不得破坏 01-adapter-anatomy.md §1.2 的十条不变量。
```

## 13. 升级 mini-three-adapter（0.1.1 → 0.1.7）

本 Skill 旧版基于 0.1.1；0.1.2–0.1.7 的不变量没变，但多处运行时行为与构建产物已修正。升级步骤：

1. `npm i -E mini-three-adapter@0.1.7`，删除 `node_modules/.vite` 缓存后重建；`three` 仍精确锁定。
2. **移除手写能力探测**：删掉 `bootstrap.ts` 里 1×1 `wx.createOffscreenCanvas` 探测与 `capabilities: { webgl2 }` 覆盖，改用适配层探测。判断画质看 `runtime.capabilities.webgl2Source`；`inferred` 的 `false` 不是实测结论，渲染器创建成功才是 WebGL2 可用的权威证据。
3. 求值顺序不变：入口只静态导入适配层，`await createWeChatGameRuntime()` 之后再动态 `import` 场景模块；three 仍必须在独立 chunk。
4. 图片/纹理回归：`TextureLoader` 不应再无限 pending；`texture.image` 应有 `src` 与宽高。直接 `img.src` 的网络大图在 2 秒内没完成会被 watchdog 判失败，改为先 `wx.downloadFile` 或预加载。
5. H5 回归：跑 `npm run h5`（build + preview）。确认 `pointer*` / `wheel` 能驱动 OrbitControls，`canvas.dispatchEvent(new Event(...))` 不再抛只读 `target`；删除「把监听挂到 document」的旧绕过方案。
6. 构建产物检查：Vite 6 下 `vite.config.ts` 不再报 `TS2769`；产物里不应有 `new __m3().` 或 `{ __m3().xxx }` 残留。同时确认 `manualChunks` 的 adapter 规则是 `id.includes('/node_modules/mini-three-adapter/')`——旧脚手架写成不带 `node_modules` 的包名，项目目录含该字符串时会退化成单文件。
7. 启动日志：若出现 `Scoped globals were read before this runtime existed`，用 `getEarlyScopeReads()` 定位并改动态 import；环境全局（`document` 等）已不再因 `typeof` 抛错。
8. 重跑 `check_project.mjs` / `typecheck` / `build` / `smoke` / `check_bundle.mjs`，把 `webgl2Source`、适配层版本写进 `docs/compat.md`。

| 版本 | 与本 Skill 相关的修复 |
| --- | --- |
| 0.1.2 | `new X()` 括号、对象简写改写、图片原生事件桥接、探测 `undefined` 三态 + `webgl2Source` |
| 0.1.3 | 监听器 `this` / `event.target` 指向宿主元素；探测回退按画布身份放弃 |
| 0.1.4 | `reservedCanvases` 候选全集；占位作用域环境全局读作 `undefined`；`getEarlyScopeReads()` |
| 0.1.5 | 图片四级兜底；`src` 数据属性写入；`complete` / `decode()` 语义 |
| 0.1.6 | 图片 watchdog 无条件生效（接受 `onload` 赋值但不调用的宿主也能收敛） |
| 0.1.7 | Browser `nativeEventTarget`（真实 DOM 事件不再被吞）；Vite 6 `transform` 类型修复 |
