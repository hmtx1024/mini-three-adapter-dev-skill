# mini-three-adapter-dev

面向 AI 编码助手的 **mini-three-adapter + Three.js 微信 3D 开发 Skill**。

把「微信小游戏平台约束」「mini-three-adapter 适配层行为」「可维护的工程架构」固化成一套可执行规范，并附带可运行脚手架、参考文档和静态校验脚本。

目标环境：`mini-three-adapter@0.1.7` + `three@0.187.0` + Vite 6 + TypeScript。

> 给 AI 的入口是 [`skills/mini-three-adapter-dev/SKILL.md`](./skills/mini-three-adapter-dev/SKILL.md)；给维护者的入口是 [`AGENTS.md`](./AGENTS.md)；本文件面向第一次接触仓库的人。

---

## 仓库结构

```text
mini-three-adapter-dev-skill/
├── skills/
│   └── mini-three-adapter-dev/
│       ├── SKILL.md              # 必需：Skill 入口
│       ├── references/           # 7 份按需加载的详细文档
│       ├── assets/scaffold/      # 可运行工程模板
│       └── scripts/              # 生成 / 校验脚本
├── AGENTS.md                     # 维护规则与升级流程
├── README.md
└── .gitignore
```

Skill 名为 `mini-three-adapter-dev`，与 `SKILL.md` frontmatter 一致。

---

## 解决什么问题

微信小游戏没有 DOM/BOM，three.js 不能直接运行。`mini-three-adapter` 通过「构建期作用域改写 + 运行期就地补丁」解决兼容问题，但工程仍有一批容易踩错的硬约束：

- three 必须在 runtime 创建之后才求值，否则黑屏并报 `Scoped global "__THREE__" was read before a runtime was created`
- 产物必须是 CommonJS + 真分包，`inlineDynamicImports` 会破坏惰性
- 能力探测不能偷走上屏画布，`webgl2Source` 为 `inferred` 时 `false` 不一定是真不支持
- 图片纹理事件有 2 秒 watchdog，慢网络大图需要先下载
- H5 真实 canvas 不能被二次 patch 事件系统
- decoder、Worker、WASM、分包和包体预算都有平台限制

本 Skill 把这些约束写成规则、脚手架、检查清单和校验脚本，让 AI 生成代码时不必每次重新踩坑。

---

## 包含内容

| 路径 | 说明 |
| --- | --- |
| [`skills/mini-three-adapter-dev/SKILL.md`](./skills/mini-three-adapter-dev/SKILL.md) | Skill 入口：frontmatter、14 条硬规则、工作流、反模式、参考索引 |
| [`skills/mini-three-adapter-dev/references/`](./skills/mini-three-adapter-dev/references/) | 7 份按需加载的详细文档 |
| [`skills/mini-three-adapter-dev/assets/scaffold/`](./skills/mini-three-adapter-dev/assets/scaffold/) | Vite + TS 工程模板（也是最小可运行示例） |
| [`skills/mini-three-adapter-dev/scripts/new_project.mjs`](./skills/mini-three-adapter-dev/scripts/new_project.mjs) | 从脚手架生成新工程，替换项目名与 AppID |
| [`skills/mini-three-adapter-dev/scripts/check_project.mjs`](./skills/mini-three-adapter-dev/scripts/check_project.mjs) | 静态校验硬规则：求值顺序、构建形态、分包、反模式、适配层版本 |
| [`skills/mini-three-adapter-dev/scripts/check_bundle.mjs`](./skills/mini-three-adapter-dev/scripts/check_bundle.mjs) | 产物体检：chunk 形态、manifest、包体预算 |
| [`AGENTS.md`](./AGENTS.md) | 维护本 Skill 的约束，以及「更新 Skill / 升级适配层」流程 |

`references/` 按编号阅读：

| 文件 | 何时读 |
| --- | --- |
| `01-adapter-anatomy.md` | 查 API 签名、理解构建期/运行期两阶段模型 |
| `02-project-architecture.md` | 设计目录结构、分层边界、生命周期 |
| `03-platform-constraints.md` | 确认平台能力、额度、官方口径 |
| `04-pitfalls.md` | 黑屏、触摸失效、纹理不显示、包体超限 |
| `05-workflows.md` | 新建、接入、加载模型、升级 three / adapter |
| `06-checklists.md` | 交付前自查、真机验收、发布门禁 |
| `07-code-recipes.md` | 可直接复制的代码片段 |

---

## 安装与使用

### 一行命令安装（推荐）

```bash
npx skills add https://github.com/hmtx1024/mini-three-adapter-dev-skill --skill mini-three-adapter-dev
```

这是 skills.sh 提供的 CLI：从 GitHub 仓库扫描 `skills/*/SKILL.md`，把 `mini-three-adapter-dev` 直接装进本机客户端的 skills 目录，无需手动复制。安装后的触发方式见下文「本地 OpenCode」一节的说明（仅显式点名）。

