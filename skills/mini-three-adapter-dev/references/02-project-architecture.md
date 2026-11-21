# 02 · 可维护 / 可持续 / 可重复的 3D 小游戏工程架构

> 目标：让「换一个场景」「升一次 three」「加一个平台」「接一位新同事/新 AI」都只改动可预期的一小片代码，且每次都能用命令验证。

## 2.1 设计原则（按优先级）

| # | 原则 | 落地手段 | 违反它的代价 |
| --- | --- | --- | --- |
| 1 | **适配层单点隔离** | 只有 `src/platform/*` 能 `import 'mini-three-adapter/*'`；全项目对适配层的依赖收敛到 1~2 个文件 | 换适配层/升级大版本要全项目改 |
| 2 | **求值顺序可推理** | `main.ts` 是唯一入口，只依赖适配层；three 及所有场景代码经**一次**动态 import 进入 | 黑屏、`Scoped global "xxx" was read before a runtime was created` |
| 3 | **依赖单向** | `main → app → {core, config, platform, render, assets} → 无上层依赖`；`scenes` 只依赖下层 | 循环依赖、无法单测、tree-shaking 失效 |
| 4 | **单一生命周期** | 一个 `GameApp` 持有 runtime 与 `DisposalGroup`，所有订阅/定时器/资源登记后统一释放 | 切场景内存泄漏、后台继续渲染 |
| 5 | **资源单一数据源** | `assets/manifest.ts` 定义所有资源 id、路径、类型、分包归属；loader 只认 id | 路径散落、分包迁移时全项目改字符串 |
| 6 | **配置与代码分离** | `config/*` 集中环境、能力分级、常量；禁止在场景里硬编码 DPR、decoder 路径、URL | 换环境靠全局搜索替换 |
| 7 | **平台差异在边界消解** | 小游戏/小程序/H5 差异只存在于 `platform/bootstrap.ts` + 各自的构建配置 | 场景代码里到处 `if (isWx)` |
| 8 | **可验证** | `check_project.mjs` + typecheck + build + 真机清单，全部可脚本化 | 靠人肉记忆，AI 每次生成都要重踩坑 |
| 9 | **可观测** | 启动打印 `runtime.report()`；构建保存 `BuildReport`；错误统一上报 | 真机问题只能靠猜 |
| 10 | **预算即约束** | 主包 4MB、总包 30MB 写进 CI 门禁，超了构建失败 | 上线前才发现要重构 |

## 2.2 目录结构（脚手架 `assets/scaffold/` 即此结构）

```
<project>/
├── package.json                 # 依赖锁定 three / mini-three-adapter / vite
├── tsconfig.json                # strict + Bundler 解析 + DOM lib（仅类型）
├── vite.config.ts               # miniThree() 插件 + CJS 分包（three 独立 chunk）
├── game.json                    # 小游戏配置：分包 / workers / 高性能
├── project.config.json          # 开发者工具：compileType=game, miniprogramRoot=dist/
├── scripts/postbuild.mjs        # 拷贝 game.json、校验 manifest、打印清单
├── docs/compat.md               # 机型 / 基础库 / three 版本回归记录
└── src/
    ├── main.ts                  # ★ 唯一入口：只导入适配层 → 建 runtime → 动态 import app
    ├── env.d.ts                 # wx / GameGlobal 最小类型声明
    ├── app/
    │   ├── GameApp.ts           # 应用编排：装配、事件接线、启动、销毁
    │   ├── Loop.ts              # 帧循环封装：delta、fpsCap、暂停/恢复
    │   └── SceneManager.ts      # 场景注册表与切换（切换即释放）
    ├── core/
    │   ├── types.ts             # 共享类型、Scene 契约
    │   ├── EventBus.ts          # 类型化事件总线（业务逻辑通信）
    │   └── DisposalGroup.ts     # 统一释放：Disposer / dispose() / three 资源
    ├── config/
    │   ├── env.ts               # 环境判定、能力分级、特性开关
    │   └── constants.ts         # DPR 上限、decoder 路径、包体预算、URL 前缀
    ├── platform/                # ★ 唯一允许 import 适配层 / wx 的目录
    │   ├── bootstrap.ts         # createXxxRuntime 封装 + report 打印
    │   ├── lifecycle.ts         # onShow/onHide/onError/onMemoryWarning 接线
    │   ├── device.ts            # 胶囊按钮 / 安全区 / 窗口信息
    │   └── subpackage.ts        # 分包与 workers 预下载
    ├── render/
    │   └── Renderer.ts          # WebGLRenderer 创建、resize、上下文丢失恢复
    ├── assets/
    │   ├── manifest.ts          # ★ 资源清单（单一数据源）
    │   └── loaders.ts           # GLTF/DRACO/KTX2/Texture loader 工厂
    └── scenes/
        ├── boot/index.ts        # 首屏场景（最小可运行）
        └── <feature>/index.ts   # 按玩法/关卡分目录，一个场景一个契约
```

