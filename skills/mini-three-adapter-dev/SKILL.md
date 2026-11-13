---
name: mini-three-adapter-dev
description: 辅助 AI 使用 mini-three-adapter（github.com/hmtx1024/mini-three-adapter，作用域化 shim + 构建期 AST 重写的 Three.js 适配层，目标版本 0.1.7）搭配 Three.js 开发微信小游戏 / 小程序 / H5 三端 3D 项目。适用于新建工程脚手架、接入 createWeChatGameRuntime、动态 import 求值顺序、miniThree() 构建插件配置、RuntimeOptions 与 rendererHints、webgl2Source 能力判定、触摸与 resize 接线、图片纹理事件桥接、DRACO/KTX2 decoder 与分包、game.json 配置、性能与包体优化、真机排错。当用户提到 mini-three-adapter、createWeChatGameRuntime、MiniThreeRuntime、rendererHints、webgl2Source、__m3()、mini-three-assets.json、getActiveScope、getEarlyScopeReads、小游戏黑屏/白屏/触摸失效/纹理加载不出/包体超限时触发。
agent_created: true
version: "1.2.0"
---

# mini-three-adapter + Three.js 微信小游戏辅助开发

## 概述

把「微信小游戏平台硬约束」+「mini-three-adapter 适配层实现」+「可维护工程架构」固化成 AI 可直接执行的开发规范。附带：7 份参考文档（`references/`）、可复制的完整工程脚手架（`assets/scaffold/`）、3 个校验脚本（`scripts/`）。

> 本文中的 `<SKILL_DIR>` 指本 `SKILL.md` 所在目录（即包含 `references/`、`assets/scaffold/`、`scripts/` 的目录）。命令可在任意工作目录执行，传入绝对路径即可。

**目标适配层版本**：`mini-three-adapter@0.1.7`（2026-11-13）。0.1.2–0.1.7 修复了图片事件桥接、能力探测回退、`new`/对象简写改写、H5 原生事件被吞等 P0/P1 缺陷；旧版本可运行，但本 Skill 的行为描述以 0.1.7 为准，`check_project.mjs` 会对 <0.1.7 给出升级告警。
**适用**：基于 `mini-three-adapter` 的微信小游戏（主）、微信 `<canvas type="webgl2">` 小程序、H5 双端；Vite / Rollup + TypeScript + `three >= 0.163`（脚手架锁定 `0.187.0`）。
**不适用**：未使用 `mini-three-adapter` 的项目、Cocos / Laya / Unity 导出项目、纯 WebView 套壳、依赖完整 DOM/CSS 的 UI 框架、`three/webgpu` + TSL/NodeMaterial 项目。

## 首要动作：确认项目边界与运行形态（**必做**）

本 Skill 自包含，只服务 `mini-three-adapter` 这一套 API。动手前先读项目 `package.json` 的 `dependencies` 与入口文件，确认以下三项，**不要凭猜测写代码**：

| 检查项 | 期望结果 | 不符时怎么办 |
| --- | --- | --- |
| 适配层依赖 | 存在 `mini-three-adapter`（目标 `0.1.7`），且入口使用 `createWeChatGameRuntime` / `MiniThreeRuntime` / `rendererHints` | 若项目用的不是本适配层，本 Skill 不适用；按项目自身文档接入，不要套用本文的任何 API 或配置。低于 0.1.7 先看 `references/05-workflows.md` §13 |
| three 版本 | `>= 0.163.0`（WebGL2 唯一主线），建议精确锁定（脚手架 `0.187.0`） | 先升级 three，再按 `references/05-workflows.md` §8 复核全局与 DOM 依赖 |
| 目标形态 | 微信小游戏 / 微信小程序 / H5 | 决定 runtime 工厂与触摸接线方式，见 `references/01-adapter-anatomy.md` §1.7 |

常见确认信号：`__m3()`（构建期注入的作用域访问器）、`mini-three-assets.json`、`runtime.report()` 中的 `WebGL2 source`、`getEarlyScopeReads()`、`game.json` 中的 `workers` / `subpackages`。
确认后先读 `references/01-adapter-anatomy.md`，再按任务类型加载对应参考文件（见文末索引）。

## 硬性规则（生成 / 修改 / 审查代码时逐条满足）

