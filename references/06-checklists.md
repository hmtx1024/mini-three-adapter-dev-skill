# 06 · 检查清单（可直接逐条勾选）

## A. 生成 / 修改代码后的 AI 自检

- [ ] `mini-three-adapter` 精确锁定 `0.1.7`（低于它先按 `05-workflows.md` §13 升级）
- [ ] `main.ts` 静态导入图里**没有** `three`（`import type` 除外）
- [ ] `createWeChatGameRuntime()` 在动态 `import('./app/GameApp.js')` **之前**完成
- [ ] 没有手写 1×1 离屏探测，也没有用 `capabilities.webgl2` 覆盖探测结果；画质看 `webgl2Source`，渲染器创建成功为准
- [ ] `vite.config.ts` 装配 `miniThree()`，选项是**扁平**的（无 `assets: {}` 嵌套）
- [ ] `build.target === 'es2019'`；`rollupOptions.input` 指向 `src/main.ts`；`output.format === 'cjs'`；`entryFileNames === 'game.js'`
- [ ] `output.chunkFileNames` 输出到 `chunks/`，three / adapter 各自独立 chunk
- [ ] `manualChunks` 的 adapter 规则是 `id.includes('/node_modules/mini-three-adapter/')`（不能漏掉 `/node_modules/`）
- [ ] **没有** `inlineDynamicImports: true`（它不保留惰性，会把 three 打进入口）
- [ ] `preserveEntrySignatures: false`（input 级）+ `modulePreload: false`
- [ ] `npm run smoke` 通过：无作用域早读，场景 chunk 确实延迟加载
- [ ] 业务代码里没有 `wx.createCanvas()`（额外画布走 `runtime.createCanvas()`）
- [ ] 没有 `new Proxy(canvas)` / `Object.setPrototypeOf` / 画布克隆
- [ ] H5 上没有手工 patch 真实 canvas 的事件方法 / `style` / `getBoundingClientRect`（0.1.7 原生保留）
- [ ] 没有 `globalThis.window = ...`（`installGlobals` 仅显式 opt-in）
- [ ] 启动日志没有 `Scoped globals were read before this runtime existed`；`getEarlyScopeReads()` 为空（旧版无此 API）
- [ ] `new THREE.WebGLRenderer(runtime.rendererHints)` + `setPixelRatio` + `setSize(w,h,false)` + `outputColorSpace`
- [ ] 帧循环用 `renderer.setAnimationLoop()`；`dispose` 里先 `setAnimationLoop(null)`
- [ ] `resize` / `visibilitychange` / `contextlost` / `dispose` 四个事件都已接线
- [ ] 每个订阅、定时器、loader、three 资源都登记进 `DisposalGroup`
- [ ] `scene.remove()` 后 `geometry/material/texture/renderTarget.dispose()`
- [ ] 没有 `three/webgpu` / `WebGPURenderer` / TSL / NodeMaterial
- [ ] decoder 路径取 `config/constants.ts`，与 `decoderPaths` 一致
- [ ] 纹理在 2 秒 watchdog 内可完成；网络大图走 `wx.downloadFile` / 预加载，不直接依赖慢 `img.src`
- [ ] 小程序：WXML 五个 `bindtouch*` 都转发 `runtime.handleTouch(e)`，自定义组件传 `selectorCtx`
- [ ] 没有 `eval` / `new Function` / 业务侧 `Proxy`
- [ ] 资源只从 `manifest.ts` 的 id 引用，没有散落的路径字符串

## B. 构建期

- [ ] `node scripts/check_project.mjs <project>` 无 ERROR（`ADAPTER_OUTDATED` 应为空）
- [ ] `npm run typecheck` 通过（Vite 6 + 0.1.7 不应出现 `TS2769`）
- [ ] `npm run build` 通过，产物为 `dist/game.js` + `dist/chunks/*.js`（three 在独立 chunk，入口 < 400 KB）
- [ ] `npm run h5:build` 通过（H5 不在 `npm run check` 里；改了 `bootstrap.h5.ts` 必须单独跑）
- [ ] 产物里没有 `new __m3().` / `{ __m3().xxx }` 残留（0.1.2 前的改写缺陷）
- [ ] `plugin.api.report().modulesRewritten > 0`（插件确实命中了 three）
- [ ] `parseFailures` 为空
- [ ] `missingAssets` 为空或已白名单化并说明来源
- [ ] `webgpuWarnings` 已确认（应为 0）
- [ ] `dist/mini-three-assets.json` 存在，`entries` / `decoderPaths` 符合预期
- [ ] `gameJsonSuggestion` 已合并进 `game.json`（插件不会自动改）
- [ ] `dist/game.json`、`dist/project.config.json` 已就位（`postbuild.mjs`）
- [ ] `node scripts/check_bundle.mjs ./dist`：主包 < 3.2MB（预警线），总量 < 30MB
- [ ] 生产构建关闭 sourcemap、屏蔽 `console.log`、开启合适压缩
- [ ] `packOptions.ignore` 排除源码 / 设计稿 / 文档 / `.map`

