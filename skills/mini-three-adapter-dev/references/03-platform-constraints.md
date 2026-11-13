# 03 · 微信小游戏平台约束（官方口径 + 社区实践）

> 标注 `[官方]` 的条目来自微信开放文档（页面标注最后编辑 2026-04-09 / 2026-07-04）；`[官方-旧]` 表示英文版/旧文档口径已过时；`[社区]` 为实践总结，需真机复核。**凡涉及额度，以开发者工具与 MP 控制台当前展示为准。**

## 3.1 运行时本质 `[官方]`

| 事实 | 后果 |
| --- | --- |
| iOS = JavaScriptCore，Android = V8；**无 BOM / DOM**，无全局 `document` / `window` | `document.createElement` 直接抛错；必须由 Adapter 提供 shim |
| 基础库只提供 `wx.*` 与 `setTimeout/setInterval/requestAnimationFrame` | `weapp-adapter`（官方示例适配层）**不是基础库的一部分**，需自行引入；官方明确「模拟远不完整」「供参考、按引擎自行扩展」 |
| 首次 `wx.createCanvas()` 得到唯一上屏画布，之后调用得到的都是离屏画布 | 必须只调用一次并缓存；能力探测优先 `wx.createOffscreenCanvas()`，小游戏只在离屏 API 存在且上屏画布已解析时回退第二次 `createCanvas()`，并做身份校验 |
| 宿主按对象身份保存画布校验数据 | 禁止 Proxy 包装 / 克隆 / 改原型（适配层用就地 `defineProperty`） |
| `Canvas.getContext('webgl2')` 返回标准 WebGL2 上下文 | three ≥ r163 只支持 WebGL2，主线即 WebGL2 |
| `wx.setPreferredFramesPerSecond` 可锁帧 | `createWeChatGameRuntime({ preferredFps })` |
| 从基础库 2.5.0 起支持压缩纹理：iOS pvr、Android etc1 | 高性能模式下 iOS 不支持 ETC/PVRTC，只剩 ASTC/ETC1 |

官方链接：
- Adapter：https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html
- 渲染：https://developers.weixin.qq.com/minigame/dev/guide/base-ability/render.html
- JS 支持情况：https://developers.weixin.qq.com/minigame/dev/guide/runtime/js-support.html
- 分包加载：https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html
- 多线程 Worker：https://developers.weixin.qq.com/minigame/dev/guide/base-ability/workers.html
- 高性能模式：https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-high-performance.html
- 高性能+模式：https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-high-performance-plus.html

## 3.2 JavaScript 语言限制 `[官方]`

- **禁用动态执行**：`eval` 不支持，`new Function` 不支持（小程序文档补充：`new Function('return this')` 除外）。three 本体不用，但部分第三方 shader/表达式库会用 → 选型时排查。
- **语法不能被 polyfill 抹平**：基础库内置 `core-js`，可补标准 API，但语法差异要靠构建工具；用 `async/await` 等高级语法需开启「ES6 转 ES5」或用构建降级。**本 Skill 的对策**：构建 `target: 'es2019'`，并在开发者工具保持 `es6: true` / 关闭 ES6 转 ES5（避免二次转换破坏产物）；真机按最低基础库验证。
- **`Proxy` 在部分低版本客户端不可用**：官方明确「请尽量避免」。→ 业务代码不要用 Proxy；注意适配层仅在其「未初始化占位作用域」内部用了一个 Proxy（`src/scope.ts` 的 `emptyScope`），正常路径（runtime 创建后）不经过它。
- **Promise 时序差异**：iOS 15 及以下 Promise 是 `setTimeout` 模拟的 polyfill，`.then` 被当作普通任务而非微任务；iOS 16+ 正常。→ 不要写依赖「微任务先于 setTimeout」的逻辑，尤其在启动顺序上。
- `core-js` 能补 API，不能补语法；`wx.canIUse()` 做能力保护。

> ⚠️ **ESM / 动态 import 的口径冲突**：官方文档未明文禁止 ESM（melonJS 官方适配指南示例就用 `import` 从 `game.js` 加载模块），但社区实践（多套脚手架）报告「动态 import 在真机失败」。**本 Skill 的对策**：产物格式定为 **CommonJS 分包**——`output.format: 'cjs'`，three 独立成 chunk，入口在 runtime 就绪后 `require` 场景 chunk。小游戏模块系统本身就是 CommonJS，`require()` 必定可用，不拿 ESM `import()` 去赌基础库差异。
>
> 早期版本用 `inlineDynamicImports: true` 打单文件「保住求值顺序」，**那是错的**：它只是把 `import()` 变成已求值模块的 `Promise` 包装，模块体仍在脚本求值阶段执行（实测：入口在偏移 60k，three 顶层 `window.__THREE__` 在 479k）。真机/模拟器表现为 `Scoped global "__THREE__" was read before a runtime was created`，随后 `Cannot read properties of undefined (reading 'GameApp')`。

## 3.3 包体与分包 `[官方，2026-04 口径]`

