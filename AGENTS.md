# AGENTS.md

本仓库是 **skills.sh 兼容的 Skill 仓库**，不是游戏工程，也不是可直接运行的 npm 项目。根目录只有说明文件与 `skills/`：

```text
mini-three-adapter-dev-skill/
├── skills/
│   └── mini-three-adapter-dev/       # 真正的 Skill
│       ├── SKILL.md                  # 必需入口
│       ├── references/               # 按需加载的详细文档
│       ├── assets/scaffold/          # 可运行工程模板
│       └── scripts/                  # 三个校验/生成脚本
├── AGENTS.md                         # 本文件：维护规则
├── README.md                         # 仓库说明
└── .gitignore
```

发布到 skills.sh 的前提：仓库是 **Public GitHub 仓库**，扫描器会找 `skills/*/SKILL.md`。本目录名 `mini-three-adapter-dev` 必须与 `SKILL.md` frontmatter 的 `name` 一致。

如果任务只是「用这个 Skill 开发项目」，读 `skills/mini-three-adapter-dev/SKILL.md`，不要改本仓库。

目标适配层版本：`mini-three-adapter@0.1.9`（`three@0.187.0`）。

`.tmp/` 是工作区：上游适配层源码（`.tmp/mini-three-adapter`）、验证工程、临时脚本和日志都放这里。**不要**把 `.tmp/` 当作 Skill 内容，也不要从 `.tmp/` 反向覆盖正式文件。

用户说「更新 Skill」「按最新适配层更新」「同步适配层」时，直接执行下方《更新 Skill / 适配层升级流程》，不要只改版本号。

## 目录与单一事实源

| 路径 | 作用 | 注意 |
| --- | --- | --- |
| `skills/mini-three-adapter-dev/SKILL.md` | Skill 入口：frontmatter + 14 条硬规则 + 参考索引 | 本 Skill **仅显式触发**：frontmatter 必须保留 `disable-model-invocation: true` 与 `metadata.opencode/autoinvoke: false`；description 保持简短（说明用途 + 「仅在用户显式点名时加载」），不要往 description 里堆 API 触发关键词 |
| `skills/mini-three-adapter-dev/references/01–07` | 按需加载的详细文档 | 新增/改名必须同步 `SKILL.md` 文末索引 |
| `skills/mini-three-adapter-dev/assets/scaffold/` | 可运行工程模板，由 `new_project.mjs` **整目录复制** | 改模板只能改这里；生成后的工程不会反向同步 |
| `skills/mini-three-adapter-dev/scripts/` | 三个独立校验/生成脚本，只依赖 Node 内置模块 | 不要引入 npm 依赖，也不要把它们复制进 scaffold |

`assets/scaffold/scripts/`（`postbuild.mjs`、`smoke.cjs`）是生成工程自带的脚本，与 Skill 根目录的 `scripts/` 用途不同，不要混淆。

## 验证

静态检查模板（无需 `npm install`）：

```bash
node skills/mini-three-adapter-dev/scripts/check_project.mjs skills/mini-three-adapter-dev/assets/scaffold
# 基线：0 error，1 条预期 WARN [URL_CHECK_OFF]
```

改动 scaffold 后，生成临时工程跑完整链路：

```bash
node skills/mini-three-adapter-dev/scripts/new_project.mjs .tmp/verify-game --name verify --force
cd .tmp/verify-game
npm install
npm run check          # typecheck -> build(+postbuild) -> smoke，需先有 dist
npm run h5:build       # H5 链路不在 check 里，改了 bootstrap.h5.ts 必须单独跑
node <仓库>/skills/mini-three-adapter-dev/scripts/check_project.mjs .
node <仓库>/skills/mini-three-adapter-dev/scripts/check_bundle.mjs ./dist
```

预期：`game.js` 约 1.26 KB、4 个 chunk、`dist` 约 0.58 MB；check 脚本 0 error，`check_bundle` PASS。`smoke` 在 Node 里伪造 wx 宿主，固定等待 2.5 秒，退出前删除 `.smoke/`。

- `URL_CHECK_OFF` 是模板故意设置 `urlCheck: false` 导致的预期警告，不要为了消警告改模板。
- `check_project.mjs` / `check_bundle.mjs` 支持 `--json`；错误码（如 `NO_LAZY_CHUNK`、`STATIC_THREE_IN_MAIN`）是给 CI/AI 的接口，保持稳定。`new_project.mjs` 不支持 `--json`。

## 更新 Skill / 适配层升级流程（收到「更新 Skill」「按最新适配层更新」时执行）

目标：把最新 `mini-three-adapter` 的行为差异同步进 `skills/mini-three-adapter-dev/`，并用可执行验证证明脚手架仍可构建。临时文件一律放 `.tmp/`；先用 `.tmp` 取到最新版并列出变更，再改正式文件，改完必须用**全新生成**的工程验证。