1. **求值顺序是生命线**：入口 `main.ts` 只静态导入适配层，先 `await createWeChatGameRuntime()`，再 `await import('./app/GameApp.js')` 让 three 求值。禁止在入口静态 `import * as THREE from 'three'`，禁止把 createRuntime 放进被 three 依赖的模块。
2. **产物必须是「CommonJS + 真分包」**：`output.format: 'cjs'` + `entryFileNames: 'game.js'` + `chunkFileNames: 'chunks/[name]-[hash].js'`，three / adapter 各自独立 chunk，入口在 `createWeChatGameRuntime()` 之后才 `require` 场景 chunk。**禁止 `inlineDynamicImports: true`**：它并不保留惰性，Rollup 只把 `import()` 变成已求值模块的 `Promise` 包装，three 顶层的 `window.__THREE__` 探测照样在脚本求值阶段执行。入口与 chunk 共用的模块（`src/config/`、`src/core/`）必须用 `manualChunks` 单独拆出，否则 chunk 会反向 `require('../game.js')` 成环。
3. **插件必须装配且选项是扁平的**：`import miniThree from 'mini-three-adapter/vite'`。`MiniThreePluginOptions` 直接继承 `AssetOptions`，正确写法是 `miniThree({ outputDir: 'assets/three', brotli: true, roots: [...] })`。**上游 README / 部分示例里的 `assets: { ... }` 嵌套写法是无效配置**（`src/build/plugin-core.ts` 只读顶层字段），照抄会静默失效。
4. **唯一上屏画布**：业务代码绝不调用 `wx.createCanvas()`。额外画布一律 `runtime.createCanvas(w, h, type)` 或 `document.createElement('canvas')`。能力探测由适配层完成：优先 `createOffscreenCanvas`；小游戏仅在离屏 API 存在且上屏画布已解析时才回退第二次 `createCanvas()`，并用 `reservedCanvases` 逐个做对象身份校验；小程序不回退。**不要手写 1×1 离屏探测再覆盖 `capabilities`**（0.1.1 时代的 workaround，会掩盖 `webgl2Source` 的语义）。
5. **渲染器三件套**：`new THREE.WebGLRenderer(runtime.rendererHints)` → `setPixelRatio(runtime.windowInfo.pixelRatio)` + `setSize(w, h, false)` → `outputColorSpace = THREE.SRGBColorSpace`；帧循环用 `renderer.setAnimationLoop()`（不要裸 `requestAnimationFrame` 递归）。
6. **生命周期全接线**：`runtime.on('resize' | 'visibilitychange' | 'contextlost' | 'dispose')`。`dispose` 里必须 `setAnimationLoop(null)`、`controls.dispose()`、`geometry/material/texture.dispose()`、`renderer.dispose()`。切后台暂停循环、回来恢复。
7. **WebGL2 唯一主线**：`three >= 0.163`，`defaultContextType` 保持 `'webgl2'`，`pixelRatioCap` 默认 2。禁止 `three/webgpu`；插件 `webgpu: 'warn'`（或 `'error'` 强制拦截）。判定能力看 `capabilities.webgl2Source`：`probe`=实测、`inferred`=按基础库推断、`override`=调用方覆盖；**`inferred: false` 只是猜测，不是「不支持」**，渲染器创建成功才是权威证据。
8. **零全局污染**：不写 `globalThis.window = ...`。只有无法被插件改写的三方库才显式 `createWeChatGameRuntime({ installGlobals: true })` 或 `runtime.installGlobals()`，且它是可逆的逃生舱。插件默认只改写 `node_modules` 里的三方生态代码，业务代码里裸写 `window` 不会自动改写。runtime 创建前的占位作用域把 `document/navigator/screen/location/history` 读作 `undefined`（`typeof` 不再抛错），其余真实 API 仍抛错；早读会被记录并由 runtime `warnOnce` 汇总，`getEarlyScopeReads()` 可显式查询。
9. **对象身份不可破坏**：禁止 `new Proxy(canvas)`、`Object.setPrototypeOf`、克隆画布/图片。适配层用就地 `Object.defineProperty` + `Symbol.hasInstance` 注册表；任何包装都会破坏宿主内部按对象身份保存的校验数据。H5 的真实 `HTMLCanvasElement` 由 0.1.7 的 `nativeEventTarget` 保护：事件方法、`style`、`getBoundingClientRect` 等保持原生，业务不要再去 patch 它。
10. **资源与分包**：decoder 路径必须与 `mini-three-assets.json` 的 `decoderPaths` 一致（如 `draco.setDecoderPath('assets/three/')`）；worker 与 wasm 只能放**同一个** `outputDir`；worker 分包要先 `wx.preDownloadSubpackage({ packageType: 'workers' })` 再 `wx.createWorker()`，且并发上限 1。图片事件桥接带 **2 秒 watchdog**：包内 PNG/JPEG 正常，直接 `img.src` 加载的慢网络大图会先 `wx.downloadFile` 或预加载，否则会被判失败。
11. **包体预算**：主包 ≤ 4MB、主包+分包合计 ≤ 30MB（2026-04 官方口径，旧文档写 8MB/20MB，**以开发者工具与控制台当前额度为准**）。three 本体、wasm、模型纹理优先切到分包或 CDN。
12. **本地包内资源不能 `fetch`**：包内静态文件要用 `wx.getFileSystemManager().readFile()`；远程资源走 HTTPS 且域名必须加入后台 `request` / `downloadFile` 合法域名（含 ICP 备案、TLS 1.2+），`file://` 被禁止。
13. **不要手动改 three 源码 / 不要猴补丁 `WebGLRenderer.render`**：平台差异由适配层显式、可关闭地处理（如 `normalizeWebGL`）；PMREM 黑贴图等深度问题在应用层显式 `renderer.clearDepth()`。
14. **语法与运行限制**：构建 `target: 'es2019'`（消除 `?.` / `??` 触发的开发者工具语法错误）；小游戏禁用 `eval` / `new Function`；低版本客户端慎用 `Proxy`；iOS 15 及以下 Promise 是 `setTimeout` polyfill，时序与标准不同。