**为什么这样分层**：`platform/` 是「防腐层」（anti-corruption layer）。适配层版本升级、换平台、换 H5 宿主，只改这一层；`app/`、`scenes/`、`render/` 只认 `MiniThreeRuntime` 类型与自研 `core/` 契约。`assets/` 让分包调整变成改一张表，而不是全局搜索路径。

## 2.3 依赖与导入规则（写进 lint / 代码评审）

```
main.ts          → platform/bootstrap, config/env            （禁止 three / 适配层以外运行时依赖）
platform/*       → mini-three-adapter/*, wx, config/*, core/types
app/*            → core/*, config/*, platform/*, render/*, assets/*, scenes/*
render/*         → three, core/*, config/*
assets/*         → three/addons, config/constants
scenes/*         → three, render/*, core/*, assets/*, config/*
core/*           → 无外部依赖（纯 TS，可在 Node 单测）
```

- **禁止** `core/` 依赖 `three` 或 `wx`：保证纯逻辑可在 Vitest / Node 里跑。
- **禁止** `scenes/` 直接 `import 'mini-three-adapter/*'`：运行时对象通过参数注入（`SceneContext`）。
- **禁止** 任何文件静态 `import three` 且被 `main.ts` 静态可达。判定方法：从 `main.ts` 出发画静态 import 图，图上出现 `three` 即违规。
- `import type` 不产生运行时求值，可以跨层使用（如 `import type { MiniThreeRuntime }`）。

## 2.4 生命周期契约

```
main.ts
  └─ bootstrap()                       # 唯一一次 createRuntime
       ├─ runtime.report() → 日志/上报
       └─ await import('./app/GameApp.js')   # 此后 three 才求值
            └─ new GameApp(runtime, deps)
                 ├─ DisposalGroup 登记所有订阅 / loader / 资源
                 ├─ SceneManager.mount('boot')
                 ├─ Loop.start()             # setAnimationLoop
                 └─ 事件接线：
                      runtime.on('resize')            → renderer.resize + camera.aspect
                      runtime.on('visibilitychange')  → Loop.pause / resume
                      runtime.on('contextlost')       → 重建 GPU 资源
                      runtime.on('dispose')           → 全量释放
                      wx.onMemoryWarning              → 释放缓存 / 降 DPR
退出 / 场景切换
  └─ group.dispose() → runtime.dispose()
```

**三条铁律**：
1. 每一个 `on(...)` / `addEventListener` / `setTimeout` / loader 实例都登记进 `DisposalGroup`。
2. 场景切换用 `SceneManager.switchTo()`，它先释放旧场景的 `DisposalGroup` 再挂载新场景；禁止「直接 `scene.add()` 然后忘记 remove」。
3. `renderer.dispose()` 之前先 `setAnimationLoop(null)`，否则后台残留 rAF。

## 2.5 资源管线（可重复的关键）

1. **清单**：`assets/manifest.ts` 用 `as const` 定义 `id → { url, kind, subpackage? }`。所有代码只引用 id。
2. **构建期**：`miniThree()` 插件扫 three addons 引用，把 decoder/worker/wasm 拷到 `outputDir`（默认 `assets/three`），产出 `mini-three-assets.json`。
3. **配置合并**：`scripts/postbuild.mjs` 读 manifest，把 `gameJsonSuggestion` 输出为 `dist/game.json.suggestion.json`；人工合并到 `game.json`（**插件不会自动改 game.json**）。
4. **运行期**：
   - decoder 路径取 `config/constants.ts` 的 `DECODER_BASE`，必须与 `decoderPaths` 一致。
   - worker 分包：先 `await wx.preDownloadSubpackage({ packageType: 'workers' })`，成功后才 `wx.createWorker()`；并发上限 1，用完 `terminate()`。
   - 包内静态资源：`wx.getFileSystemManager().readFile()`；远程资源：HTTPS + 合法域名白名单。
   - 图片纹理：适配层有 2 秒事件 watchdog；网络大图先 `wx.downloadFile` 到本地路径，不要直接依赖慢 `img.src`。真机 `src` 为数据属性的宿主还不能读 `mini-three-blob:` 对象 URL（GLTF 内嵌贴图），需先转 `data:` 或落盘到 `USER_DATA_PATH`。
