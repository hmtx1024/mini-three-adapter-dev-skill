# 04 · 踩坑清单（症状 → 根因 → 处理）

> 分四类：**A 启动/黑屏**、**B 交互/渲染**、**C 构建/包体**、**D 平台/真机**。先拿证据（`runtime.report()` + `plugin.api.report()`），再按表定位。

## A. 启动 / 黑屏 / 白屏

| # | 症状 | 根因 | 处理 |
| --- | --- | --- | --- |
| A1 | `Scoped global "xxx" was read before a runtime was created` | ESM 静态导入先于 `createRuntime()` 求值，three 在模块初始化时读到了占位作用域；0.1.4+ 只有 `TextDecoder` / `HTMLCanvasElement` 这类真实 API 仍抛错，`document` / `navigator` 等环境全局读作 `undefined` | **入口只静态导入适配层**，`await createWeChatGameRuntime()` 之后 `await import('./app/GameApp.js')`；无法改造时用 `installGlobals: true` 兜底 |
| A2 | 真机白屏、无报错，`runtime.report()` 显示 `webgl2: false` | 先看 `webgl2Source`：`inferred` 是基础库版本推断，`false` 可能只是探测不到；`probe` 才是实测 | 检查基础库版本与 iOS 高性能+ 设置；`inferred` 时以渲染器能否创建成功为准；不要试图切 WebGL1，也不要手写探测覆盖 |
| A3 | 二次 `wx.createCanvas()` 后画面不显示 | 第一次调用才是上屏画布，后续都是离屏 | 业务代码删除所有 `wx.createCanvas()`；额外画布用 `runtime.createCanvas()` / `document.createElement('canvas')` |
| A4 | 「把动态 import 改成静态 import 后一切正常编译，但真机黑屏」 | 求值顺序被破坏（同 A1），H5 可能碰巧能跑（真实 window 存在），小游戏不行 | 恢复动态 import；并确认 three 在独立 chunk（见 A11） |
| A5 | `game.js` 顶层同步访问 `wx.getSystemInfoSync()` / canvas 崩溃 | 小游戏启动时部分配置尚未就绪（社区实测，官方文档未写） | 入口用 `setTimeout(..., 0)` 或延迟 1~2 帧再 bootstrap；脚手架 `main.ts` 已内置 |
| A6 | 开发者工具 `Unexpected token` / `?.` 报错 | 产物含较新语法 | 构建 `target: 'es2019'`；必要时开发者工具开启「将 JS 编译成 ES5」（注意与适配层产物的兼容性） |
| A7 | 卡在启动 loading 界面（高性能模式） | 严格模式下隐式全局赋值抛错，`game.js` 未执行到渲染 | 全项目严格模式；`game.js` 一开始就创建 canvas + `getContext` 触发 loading 消失 |
| A8 | `canvas.getContext('webgl2')` 返回 null | 基础库过旧 / 设备不支持 / 上下文被别处先以 `2d` 取走 | 检查 `runtime.capabilities`；不要预先对上屏 canvas 调 `getContext('2d')`；`cacheContexts` 保持 true |
| A9 | `wx.createImage` 不存在导致报错 | 旧基础库 | 适配层回退 `OffscreenCanvas.createImage()`；仍失败则升级基础库、传 `createImage` 选项或注入自定义 `PlatformBinding` |
| A10 | 上屏画布被「封面图/加载页」先 `getContext` 占用 | 同一 canvas 同类型 `getContext` 只返回同一个上下文，属性在首次调用时锁定 | 加载页用独立离屏 canvas 或 `runtime.createCanvas()`，不要动上屏画布 |
| A11 | 控制台先报 `Scoped global "__THREE__" was read before a runtime was created`，紧接着 `TypeError: Cannot read properties of undefined (reading 'GameApp')` | 产物被 `inlineDynamicImports: true` 打成单文件：Rollup 不保留惰性，three 顶层语句仍在脚本求值阶段执行，脚本中断后 `GameApp` 命名空间是 undefined，第二条只是第一条的后果 | 改成 CJS 真分包：`output.format: 'cjs'` + `chunkFileNames: 'chunks/[name]-[hash].js'` + `manualChunks`；用 `npm run smoke` 回归（断言无早读 + chunk 延迟加载） |
| A12 | 没有崩溃，但日志出现 `Scoped globals were read before this runtime existed: document, navigator` | 0.1.4+ 的占位作用域把环境全局读作 `undefined`，特性检测走了「非浏览器」分支；说明仍有模块在 runtime 之前求值 | 同样是求值顺序问题；用 `getEarlyScopeReads()` 定位名字，把 three 相关模块改为动态 import。不要因为「能跑」就忽略 |
| A13 | `typeof document` / `typeof window.document` 在启动时抛 `Scoped global "document" was read before a runtime was created` | 0.1.4 前的占位作用域对所有键都抛错，连本应永不抛错的 `typeof` 也变成故障点 | 升级到 0.1.4+（环境全局读作 `undefined`）；根因仍是求值过早，按 A1 改动态 import |