1. **确认最新版并落到 `.tmp`**

   ```bash
   npm view mini-three-adapter dist-tags versions time --json
   git clone --depth 50 https://github.com/hmtx1024/mini-three-adapter.git .tmp/mini-three-adapter
   cd .tmp/mini-three-adapter
   git fetch --tags
   git checkout v<latest>
   ```

   以 npm `dist-tags.latest` 和对应 tag 为准，不要假设 `SKILL.md` 里写的版本是最新。`.tmp/mini-three-adapter` 已存在时直接 `git -C .tmp/mini-three-adapter fetch --tags`，不要重复克隆。若 latest 已等于当前目标版本，先核对 CHANGELOG 是否还有未同步项；只补差量，不要重写整套文档。

2. **读上游事实源**：`AGENTS.md`、`llms.txt`、`CHANGELOG.md`、`docs/04-api-reference.md`、`docs/05-build-plugin.md`、`docs/06-platform-notes.md`、`docs/07-integration-guide.md`、`docs/11-compat-matrix.md`、相关 ADR，以及 `src/**` 的公开类型和关键实现。文档与源码冲突时**以源码为准**；0.1.9 时重新核实，上游 README / `docs/07` 的 `assets: {}` 与 ESM lib 示例仍是错的，不要盲信文档。

3. **列变更清单并定位到 Skill**：

   | 上游变化 | 同步位置 |
   | --- | --- |
   | 公开 API / 类型 / 导出 | `skills/mini-three-adapter-dev/references/01-adapter-anatomy.md`、`07-code-recipes.md`、`scripts/check_project.mjs` |
   | 运行时行为（探测 / 事件 / 图片 / 生命周期） | `skills/mini-three-adapter-dev/SKILL.md` 硬规则、`references/01/04/05`、`assets/scaffold/src/platform/` |
   | 构建插件 / 选项 / AST 改写 | `skills/mini-three-adapter-dev/SKILL.md` 硬规则 2–3、`references/01/04/07`、`assets/scaffold/vite.config.ts`、`scripts/check_project.mjs` |
   | 平台事实 / 兼容矩阵 | `skills/mini-three-adapter-dev/references/03-platform-constraints.md`、`06-checklists.md` |
   | 示例 / 配方 / 排错 | `skills/mini-three-adapter-dev/references/07-code-recipes.md`、`04-pitfalls.md` |
   | 版本号 / 验证数字 | `skills/mini-three-adapter-dev/SKILL.md`（frontmatter + 验证记录）、`AGENTS.md`、`assets/scaffold/package.json`、`references/` 中的版本引用 |

4. **更新五个面（新增检查时再做反向验证）**：
   - `SKILL.md`：`version` 递增（如 1.2.0 → 1.3.0）、description 中的适配层版本号、目标版本、硬规则、反模式、工具说明、验证记录、完成定义。本 Skill 仅显式触发，description 不堆触发词；不要移除 `disable-model-invocation` / `opencode/autoinvoke` 两个开关。
   - `references/01–07`：API 速查、升级策略、排错表、检查清单、代码配方；新版本从旧版升级时在 `05-workflows.md` 增加 `<old> → <new>` 升级节。
   - `assets/scaffold`：精确版本、移除已过时的 workaround、更新 README 排错；保持 CJS + 真分包 + 扁平插件选项 + `es2019`。用 `npm i` 临时安装后回读 `package.json`，确认版本没被 npm 自动写成 `^x.y.z`。
   - `scripts/check_project.mjs`：新增版本告警与新反模式检查；保持既有错误码稳定，并更新预期基线。
   - `AGENTS.md`：锁定版本、预期产物数字、新的硬约束。
   - 若新增检查规则，必须同时做**反向验证**（故意写坏一份 `.tmp` 工程，确认报出预期错误码）。例：把 adapter 规则改回 `id.includes('mini-three-adapter')` 应报 `BROAD_ADAPTER_CHUNK`；打开 `inlineDynamicImports` 应报 `INLINE_DYNAMIC_IMPORTS_BREAKS_EVAL_ORDER`；在图片对象上写 `Object.defineProperty(img, 'src', …)` 应报 `HOST_ACCESSOR_OVERRIDE`。