| 限制 | 当前值 |
| --- | --- |
| 主包 | ≤ 4 MB |
| 主包 + 全部分包合计 | ≤ 30 MB |
| 单个普通分包 | 不限制大小 |
| 单个独立分包 | ≤ 4 MB |
| 开放数据域目录 | **不能**设为分包或放在分包下 |

`[官方-旧]` 英文版文档仍写「总包 8MB / 单个分包 4MB」，部分旧引擎文档写 20MB；适配层 `docs/06` 也沿用 4MB/8MB。**以控制台当前额度为准**。

- `wx.loadSubpackage()`：下载 + **自动执行**代码；返回 `LoadSubpackageTask`，可 `onProgressUpdate`。
- `wx.preDownloadSubpackage()`（基础库 3.4.9+）：**只下载不执行**，之后仍需 `wx.loadSubpackage()` 执行。
- 老客户端由后台编译整包兼容包；基础库 < 2.1.0 无 `loadSubpackage`，需用 `require('stage1/game.js')`。
- 引用规则：分包 A 不能 require 分包 B 的 JS / 用 B 的资源；可引用主包与自身。

## 3.4 Worker / WASM `[官方]`

- `game.json` 的 `workers` **只支持一个目录**，目录内只能放 JS 文件，其他静态资源必须放目录外。
- 可配置为分包：`{ "workers": { "path": "workers", "isSubpackage": true } }`。基础库 2.27.3+（另有文档写 2.0.10）起，分包 worker 必须先 `wx.preDownloadSubpackage({ packageType: 'workers' })`，成功后再 `wx.createWorker()`。
- **Worker 最大并发数 = 1**。创建下一个前必须 `Worker.terminate()`。
- Worker 内不支持 `wx.*` API，不能 require 目录外文件，Worker 之间不能互发消息；数据通过 `postMessage` **拷贝**传递（不支持 SharedArrayBuffer / Transferable）。
- `WXWebAssembly`：基础库 2.13.0+，Worker 内 2.15.0+；支持 `.wasm` 与 `.wasm.br`（Brotli 是官方推荐减包手段）。

→ 对 3D 项目的直接含义：DRACOLoader / KTX2Loader 的 decoder 很可能用 Worker，**同一时刻只能跑一个 decoder 管线**；所有 wasm/worker 必须输出到同一个 `outputDir`。

## 3.5 网络与资源加载 `[官方 + 社区]`

| 约束 | 处理 |
| --- | --- |
| `wx.request` / `wx.downloadFile` 需配置合法域名，HTTPS、ICP 备案、TLS 1.2+，协议+域名+端口精确匹配 | MP 后台「开发管理 → 开发设置 → 服务器域名」；开发期可临时勾选「不校验合法域名」，上线前必须去掉 |
| `file://` 显式禁用 | 不要拼本地绝对路径 |
| **包内相对路径资源不能 `fetch`/XHR 直接读** | 用 `wx.getFileSystemManager().readFile()`；或把资源放 CDN |
| `wxfile://` / `wx.downloadFile` 的 `tempFilePath` 仅本次会话有效 | 需要持久化就存到 `wx.env.USER_DATA_PATH` |
| `wx.loadFontFace` 只接受 HTTPS URL 或 Data URL，本地路径真机失败 | 字体子集化后走 Data URL / HTTPS；Canvas 2D 用 `canvas.loadFont` + USER_DATA 本地文件（两条独立管线） |
| 安卓加载分包内字体存在历史 bug | 字体放主包或走 HTTPS |

→ 适配层的 `fetch`/`XMLHttpRequest` polyfill 是 `wx.request` 桥接，因此 **three 的 FileLoader / TextureLoader 同样受合法域名约束**；`Blob` 对象 URL 被转成 `mini-three-blob:` → `data:` URI（微信图片加载器只认 `data:` / 本地路径）。

## 3.6 iOS 高性能 / 高性能+ `[官方]`

### 高性能模式（`iOSHighPerformance: true`）

- 独立进程运行，JS 有编译加持，性能大幅提升（官方水族馆用例：iPhone 11 Pro Max 12000 条鱼 10~15fps → 48~50fps）。
- **必须开启严格模式**：原本 `SaxO = {}` 这类隐式全局会抛 `ReferenceError`，常见表现为「卡在 loading 界面」。建议 `game.js` 一开始就创建 canvas + `getContext` 触发 loading 消失。
- **内存硬顶**：2G RAM 机型（6s/7/8）约 **1G**；3G+ 机型约 **1.4~1.5G**，官方建议安全峰值 **1.2~1.3G**。
- 渲染差异：iOS 14 抗锯齿限帧问题（可试 `antialias:true`）；iOS 14.0~15.3 共享 vertex/index buffer 性能问题；**iOS 15 起才支持 WebGL2，且 15.0/15.1 的 WebGL2 基本不可用（黑屏/花屏），建议判断 ≥ iOS 15.5 再开启**；`stencil` contextAttribute 对齐 Web 标准，图片空白时检查。
- 高性能模式下调试器只能拿到 fps，DrawCall / Memory 数据不准，需用引擎自带面板。
- 要求微信 ≥ 8.0.18、iOS ≥ 14；**业务代码仍需兼容普通模式**。