## B. 交互 / 渲染

| # | 症状 | 根因 | 处理 |
| --- | --- | --- | --- |
| B1 | OrbitControls / TransformControls 完全无响应 | 触摸未转发；小程序 WXML 没绑 `bindtouch*`；或 rect 未就绪 | 小游戏由 `watchTouch` 自动订阅；小程序把 5 个事件全部转发到 `runtime.handleTouch(e)`；首帧前 `await runtime.resize()` |
| B2 | 多指缩放卡死、pointerId 混乱 | `touchend`/`touchcancel` 丢失 identifier | `PointerBridge` 已用 pointerId 状态机处理；确保业务不自己再包一层事件、不吞掉 `touchcancel` |
| B3 | 点击/射线拾取坐标偏移 | 触摸坐标是屏幕坐标，需减 `rect.left/top` 并考虑 DPR | 用 `runtime.bridge` 派发的 `offsetX/offsetY`；`Raycaster` 用归一化设备坐标 `((x/rect.width)*2-1, -(y/rect.height)*2+1)` |
| B4 | resize / 横竖屏后画面拉伸变形 | 只更新了 renderer 尺寸，没更新相机 | `runtime.on('resize', info => { camera.aspect = info.width/info.height; camera.updateProjectionMatrix(); renderer.setPixelRatio(info.pixelRatio); renderer.setSize(info.width, info.height, false); })` |
| B5 | 基础库无 `wx.onWindowResize`，转屏不更新 | 适配层会 `warnOnce('no-window-resize')` | 在 `wx.onShow` 或转屏回调里主动 `await runtime.resize()` |
| B6 | `PMREMGenerator.fromScene` / 后处理得到纯黑贴图 | 部分设备 WebGL 深度缓冲未清除 | **应用层显式** `renderer.clearDepth()`（或配置 `autoClearDepth`）；不要猴补丁 `WebGLRenderer.render` |
| B7 | `instanceof HTMLCanvasElement` 为 false | wx canvas 不是 DOM 类实例 | 适配层用 `Symbol.hasInstance` + WeakSet 注册表；若自己造了新画布，走 `runtime.createCanvas()` 才会被注册 |
| B8 | `getExtension('...')` 返回数字/布尔导致 three 崩 | 部分 Android 基础库差异 | `normalizeWebGL: true`（默认）已归一；不要关掉它，除非确认无此问题 |
| B9 | `drawingBufferWidth/Height` 为 undefined | 宿主未实现 | `normalizeWebGL` 已补 getter |
| B10 | 纹理显示为纯色 / 花屏（高性能+） | `texImage2D` 的 RGB internalformat/format 有 bug | 统一用 **RGBA** |
| B11 | 切后台回来动画停止 / 后台耗电 | 帧循环未暂停 | `runtime.on('visibilitychange', v => v ? loop.resume() : loop.pause())` |
| B12 | 切场景后内存持续上涨直至闪退 | `geometry/material/texture/renderTarget` 未 dispose，或静态单例持有引用 | 用 `DisposalGroup` 统一登记；切场景先释放旧场景；`renderer.dispose()` 前先 `setAnimationLoop(null)` |
| B13 | 真机卡顿、发热 | 面数/纹理过大、drawcall 过多、每帧分配对象 | 合并几何、`InstancedMesh`、KTX2 压缩纹理、对象池、帧内零分配、`pixelRatioCap` 封顶 2 |
| B14 | 小程序 `<canvas>` 取不到 node | 选择器/组件作用域错误、布局未完成 | 传 `selectorCtx: this`（自定义组件）、`queryDelay` 等一帧；WXML 用 `type="webgl2"` |
| B15 | 纹理「加载成功」但贴图不显示；`texture.image` 没有 `src` / 宽高 | 0.1.3 前监听器里的 `this` 是内部事件载体，three `ImageLoader` 把载体存进了 `Texture.source.data` | 升级到 0.1.11；不要再自己用 `image.inlineHost` 取真图 |
| B16 | `img.onload` / `addEventListener('load')` 永不触发，`ImageLoader` 靠业务超时 | 0.1.5 前图片 shim 没有把宿主原生事件桥接成合成事件；部分宿主接受 `onload` 赋值却不调用 | 升级到 0.1.11；看 `image-native-events` / `image-events-timeout` 告警 payload 里的宿主形态与 `path` |
| B17 | H5 上 `pointer` / `wheel` 收不到，`canvas.dispatchEvent(realEvent)` 抛 `Cannot set property target` | 0.1.7 前 browser binding 用 `MiniEventTarget` 覆盖了真实 canvas 的事件方法 | 升级到 0.1.11（`nativeEventTarget: true`）；不要再 patch 浏览器 canvas，也不要把监听挂到 `document` 绕开 |
| B18 | 网络大图纹理 2 秒后报 `image-events-timeout` | watchdog 无条件生效，按包内纹理的 2 秒预算判定 | 先 `wx.downloadFile` 到本地路径，或预加载后 `new THREE.Texture(image)`；包内 PNG/JPEG 不受影响。0.1.8+ 同时在裸 console 打 `warnOnce('image-events-timeout')` |
| B19 | **真机所有纹理空白/超时，模拟器正常且日志无报错** | 0.1.7 的真机宿主在事件触发时**读 `image.onload`** 并调用读到的值；shim getter 回登记表，three 又从不赋 `onload`，于是读到 `undefined`，桥接永不执行 | 升级到 0.1.11（0.1.8 修复，ADR-0011）；日志里按 `image-events-timeout` 的 `path` / `src` 定位，不要再自己给 `onload` 包一层 |
| B20 | **真机 `width/height` 恒 0、`complete` 恒 false、无任何事件**（升到 0.1.8 后仍不出图） | 真机 `src` 读取为**数据属性**但写入经宿主 interceptor 触发加载；`defineProperty` 接管（含「还原描述符再写一次」）把原生加载钩子换成死属性，图片从未开始加载 | 升级到 0.1.11（0.1.9 修复，ADR-0012）；删除任何 `Object.defineProperty(img, 'src', …)`，让普通写入直达宿主 |
| B21 | 代码把对象 URL 当 `blob:` / `mini-three-blob:` 处理，或依赖 `revokeObjectURL()` 让 URL 失效 | 0.1.10 起 `URL.createObjectURL` **同步返回 `data:` URI**，不再有 `mini-three-blob:` 句柄；`revokeObjectURL()` 是 no-op，`resolveObjectURL()` 恒 `null` | 按 `data:` 字符串处理；不要硬编码 `mini-three-blob:`，也不要依赖对象 URL 可 `fetch`。超大 Blob 会同步生成大字符串，内嵌贴图尽量外部化 |