5. **全新验证，不复用旧工程**：

   ```bash
   node skills/mini-three-adapter-dev/scripts/new_project.mjs .tmp/verify-<version> --name verify --force
   cd .tmp/verify-<version>
   npm install
   npm run check          # typecheck -> build(+postbuild) -> smoke
   npm run h5:build       # H5 链路不在 check 里
   node <仓库>/skills/mini-three-adapter-dev/scripts/check_project.mjs .
   node <仓库>/skills/mini-three-adapter-dev/scripts/check_bundle.mjs ./dist
   ```

   同时跑 `node skills/mini-three-adapter-dev/scripts/check_project.mjs skills/mini-three-adapter-dev/assets/scaffold`。基线应为 **0 error + 1 条预期 `URL_CHECK_OFF` WARN**。验证工程放在本仓库 `.tmp/` 下还有一个作用：路径含 `mini-three-adapter`，能暴露 `manualChunks` 过宽匹配之类的路径相关 bug。

6. **回写验证数字**：把实际 Node / Vite / three / adapter 版本、chunk 数量、`game.js` 与 `dist` 体积、构建报告计数、smoke 结论写回 `skills/mini-three-adapter-dev/SKILL.md` 的「脚手架验证记录」和 `AGENTS.md` 的预期值；再全仓搜索旧目标版本号，确认当前描述没有残留（`05-workflows.md` 的历史升级表应保留）。

7. **清理**：删除中间验证工程、日志和临时产物，保留 `.tmp/mini-three-adapter` 与最终 `verify-<version>`；确认仓库根没有 `.tmp` 之外的临时文件、`dist`、`.smoke`。

**完成标准**：最新版本来自 npm / tag；每条上游行为变化都已落到文档、脚手架或 checker，或明确标记「不适用」；新脚手架 `check_project` 0 error；新生成工程 `npm run check`、`npm run h5:build`、`check_project`、`check_bundle` 全过；新增检查有反向验证；版本号和体积数字全仓一致。若新版本含破坏性 API/默认行为变化，先停下来问用户，不要静默改掉本 Skill 的既有契约。

## 改一处必须同步的地方

> 下文中未写全路径的 `SKILL.md` / `references/` / `assets/scaffold/` / `scripts/` 均指 `skills/mini-three-adapter-dev/` 下的对应路径。

- 一条硬规则通常同时出现在：`skills/mini-three-adapter-dev/SKILL.md` 硬规则、`references/04-pitfalls.md`、`references/06-checklists.md`、`references/07-code-recipes.md`、`assets/scaffold/`、`scripts/check_project.mjs`。只改文案不同步 checker，规则就不可执行；只改 checker 不同步文档，用户看不到。
- `check_project.mjs` 是**基于文本正则**的检查，且先剥离注释。重构 `vite.config.ts` 的写法后，确认对应正则仍能命中；注释里出现反例不会误报。
- 以下配置是承重墙，不要“简化”：CJS 输出 + `chunkFileNames` + `manualChunks`、禁止 `inlineDynamicImports`、`target: 'es2019'`、`modulePreload: false`、`preserveEntrySignatures: false`、`miniThree()` 扁平选项（上游 README 的 `assets: {}` 是无效写法）。`manualChunks` 的 adapter 规则必须写成 `id.includes('/node_modules/mini-three-adapter/')`；写成不带 `node_modules` 的包名会匹配项目目录，导致单文件产物（`check_project.mjs` 有 `BROAD_ADAPTER_CHUNK`）。
- 图片宿主属性边界是上游 ADR-0011/0012 的硬约束：`onload` / `onerror` getter 在非派发期间必须返回桥接函数，`src` 读取为数据属性时不得用 `defineProperty` 接管（「还原描述符再写一次」也不行）。0.1.8/0.1.9 的真机 P0 都源于违反这两条；脚手架、示例与文档里不要再引入图片访问器 workaround，`check_project.mjs` 有 `HOST_ACCESSOR_OVERRIDE`。
- 依赖精确锁定：`three@0.187.0`、`mini-three-adapter@0.1.9`。升级时同步 `assets/scaffold/package.json`、`SKILL.md` 的「脚手架验证记录」、以及 references 中引用的版本/体积数字。
- scaffold 的 `package.json` 是 `"type": "module"`（供 `vite.config.ts`、`postbuild.mjs` 使用），但构建产物是 CommonJS；`smoke.cjs` 会把 `dist` 复制到 `.smoke/` 并写入 `{"type":"commonjs"}` 再执行。不要把项目类型改成 commonjs，也不要提交 `dist/` 或 `.smoke/`。
- 文档和代码注释用简体中文；注释解释「为什么」（平台坑、求值顺序），不是复述代码。

## 内容准确性

- 文档与上游源码冲突时**以已安装的 `mini-three-adapter` 源码为准**；已确认上游 README / `docs/07` 的 `assets: { ... }` 配置无效，`docs/07` 的 `lib.formats: ['es']` 也不适用于小游戏（产物必须 CJS）。
- 平台额度注明「以开发者工具/MP 控制台当前额度为准」，不要把时效性数字写成永久结论。
- 本 Skill 必须自包含：文档中不要依赖某个本地工作区路径或外部 Skill。
