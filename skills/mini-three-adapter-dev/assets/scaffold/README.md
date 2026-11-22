# mini-three 3D 小游戏工程模板

由 `mini-three-adapter-dev` Skill 生成。分层与约束见 Skill 的 `references/02-project-architecture.md`。
依赖精确锁定：`mini-three-adapter@0.1.11` + `three@0.187.0`（适配层最低要求 three 0.163）。

## 快速开始

```bash
npm install
npm run check          # typecheck + build + postbuild + smoke
```

用**微信开发者工具（小游戏模式）**打开本目录，`miniprogramRoot = dist/`。首次可用 `touristappid`，正式项目替换 `project.config.json` 的 `appid`。

H5 冒烟（同一份场景代码，浏览器里跑）：`npm run h5`。注意它走 **build + preview**，不是 `vite dev` —— 适配层的 AST 重写只在构建期生效，dev server 下 three 会读到未激活的作用域全局并直接报错。入口为 `src/platform/bootstrap.h5.ts`。

## 六条不可破坏的约束

1. **求值顺序**：`src/main.ts` 只静态导入适配层 → `await createWeChatGameRuntime()` → 之后才 `await import('../app/GameApp.js')`。任何静态 `import three` 出现在 `main.ts` 的静态依赖图里都会导致真机黑屏。
2. **CommonJS 真分包**：`output.format: 'cjs'` + `chunkFileNames: 'chunks/[name]-[hash].js'`，three 必须在独立 chunk 里，由入口在 runtime 就绪后 `require`。**不要开 `inlineDynamicImports`**：它不保留惰性，three 的顶层语句仍在脚本求值阶段执行，会抛 `Scoped global "__THREE__" was read before a runtime was created`。
3. **适配层单点隔离**：只有 `src/platform/*` 能 `import 'mini-three-adapter/*'`（业务层只用 `import type`）。
4. **能力探测交给适配层**：不要手写 1x1 离屏探测再覆盖 `capabilities`。看 `runtime.capabilities.webgl2Source`：`inferred` 的 `false` 只是版本推断，渲染器能创建成功才是 WebGL2 可用的证据。
5. **不接管图片宿主属性**：不要在 `wx.createImage()` 返回对象上 `defineProperty` 接管 `src` / `onload` / `onerror`。真机 `src` 是数据属性，写入经宿主 interceptor 触发加载；接管（包括「还原描述符再写一次」）会把原生加载钩子换死。0.1.9 起按宿主描述符分流；取图差异用 0.1.11 的 `createImage` 选项。
6. **对象 URL 按 `data:` 处理**：0.1.10 起 `URL.createObjectURL()` 同步返回 `data:` URI，不再有 `mini-three-blob:`；`revokeObjectURL()` 是 no-op。不要硬编码旧前缀或依赖对象 URL 可 `fetch`；超大 Blob 会同步生成大字符串。

## 目录

| 目录 | 职责 |
| --- | --- |
| `src/main.ts` | 唯一入口，延迟一拍启动 |
| `src/platform/` | 防腐层：runtime 创建、生命周期、设备信息、分包 |
| `src/app/` | 应用编排、帧循环、场景管理 |
| `src/core/` | 纯 TS：事件总线、释放组、共享类型（可 Node 单测） |
| `src/config/` | 环境与常量（decoder 路径、DPR、CDN） |
| `src/render/` | WebGLRenderer 创建 / resize / 释放 |
| `src/assets/` | 资源清单（单一数据源）与 loader 工厂 |
| `src/scenes/` | 按玩法分目录，实现 `Scene` 契约 |
| `scripts/` | 构建后校验、体积预算、产物冒烟 |

## 排错备忘

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Scoped global "__THREE__" was read before a runtime was created` + `Cannot read properties of undefined (reading 'GameApp')` | three 被打进入了口，模块体在脚本求值时就执行了 | 见约束 2：拆 chunk，用 CommonJS `require` 延后加载 |
| `!! WebGL2 unavailable: three.js >= r163 requires WebGL2` 但画面正常 | 开发者工具里 `SDKVersion` 报 `1.0.0`，或离屏画布 webgl2 探测返回 null，属**假阴性**；`webgl2Source` 为 `inferred` 时 `false` 只是推断 | 画质判定以「渲染器能否创建成功」为准（`src/app/GameApp.ts`），该警告可忽略；不要手写探测覆盖 `capabilities` |
| 纹理一直 pending / 2 秒后才报图片错误 | 图片事件桥接有 2 秒 watchdog；直接 `img.src` 加载慢网络大图会被判失败 | 先 `wx.downloadFile` 到本地路径，或预加载后 `new THREE.Texture(image)`；包内 PNG/JPEG 不受影响 |
| 真机纹理全空白 / 2 秒后 `image-events-timeout`，模拟器正常 | 0.1.7 真机在事件触发时读 `onload`，被 shim getter 遮蔽；0.1.8 又有 `src` 数据属性被 `defineProperty` 接管的问题 | 升级到 `mini-three-adapter@0.1.11`；不要在图片对象上 `defineProperty` 接管 `src` / `onload` / `onerror` |
| 代码把对象 URL 当 `blob:` / `mini-three-blob:` 处理，或依赖 `revokeObjectURL()` 失效 | 0.1.10 起对象 URL 直接是 `data:` URI，`revoke` 为 no-op | 按 `data:` 字符串处理；不要硬编码旧前缀或依赖 `fetch`；超大 Blob 外部化 |
| H5 上 OrbitControls 拖不动、`dispatchEvent` 报 `Cannot set property target` | 0.1.7 之前的 browser binding 覆盖了真实 canvas 的事件方法与 DOM 成员 | 升级到 `mini-three-adapter@0.1.11`；不要再手工 patch 浏览器 canvas |
| `THREE.WebGLRenderer: Error creating WebGL context` | 环境真的拿不到 WebGL2 | 开发者工具：设置 → 通用设置 → 打开「使用硬件加速」后重启；真机：基础库 ≥ 2.20.0 |

## 上线前

- 把 `dist/mini-three-assets.json` 的 `gameJsonSuggestion` 合并进 `game.json`。
- `project.config.json` 的 `urlCheck: false` 仅用于开发；上线前配置 MP 后台合法域名并恢复校验。
- 按 Skill 的 `references/06-checklists.md` 做真机验收，并填写 `docs/compat.md`。