5. **释放**：所有 `Texture` / `Geometry` / `Material` / `RenderTarget` 通过 `DisposalGroup.track()` 登记；切场景自动释放。

## 2.6 配置与环境

| 配置 | 位置 | 说明 |
| --- | --- | --- |
| 构建期常量 | `vite.config.ts` + `config/constants.ts` | `outputDir`、CDN 前缀、DPR 上限、fpsCap |
| 运行期开关 | `config/env.ts` | 由 `runtime.capabilities` 推导：低配机型降级（关阴影、降 DPR、减粒子） |
| 平台配置 | `game.json` | `deviceOrientation`、`subpackages`、`workers`、`iOSHighPerformance(+)` |
| 工具配置 | `project.config.json` | `compileType: "game"`、`miniprogramRoot: "dist/"`、`libVersion`、域名校验开关 |
| 机密 / 域名 | 后台 + CI 环境变量 | **绝不**写进代码包（JS 明文可反编译） |

能力分级建议（`config/env.ts`）：读 `runtime.capabilities` → `{ tier: 'low'|'mid'|'high', maxPixelRatio, shadows, maxTextureSize, particleScale }`，场景从 `SceneContext.quality` 读取，不自己去探测 `wx`。

注意 `webgl2Source`：`inferred` 表示按基础库版本推断，`false` 不是实测结论。渲染器（`new THREE.WebGLRenderer(runtime.rendererHints)`）创建成功就是 WebGL2 可用；不要用推断值把画质压到 low，也不要在业务里手写 1×1 离屏探测覆盖 `capabilities`。

## 2.7 状态与通信

- 跨场景状态放 `app/` 的 store（简单对象 + `EventBus`），**不要**挂 `globalThis`。
- 业务事件走 `EventBus<AppEvents>`（类型化），平台事件走 `runtime.on(...)`，两者不混。
- 帧内禁止分配对象 / `new Vector3()`：复用预分配临时量与对象池，减少 GC 抖动（小游戏 JS 引擎对 GC 敏感）。

## 2.8 可观测与错误防线

- 启动：`console.log(runtime.report())`，并把 `runtime.capabilities`（含 `webgl2Source`）上报/落盘到 `docs/compat.md`；`getEarlyScopeReads()` 非空说明有模块求值过早。
- 构建：CI 打印 `plugin.api.report()`，把 `parseFailures.length === 0`、`missingAssets` 白名单作为门禁。
- 运行：`wx.onError` / `wx.onUnhandledRejection` → 统一上报；`runtime.on('error')` 在 0.1.9 仍只有类型、没有生产方，不能当成唯一错误出口。
- 性能：`runtime.frames.fps`、`slowFrameThreshold`、`wx.onMemoryWarning`；真机用开发者工具性能面板 / 小游戏数据助手。
- 埋点带上 `适配层版本 / three 版本 / baseLibraryVersion / webgl2Source / 机型 / tier`，让线上问题可归类。

## 2.9 测试策略（无需真机也能挡住 80% 问题）

| 层次 | 工具 | 覆盖 |
| --- | --- | --- |
| 静态规则 | `<SKILL_DIR>/scripts/check_project.mjs` | 硬规则：求值顺序、插件配置、CJS 分包形态、环形依赖、wx.createCanvas、dispose 接线… |
| 类型 | `tsc --noEmit` | 跨层契约、`SceneContext`、资源 id 字面量 |
| 纯逻辑单测 | Vitest | `core/*`（DisposalGroup、EventBus、Loop、manifest 校验）；注入 mock runtime，不依赖 wx |
| 构建 | `vite build` + `check_bundle.mjs` | three 是否在独立 chunk、包体预算、manifest 完整性 |
| 产物冒烟 | `npm run smoke`（`scripts/smoke.cjs`） | Node 里伪造 wx 宿主加载 dist，验证求值顺序与 chunk 懒加载，无需开 IDE |
| H5 预览 | `createBrowserRuntime()` + `npm run h5`（build+preview） | 同一份 `scenes/` 在浏览器里跑通；**不要用 `vite dev`**，AST 重写只在构建期生效 |
| 真机 | 开发者工具 + iOS/Android 真机 | WebGL2 出图、多指、横竖屏、前后台、内存、decoder（见 `06-checklists.md`） |