## 标准工作流

### A. 新建项目

```bash
node <SKILL_DIR>/scripts/new_project.mjs <目标目录> --name my-game --appid <wx-appid>
cd <目标目录> && npm install && npm run check
# 用微信开发者工具（小游戏模式）打开该目录，miniprogramRoot = dist/
node <SKILL_DIR>/scripts/check_project.mjs <目标目录>
node <SKILL_DIR>/scripts/check_bundle.mjs <目标目录>/dist
npm run h5   # build + preview，验证同一份场景代码在浏览器里出图
```

脚手架已固化：分层目录、CJS 分包构建、runtime 隔离层、资源清单、释放组、生命周期、分包预下载、能力报告（含 `webgl2Source`）。详细分层理由见 `references/02-project-architecture.md`。
`npm run check` = typecheck + build + postbuild + **smoke**（在 Node 里伪造 wx 宿主跑产物，验证「先 runtime 后 three」的求值顺序与 chunk 延迟加载，不必开 IDE）。`npm run h5` 走 **build + preview**，不是 `vite dev`：AST 重写只在构建期生效，dev server 下 three 会读到未激活的作用域全局。

### B. 接入已有项目

按 `references/05-workflows.md` §2 执行：装依赖（`mini-three-adapter@0.1.7`）→ 配插件 → **改造入口为动态 import** → 替换 renderer 创建 → 接线事件 → 校验 `game.json` → 跑 `check_project.mjs` → H5 冒烟 → 真机验收。
若是从 0.1.1 升级，按 `references/05-workflows.md` §13 逐项复核：移除手写能力探测、确认 H5 原生事件、回归图片纹理与 `webgl2Source`。

### C. 排错

先拿三份机器可读证据，再动手改代码：

- 运行期：`console.log(runtime.report())`；把 `runtime.capabilities`（含 `webgl2Source`）与 `getEarlyScopeReads()` 附到 issue。
- 构建期：`plugin.api.report()`（关注 `parseFailures`、`missingAssets`、`webgpuWarnings`），以及 `dist/mini-three-assets.json`。
- 图片/纹理：看 `image-native-events` / `image-events-timeout` 告警的 `reason` 与宿主形状 payload（`onload` 形态、`addEventListener`、`getImageInfo`）。