### 本地 OpenCode

把 Skill 子目录复制或链接到客户端的 skills 目录。本机示例：

```text
~/.agents/skills/mini-three-adapter-dev/
├── SKILL.md
├── references/
├── assets/
└── scripts/
```

本 Skill 是**仅显式触发**的：话题相关不会自动加载它。在会话里点名它即可，例如输入 `@mini-three-adapter-dev`，或直接说「用 mini-three-adapter-dev 这个 skill 新建一个微信小游戏项目」。frontmatter 里的 `disable-model-invocation: true` / `metadata.opencode/autoinvoke: false` 负责对模型隐藏；description 末尾的「仅显式点名时加载」约束兼容只读 description 的其他客户端。

也可以不安装，直接在本仓库会话中让 Agent 先读 `SKILL.md`。

### 新建工程

以下命令在**仓库根目录**执行。若已把 Skill 安装到其他位置，把 `skills/mini-three-adapter-dev` 换成实际的 Skill 目录。

```bash
node skills/mini-three-adapter-dev/scripts/new_project.mjs ./my-game --name "My 3D Game" --appid wx1234567890
cd my-game
npm install
npm run check
```

然后用**微信开发者工具（小游戏模式）**打开 `my-game` 目录，`miniprogramRoot = dist/`。

继续校验：

```bash
node ../skills/mini-three-adapter-dev/scripts/check_project.mjs .
node ../skills/mini-three-adapter-dev/scripts/check_bundle.mjs ./dist
npm run h5   # build + preview，在浏览器里跑同一份场景代码
```

`npm run check` 依次执行：

```text
typecheck -> vite build -> postbuild（拷贝 game.json / 校验 manifest / 包体预算）-> smoke
```

`smoke` 在 Node 里伪造最小 wx 宿主加载产物，验证：

1. 没有作用域早读错误；
2. 场景 chunk 确实在 runtime 创建后才 `require`；
3. three 能加载到 `WebGLRenderer` 阶段。

### 生成的工程包含什么

- 单一入口 `src/main.ts`，只静态导入适配层，runtime 就绪后才动态 import 场景
- `src/platform/`：runtime、生命周期、设备信息、分包预下载
- `src/app/`：应用编排、帧循环、场景管理
- `src/core/`：事件总线、释放组、共享类型
- `src/render/`：`WebGLRenderer` 创建、resize、释放
- `src/assets/`：资源清单与 GLTF / DRACO / KTX2 loader
- `src/scenes/`：按玩法分目录的场景
- `scripts/`：postbuild、smoke
- `vite.config.ts`：扁平插件选项 + CJS 分包
- `vite.h5.config.ts`：H5 build + preview 配置

---

## 验证状态

当前脚手架在以下组合下通过完整链路：

| 项 | 值 |
| --- | --- |
| Node | 24.9 |
| Vite | 6.4.6 |
| three | 0.187.0 |
| mini-three-adapter | 0.1.7 |
| 产物 | `game.js` 约 1.3 KB + 4 个 chunk，合计约 0.58 MB |
| `check_project` | 0 error（仅预期的 `URL_CHECK_OFF` 开发期警告） |
| `check_bundle` | PASS |
| H5 | `npm run h5:build` 通过 |

静态检查脚手架本身（无需安装依赖）：

```bash
node skills/mini-three-adapter-dev/scripts/check_project.mjs skills/mini-three-adapter-dev/assets/scaffold
# 0 error，1 条预期 WARN [URL_CHECK_OFF]
```

---

## 适用 / 不适用

**适用**

- 微信小游戏（主）
- 微信小程序 `<canvas type="webgl2">`
- H5 双端（同一份场景代码）
- Vite / Rollup + TypeScript + three ≥ 0.163

**不适用**

- 未使用 `mini-three-adapter` 的项目
- Cocos / Laya / Unity 导出项目
- 纯 WebView 套壳
- 依赖完整 DOM/CSS 的 UI 框架
- `three/webgpu` + TSL / NodeMaterial 项目

---

## 维护

- 修改 Skill 前先读 [`AGENTS.md`](./AGENTS.md)。
- 更新适配层版本时，按 AGENTS.md 的《更新 Skill / 适配层升级流程》执行，不要只改版本号。
- 本仓库根目录**没有** `package.json`，不能在根目录 `npm install` / `npm run build`；验证请用 `.tmp/` 中由脚手架生成的新工程。
- `check_project.mjs` 与 `check_bundle.mjs` 支持 `--json`；`new_project.mjs` 只接受 `--name` / `--appid` / `--force`。

## 相关项目

- 适配层源码与文档：<https://github.com/hmtx1024/mini-three-adapter>
- 当前目标版本：`mini-three-adapter@0.1.7`