**H5 双端是可持续的核心杠杆**：`createBrowserRuntime()` 让 `scenes/` 能在浏览器里跑，意味着大部分业务迭代不需要开微信开发者工具，也不需要真机。

## 2.10 版本与演进策略

| 变更 | 影响面 | 流程 |
| --- | --- | --- |
| 升 three 大版本 | `DEFAULT_GLOBAL_NAMES`（插件）、`patchElement` 属性、addons 路径、`outputColorSpace`、WebGPU 入口 | 先查 Migration Guide → H5 冒烟 → 真机回归 → 更新 `docs/compat.md`；用 `package-lock.json` 锁定，禁止 `^` 漂移 |
| 升 mini-three-adapter | `platform/bootstrap.ts` + 构建配置 | 读 CHANGELOG；跑 `check_project.mjs`；比对 `runtime.report()`（`webgl2Source`）；0.1.7 起移除手写能力探测，0.1.9 起按 `05-workflows.md` §14 回归真机图片事件、删除图片宿主上的 `defineProperty` workaround |
| 升基础库 | `capabilities` / resize / Worker / 高性能模式 | 在 `docs/compat.md` 记录最低基础库；`wx.canIUse()` 做能力保护 |
| 加新平台 | 新增 `platform/bootstrap.<x>.ts` + 对应构建配置 | 实现/复用 `PlatformBinding`；`scenes/` 零改动 |
| 加新场景 | 只加 `scenes/<feature>/` + 在 `SceneManager` 注册 | 走 `Scene` 契约与 `DisposalGroup` |
| 换适配层 | `platform/*` + 构建配置 | 由于有防腐层，业务代码理论上零改动（这正是分层目的） |

**锁定策略**：`three` 与 `mini-three-adapter` 用精确版本（`save-exact`），每次升级走独立 PR + `docs/compat.md` 记录，避免「某次 npm install 后全场黑屏」。

## 2.11 分包策略（默认 → 进阶）

- **默认（必须）**：`game.js`（入口，约 1.3KB）+ `chunks/{three,adapter,GameApp,shared}.js`，格式为 CommonJS。three 压缩后约 543KB、adapter 约 50KB，全部计入主包。
  这不是「优化选项」而是求值顺序的前提：three 必须在 `createWeChatGameRuntime()` 之后才被 `require`，单文件打包做不到。
- **进阶**：主包只放启动与首屏；把模型/纹理、decoder、worker 放进 `game.json` 的 `subpackages`，用 `wx.loadSubpackage()` / `wx.preDownloadSubpackage()` 按关卡加载。
  注意 `manualChunks` 的作用是把模块**分组**，分组只影响 chunk 边界，不会让 chunk 自动变成小程序分包；要真正把体积移出主包，得让 Vite 把产物输出到分包目录并在 `game.json` 声明。
- **预算门禁**：`<SKILL_DIR>/scripts/check_bundle.mjs` 输出各文件体积与占比；主包 > 3.2MB 就应预警（留 20% 余量），> 4MB 直接失败。
- **顺序**：裁剪/压缩 → 动态 import 拆非首屏 → CDN 远程资源 → 最后才分包。分包带来网络异常与加载状态管理成本，不要一上来就分包。

## 2.12 AI 协作约定（让每次生成都一致）

1. 项目根的 `AGENTS.md` 写明：本文件 §2.3 的导入规则、§2.4 生命周期契约、以及「不得破坏求值顺序」。
2. 要求 AI 动手前先回答三问：改动涉及哪些文件？是否触碰求值顺序 / 唯一画布 / 零全局污染？要补哪些校验？
3. 每次生成后必须跑 `check_project.mjs` + `typecheck` + `build`，把结果贴出来。
4. 新场景必须复制 `scenes/boot/index.ts` 的契约模板，不要从零自由发挥。
5. 禁止「先写完再统一修」：求值顺序、dispose、decoder 路径这类硬约束要一次做对。