## C. `game.json` / `project.config.json`

- [ ] `deviceOrientation` 符合玩法（portrait / landscape）
- [ ] `subpackages` 与 `workers.path` 指向同一个 `outputDir`（worker 只支持一个目录）
- [ ] `workers.isSubpackage: true` 时，代码里先 `wx.preDownloadSubpackage({ packageType:'workers' })`
- [ ] 开放数据域目录**没有**被设为分包
- [ ] `iOSHighPerformance` / `iOSHighPerformance+` 按真机验证结果设置（默认 false）
- [ ] `project.config.json`：`compileType: "game"`、`miniprogramRoot: "dist/"`、`libVersion` 明确
- [ ] 开发者工具「不校验合法域名」仅开发期勾选，上线前恢复
- [ ] MP 后台已配置 `request` / `downloadFile` 合法域名（HTTPS + 备案 + TLS 1.2+）

## D. H5 双端冒烟（不需要真机）

- [ ] `createBrowserRuntime()` 能启动，同一份 `scenes/` 出图（走 `npm run h5`，不是 `vite dev`）
- [ ] 鼠标拖动 / 滚轮缩放直接由浏览器原生 `pointer*` / `wheel` 驱动（0.1.7 `nativeEventTarget`）
- [ ] `canvas.dispatchEvent(new Event('x'))` 不抛 `Cannot set property target`；宿主 `style` / `getBoundingClientRect` 未被覆盖
- [ ] resize 窗口后画面不变形
- [ ] 切换场景 20 次，`renderer.info.memory` 不持续增长

## E. 真机验收（发布前，iOS + 中低端安卓各一台）

- [ ] WebGL2 正常出图；若 `runtime.report()` 显示 `webgl2: false`，确认 `webgl2Source` 是 `inferred` 还是 `probe`（以渲染器创建成功为准）
- [ ] 包内 PNG/JPEG 纹理与 GLTF 纹理能加载；没有 `image-events-timeout` 告警
- [ ] `runtime.report()` 已保存并追加到 `docs/compat.md`（适配层 / three 版本 / 基础库 / 机型 / webgl2Source）
- [ ] 单指旋转、双指缩放/旋转不卡死；`touchcancel` 后指针计数归零
- [ ] 点击/射线拾取坐标正确（刘海屏、不同 DPR、横竖屏各测一次）
- [ ] 横竖屏切换后 `resize` 生效，画面不变形
- [ ] 前后台切换：循环暂停/恢复、音频恢复、无后台耗电
- [ ] DRACO / KTX2 模型加载成功（含分包预下载 Worker）
- [ ] 远程资源在**未关闭域名校验**的情况下可加载
- [ ] HUD 不被右上角胶囊遮挡、不被刘海/底部横条裁切
- [ ] 字体、音频在真机生效
- [ ] 中低端安卓帧率达标（建议 ≥ 30fps）、无明显发热
- [ ] iOS 内存峰值在安全线内（开高性能模式时 ≤ 1.2~1.3G）
- [ ] 反复进出场景 20 次无内存持续增长、无闪退
- [ ] `runtime.dispose()` 后无残留监听、无 rAF 继续跑
- [ ] 断网 / 弱网有明确提示而非白屏
- [ ] `wx.onError` / `wx.onUnhandledRejection` 上报链路可用

## F. 发布合规

- [ ] 类目 / 版号 / 软著 / 隐私协议符合要求（上线前查最新政策）
- [ ] 无诱导分享、支付配置正确
- [ ] 代码包内无密钥 / 机密（JS 明文可反编译）
- [ ] `wx.getUpdateManager()` 更新流程已验证
- [ ] 体验版 → 提交审核 → 发布；线上 `runtime.report()` 与异常上报可见

## G. 版本升级记录模板（`docs/compat.md`）

```
| 日期 | mini-three-adapter | three | 基础库 | 设备 / OS | 场景 | 结果 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-13 | 0.1.7 | 0.187.0 | 3.x | iPhone 13 / iOS 17 | boot | ✅ | webgl2=true/probe, worker=false |
```