症状 → 根因 → 处理见 `references/04-pitfalls.md`；真机验收清单见 `references/06-checklists.md`。

## 反向模式（直接拒绝）

| 反模式 | 正确做法 |
| --- | --- |
| 「在 `globalThis` 上补个 `window` 就好」 | `MiniThreeScope` + 显式可逆 `installGlobals()` |
| 「正则把 `window` 全替换」 | 插件的 Babel `path.scope.hasBinding` 作用域分析 |
| 「Proxy 包一层 canvas / 改原型」 | 就地 `defineProperty` + `Symbol.hasInstance` |
| 「探测能力时调 `wx.createCanvas()`」 | `wx.createOffscreenCanvas()`（唯一上屏画布不能被偷走） |
| 「把 three 打进适配层」 | `three` 保持 optional peer + external |
| 「静态 import three 后用 `installGlobals` 兜一下」 | 改成动态 import，让作用域先就绪 |
| 「用 `inlineDynamicImports: true` 打单文件保住求值顺序」 | CJS + 真分包：`import()` 不会被真正延迟，three 必须在独立 chunk 里 |
| 「chunk 反向 `require` 入口也无所谓」 | `manualChunks` 把共享模块拆出，环形依赖会真机报未定义 |
| 「`id.includes('mini-three-adapter')` 就是拆 adapter」 | 必须带 `/node_modules/` 前缀，否则项目目录名会命中，所有模块进同一组、退化成单文件 |
| 「照抄 README 的 `assets: {}` 插件配置」 | 扁平选项：`outputDir` / `brotli` / `roots` / `manifest` |
| 「WebGPU 不支持就 try/catch 回退」 | 用 WebGL 构建目标，`webgpu` 策略只做告警/拦截 |
| 「自己用 1×1 离屏画布探测 WebGL2，再覆盖 capabilities」 | 适配层已按离屏→主画布回退→版本推断三级处理，用 `webgl2Source` 读来源 |
| 「`webgl2Source` 是 `inferred` 且为 false，就当设备不支持」 | 推断不是实测；渲染器创建成功即 WebGL2 可用，必要时显式传 `capabilities.webgl2` |
| 「H5 上再给 canvas 包一层事件系统」 | 0.1.7 起真实 canvas 由 `nativeEventTarget` 保护，浏览器原生派发；不要 patch |
| 「用 `vite dev` 预览 H5」 | 用 `npm run h5`（build + preview），AST 重写只在构建期生效 |
| 「网络大图直接 `img.src`，等它慢慢加载」 | 2 秒 watchdog 会判失败；先 `wx.downloadFile` 到本地或预加载 |

## 参考文件索引（按需加载，不要一次全读）

| 文件 | 何时读 |
| --- | --- |
| `references/01-adapter-anatomy.md` | 首次接触适配层、查 API 签名、理解两阶段模型 |
| `references/02-project-architecture.md` | 设计目录结构、分层边界、升级与演进策略 |
| `references/03-platform-constraints.md` | 确认平台能力/限制/官方口径/版本号 |
| `references/04-pitfalls.md` | 出现黑屏、触摸失效、包体超限、构建报错 |
| `references/05-workflows.md` | 执行具体任务（加载模型、后处理、多指、升级 three、分包） |
| `references/06-checklists.md` | 交付前自查、真机验收、发布前门禁 |
| `references/07-code-recipes.md` | 需要可直接复制的代码片段 |

## 附带工具

| 脚本 | 用途 |
| --- | --- |
| `<SKILL_DIR>/scripts/new_project.mjs <dir>` | 从 `assets/scaffold/` 生成新工程，替换项目名/AppID |
| `<SKILL_DIR>/scripts/check_project.mjs <dir>` | 静态校验硬规则（含适配层版本、构建形态、产物 chunk 形态、环形依赖），输出可执行的修复建议 |
| `<SKILL_DIR>/scripts/check_bundle.mjs <dist>` | 统计产物体积，校验「three 在独立 chunk」，对照 4MB 主包预算并给出分包建议 |

`check_project.mjs` 与 `check_bundle.mjs` 支持 `--json`，便于 CI 与 AI 直接消费结果；`new_project.mjs` 只接受 `--name` / `--appid` / `--force`。

### 脚手架验证记录