## C. 构建 / 包体

| # | 症状 | 根因 | 处理 |
| --- | --- | --- | --- |
| C1 | 自定义 `outputDir` 不生效，`assets/three` 里没东西 | **照抄了上游 README/示例的 `assets: { outputDir }` 嵌套配置**（源码无此字段，静默忽略） | 改成扁平：`miniThree({ outputDir: 'assets/three', brotli: true, roots: [...] })` |
| C2 | three 里仍出现裸 `window`，运行即崩 | 插件未生效 / Vite 预打包了 three / include 规则没命中 | 看 `plugin.api.report().modulesScanned` 是否为 0；确认插件在 `plugins` 里、`optimizeDeps.exclude` 生效；必要时自定义 `include` |
| C3 | 局部变量被误改成 `__m3().window` | 用了正则/字符串替换（错误做法） | 只用插件的 Babel `path.scope.hasBinding` 改写；补 `scope-rewrite` 测试 |
| C4 | 资源没进包 / `missingAssets` 有值 | decoder 不在默认 roots | 把目录加进 `roots`，或按 `mini-three-assets.json` 手动放置；`missingAssets` 只告警不阻断 |
| C5 | `mini-three-assets.json` 建议没生效 | **插件不会自动改 `game.json`** | 人工把 `gameJsonSuggestion` 合并进 `game.json`（`postbuild.mjs` 会输出建议文件） |
| C6 | DRACO/KTX2 加载失败 404 | decoder 路径与 manifest 不一致 / 资源在分包但未预下载 | `draco.setDecoderPath(DECODER_BASE)` 与 `decoderPaths` 对齐；分包先 `wx.loadSubpackage()` |
| C7 | `wx.createWorker` 报错 | worker 分包未预下载 / 目录不合法 / 已有一个 Worker | 先 `wx.preDownloadSubpackage({ packageType:'workers' })`；worker 与 wasm 放同一目录；用完 `terminate()`（并发上限 1）；目录内只能放 JS |
| C8 | 主包超 4MB | three + 资源全塞主包 | 顺序：裁剪/压缩 → 动态 import 拆非首屏 → CDN → 小程序分包；注意 `manualChunks` 只切 chunk 边界，不等于把体积移出主包 |
| C9 | `manualChunks` 不生效 | 插件 `config()` 会返回 `manualChunks: undefined`；项目没有在 `rollupOptions.output` 显式写，或规则匹配过宽（见 C17） | 在项目 `rollupOptions.output.manualChunks` 显式覆盖；构建后核对 `dist/chunks/` 是否出现 `three-*` |
| C10 | `three/webgpu` 相关报错 | 小游戏无 WebGPU | 使用 WebGL 构建目标；`webgpu: 'warn'` / `'error'`；`'rewrite'` 是有损的，仅限未用 TSL/NodeMaterial 的简单场景 |
| C11 | 构建产物有多个 chunk，真机加载失败 | chunk 之间是 ESM `import()` 加载（格式没设 cjs），或 chunk 反向 `require` 入口形成环 | `output.format: 'cjs'`；用 `manualChunks` 把入口与 chunk 共用的模块（`src/config/`、`src/core/`）单独拆出 |
| C12 | 升级 three 后控件失效 | `three/addons/*` 路径、`outputColorSpace` 取代 `outputEncoding`、r180+ 破坏性改名 | 按 `03-platform-constraints.md` §2.10 流程逐项复核；锁定精确版本 |
| C13 | `parseFailures` 非空 | 某模块语法 Babel 不支持 | 查看具体 id，给 `rewrite` 加语法插件或用 `exclude` 排除；**不要**改成正则替换 |
| C14 | 真机首屏 `Class constructor ... cannot be invoked without 'new'`，栈顶在 `GLTFLoader.js` 的 `new TextDecoder()` | 0.1.2 前的改写产出 `(new __m3()).TextDecoder()`，类被当普通函数调用 | 升级到 0.1.11；清理构建缓存后重建，确认产物里没有 `new __m3().` 残留 |
| C15 | 产物 `SyntaxError: Unexpected token '.'`，出现 `{ __m3().xxx }` | 0.1.2 前对象简写属性被原地替换 | 升级到 0.1.11；不要用正则修补 |
| C16 | `vite.config.ts` 在 Vite 6 下报 `TS2769`（`map` 不能赋给 `SourceMapInput`） | 0.1.7 前 `MiniThreePlugin.transform` 把 `map` 声明成 `unknown` | 升级到 0.1.11（改用 `BuildSourceMap`） |
| C17 | 配置了 `manualChunks` 却仍只有 `game.js`，没有 `chunks/`；项目路径含 `mini-three-adapter` 时必现 | 适配层分组写成 `id.includes('mini-three-adapter')`，把项目目录名也匹配了，整个模块图被塞进同一组 | 改成 `id.includes('/node_modules/mini-three-adapter/')`；`check_project.mjs` 会报 `BROAD_ADAPTER_CHUNK` |