### 高性能+（`iOSHighPerformance+: true`）

- 保留独立进程，但把渲染挪回微信进程：GPU 使用率约降 30%、进程内存降 100~150MB、**iOS 全版本支持 WebGL2**。
- 需先开通高性能模式；微信 ≥ 8.0.45、iOS ≥ 14；iOS 14 需客户端 ≥ 8.0.49 才支持 WebGL2，否则回退高性能模式。
- 官方当前对 Unity 快适配 / Cocos / LayaAir 适配较好，**其他引擎（含 Three.js 自建）建议充分真机验证后发布**。
- 已知坑：首屏花屏 → `texImage2D` 的 internalformat/format 统一用 **RGBA**（RGB 有 bug）。
- 可用 `GameGlobal.isIOSHighPerformanceModePlus` 判定。

→ 对 Three.js 项目的实操建议：默认 `iOSHighPerformance: false`、`iOSHighPerformance+: false`；真机验证 WebGL2 与内存后，再评估开启高性能+。开启后重点检查纹理格式与内存峰值。

## 3.7 生命周期、输入与 UI 适配 `[官方 + 社区]`

- 入口是 `game.js` + `game.json`（不是小程序的 `app.js` / `app.json`）；`project.config.json` 需 `compileType: "game"`。
- `wx.onShow` / `wx.onHide` 暂停/恢复帧循环与音频；`wx.getLaunchOptionsSync` / `getEnterOptionsSync` 取启动参数（分享、场景值）。
- 触摸：`wx.onTouchStart/Move/End/Cancel` 及对应 `off*`；必须处理 `touchcancel`（多指状态机归零）。适配层已桥接成 `pointer*`/`mouse*`/`click`。
- 音频：`wx.createInnerAudioContext()` / `wx.createWebAudioContext()`；**首次播放需用户交互触发**；切后台自动暂停，某些 iOS 版本需在 onShow 重建 AudioContext。
- UI 适配：`wx.getWindowInfo()` 的 `safeArea` 避刘海与底部横条；`wx.getMenuButtonBoundingClientRect()` 拿右上角胶囊位置（可能返回 null/尺寸异常，需容错与降级），HUD 不要写死右上角坐标。
- 开放数据域（排行榜）：独立目录、`wx.getOpenDataContext().postMessage()` 通信，**不能访问主域变量 / DOM**，目录不能设为分包。
- 错误与内存：`wx.onError`、`wx.onUnhandledRejection`、`wx.onMemoryWarning`；`wx.triggerGC` 在 iOS 高性能模式相关。
- 更新：`wx.getUpdateManager()` 处理版本更新（`onUpdateReady` → `applyUpdate()`）。
- 调试：开发者工具模拟器与真机差异大（尤其 GPU / 触摸 / 字体）；真机重点测中低端安卓帧率与 iOS 内存峰值。

## 3.8 发布合规 `[社区，政策会变，上线前查最新规范]`

- 小游戏类目 / 版号 / 软著要求；个人主体类目有限。
- 涉及内购或虚拟支付通常需要资质与版号；隐私协议、内容安全（UGC 检测接口）。
- 禁止诱导分享（「分享才能复活」）。
- JS 明文可反编译：不要放密钥；平台提供代码混淆 / 水印工具。

## 3.9 与适配层有关的三条「版本口径 correction」

1. 适配层 `docs/01`、`docs/06` 写「主包/分包各 4MB、总包 8MB」—— 当前中文官方文档是 **主包 4MB / 总包 30MB / 普通分包不限 / 独立分包 4MB**。
2. 适配层 `docs/11` 把 `WXWebAssembly` 标为最低 2.13.0（Worker 内 2.15.0），Worker 分包预下载标 2.0.10 —— 官方 Worker 文档当前写 **2.27.3**。以官方当前文档 + 真机 `wx.canIUse` 为准。
3. 官方 Adapter 页面 2026-04-09 版本**没有**「weapp-adapter 不再维护」这句话（英文 PDF 与部分第三方文章有此说法）。稳妥表述：官方明确它「模拟远不完整、仅供参考、需按引擎自行扩展」，且不属于基础库 —— 这正是使用 `mini-three-adapter` 这类专用适配层的理由。

## 3.10 能力探测口径（适配层 0.1.7）

- 顺序：离屏 `createOffscreenCanvas` 实测 → 主画布第二次 `createCanvas` 实测（仅小游戏、仅离屏 API 存在、上屏画布已解析）→ 基础库版本推断。
- 主画布回退前用 `reservedCanvases`（本次画布 + 缓存 + `GameGlobal.screencanvas` + `globalThis.canvas`）逐个比对身份；命中任一就放弃，避免 `getContext` + `WEBGL_lose_context` 废掉上屏画布。
- 结果看 `capabilities.webgl2Source`：`probe` / `inferred` / `override`。**`inferred` 的 `false` 是猜测，不是设备结论**；渲染器创建成功才是权威证据。
- 业务不要手写 1×1 离屏探测再覆盖 `capabilities`；确有需要时显式传 `capabilities.webgl2`，此时来源为 `override`。