在 Node 24.9 / Vite 6.4.6 / `three@0.187.0` / `mini-three-adapter@0.1.7` 下实测通过：

- `tsc --noEmit` 零错误；`vite build` 成功，产物为 `game.js`（1.3 KB）+ `chunks/{three,adapter,GameApp,shared}.js`（合计 0.58 MB / gzip 约 156 KB）。
- 构建报告 `3 modules scanned / 2 rewritten / 69 references -> scope`；产物中 `__m3` 被压缩为 `Ve()`，`getActiveScope` 调用生效，**裸 `window.` 引用数为 0**。
- `runtime.report()` 显示 `WebGL2 source: inferred`（smoke 的假宿主探测不到，但基础库 3.0.0 推断为 true），不再需要脚手架手写 1×1 探测；日志无 `Scoped globals were read before this runtime existed`。
- 入口只有 `require("./chunks/...")`，`GameApp` chunk 在 `wx.createCanvas` / `wx.createOffscreenCanvas` 探测与 runtime 创建之后才被 require：`npm run smoke` 三项全部 PASS（无作用域早读、chunk 延迟加载、渲染器阶段已到达）。
- `npm run h5:build` 通过（26 modules transformed，H5 产物含 `assets/index-*.js` + `assets/GameApp-*.js`）。
- `check_project.mjs` 0 error（仅 1 条开发期域名校验 WARN）、`check_bundle.mjs` PASS。
- 反向验证：把 `manualChunks` 的 adapter 规则改回 `id.includes('mini-three-adapter')` 后（当前仓库路径恰好含该字符串），产物退化为单个 ~601 KB 的 `game.js`，`check_project.mjs` 报 `BROAD_ADAPTER_CHUNK` + `NO_CHUNKS_IN_DIST` —— 这正是 `Scoped global "__THREE__" was read before a runtime was created` 的成因。`inlineDynamicImports: true` 同样会退化，见 `04-pitfalls.md` A11。

## 完成定义（每次改动后）

- [ ] 依赖精确锁定 `mini-three-adapter@0.1.7` / `three@0.187.0`
- [ ] `node <SKILL_DIR>/scripts/check_project.mjs <项目目录>` 无 ERROR（`ADAPTER_OUTDATED` 为空）
- [ ] `npm run typecheck` 与 `npm run build` 通过，产物是 `game.js` + `chunks/*.js`（three 在独立 chunk，入口 < 400 KB）
- [ ] `npm run smoke` 通过：无 `Scoped global ... was read before a runtime was created`，场景 chunk 确实延迟加载
- [ ] `npm run h5:build` 通过；H5 冒烟里 `pointer*` / `wheel` 直接驱动 OrbitControls（0.1.7 原生事件）
- [ ] 构建日志中 `parseFailures` 为空、`missingAssets` 已确认或白名单化；产物无 `new __m3().` / `{ __m3().xxx }`
- [ ] `game.json` 已合并 `mini-three-assets.json` 的 `gameJsonSuggestion`
- [ ] 纹理在 2 秒 watchdog 内加载；网络大图已改为 `wx.downloadFile` / 预加载
- [ ] 真机验证 WebGL2 出图、多指触摸、横竖屏、前后台恢复（见 `06-checklists.md`）
- [ ] 保存 `runtime.report()`（含 `webgl2Source`）到项目 `docs/compat.md`，形成机型/基础库回归记录

> 知识来源：上游仓库 `hmtx1024/mini-three-adapter@0.1.7` 的 `AGENTS.md` / `llms.txt` / `CHANGELOG.md` / `docs/01–11` / ADR-0001–0010，以及微信开放文档（2026-04 版）与社区实践。全部结论已提炼进本 Skill 自带的 `references/`、`assets/scaffold/` 与 `scripts/`，**不依赖任何外部 Skill，也不依赖某个本地工作区路径**，可单独安装使用。需要核对 API 细节时，以项目中已安装的 `mini-three-adapter` 包内 `src/**` / `docs/04-api-reference.md` 为准；文档与源码冲突时**以源码为准**（上游 README 与 `docs/07` 仍有 `assets:{}` 嵌套配置错误，`docs/07` 的 `lib.formats:['es']` 也不适用于小游戏）。