## D. 平台 / 真机 / 网络

| # | 症状 | 根因 | 处理 |
| --- | --- | --- | --- |
| D1 | `fail url not in domain` / 资源加载失败 | 域名未加入合法域名白名单（协议+域名+端口精确匹配） | MP 后台配置 `request` / `downloadFile` 合法域名，HTTPS + ICP 备案 + TLS 1.2+；开发期临时关校验，上线前恢复 |
| D2 | 包内 `config.json` / 模型 `fetch` 失败 | 小游戏不能 `fetch` 包内相对路径、`file://` 被禁 | `wx.getFileSystemManager().readFile()`；或放 CDN |
| D3 | **业务代码里 `new URL()` / `window.innerWidth` / `document.createElement` / `fetch` 报 undefined** | 构建插件默认**只改写 `node_modules` 里的三方生态模块**，应用代码不会被改写；这些标识符在小游戏运行时根本不存在 | 用 `runtime.windowInfo` / `runtime.document` / `runtime.scope.URL` / `wx.request`；或显式 `includeUserCode: true`（会让业务代码也被改写，需评估）；URL 拼接用字符串而不是 `new URL()` |
| D3b | `createImageBitmap` 相关报错 | PC 小程序提供该函数但无原生 Blob | 适配层把它设为 `undefined` + 插件 `forceUndef`，让 three 走降级分支；不要伪造半实现 |
| D4 | 字体真机不生效 / 安卓分包字体失败 | `wx.loadFontFace` 只认 HTTPS/Data URL；分包字体历史 bug | 字体子集化走 Data URL/HTTPS；Canvas 2D 用 `canvas.loadFont` + USER_DATA 本地文件 |
| D5 | HUD 被右上角胶囊遮挡 / 刘海屏裁切 | 写死坐标 | `wx.getMenuButtonBoundingClientRect()`（需容错）+ `safeArea`；按 design→screen 比例换算 |
| D6 | 音频无声 | 首次播放未在用户交互中触发 / 切后台 AudioContext 未恢复 | 首次点击后唤醒；`wx.onShow` 时恢复/重建 AudioContext（iOS 17.5+） |
| D7 | 严格模式下 `ReferenceError: Can't find variable: Xxx` | 隐式全局赋值 | 全项目显式声明；开严格模式自查 |
| D8 | 异步逻辑时序诡异（iOS 15 及以下） | Promise 是 setTimeout polyfill，`.then` 非微任务 | 不依赖微任务顺序；`await` 后显式同步状态 |
| D9 | 排行榜/开放数据域取不到数据 | 开放数据域独立上下文，不能访问主域变量，目录不能分包 | `postMessage` 序列化通信；目录放主包 |
| D10 | 开启高性能+ 后首屏花屏 | RGB 纹理格式 bug | `texImage2D` 统一 RGBA |
| D11 | iOS 内存异常退出 | 高性能模式内存硬顶（低端机 ~1G，安全峰值 1.2~1.3G） | 压缩纹理、及时 dispose、降 DPR、分包；用真机性能面板看**峰值**而非均值 |
| D12 | 模拟器正常、真机白屏/掉帧 | 模拟器与真机 GPU/触摸/字体差异 | 至少 iOS + 中低端安卓各一台；按 `06-checklists.md` 全量验收 |
| D13 | 用了 `eval` / `new Function` 的库在真机崩 | 平台禁用动态执行 | 换库或预编译（如 shader 走预生成代码） |
| D14 | 用了 Proxy 的库在低版本客户端异常 | 官方明确「尽量避免 Proxy」 | 换实现或提高最低基础库；业务侧不要自己用 Proxy 包装宿主对象 |

## 排查标准流程

```
1. 构建期证据
   plugin.api.report() → parseFailures / missingAssets / webgpuWarnings / modulesRewritten
   dist/mini-three-assets.json → entries / decoderPaths / gameJsonSuggestion
2. 启动期证据
   console.log(runtime.report()) → webgl2 / webgl2Source / offscreenCanvas / worker / wasm / baseLibraryVersion
   runtime.capabilities 结构化落盘到 docs/compat.md
   getEarlyScopeReads() → 是否有模块在 runtime 之前求值（旧版适配层没有此函数）
   纹理问题看 image-native-events / image-events-timeout / image-events-unavailable 告警的 reason、path 与宿主形状；超长 data: URI 在日志中会截断
3. 分层隔离
   H5（createBrowserRuntime）能否复现？
     能 → 业务/three 代码问题（与平台无关），在浏览器里用 DevTools 查；
          先确认是 0.1.11+，旧版的 H5 canvas 事件会被适配层吞掉
     不能 → 平台差异，按上表 B/D 类排查
4. 最小化
   换回 scenes/boot 最小立方体场景；能出图再逐个加回资源/控制器/后处理
5. 记录
   把「适配层版本 / three 版本 / 基础库 / 机型 / webgl2Source / 结果 / 根因」追加到 docs/compat.md
```
