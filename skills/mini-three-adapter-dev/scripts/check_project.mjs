#!/usr/bin/env node
/**
 * 静态校验 mini-three-adapter 小游戏工程的硬规则。
 * 用法：node check_project.mjs <项目目录> [--json]
 *
 * 退出码：0 = 无 ERROR（可含 WARN），1 = 有 ERROR。
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';

const targetArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
if (!targetArg) {
  console.error('用法: node check_project.mjs <项目目录> [--json]');
  process.exit(1);
}
const root = path.resolve(targetArg);
const issues = [];

const add = (level, code, message, fix) => issues.push({ level, code, message, fix });
const read = async (rel) => {
  const file = path.join(root, rel);
  if (!existsSync(file)) return null;
  return readFile(file, 'utf8');
};
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

async function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ---------- 1. 必备文件 ----------
for (const rel of ['package.json', 'vite.config.ts', 'game.json', 'project.config.json', 'src/main.ts']) {
  if (!existsSync(path.join(root, rel))) add('ERROR', 'MISSING_FILE', `缺少 ${rel}`, '从 assets/scaffold/ 补齐');
}

// ---------- 1b. 预先收集全部源码（后续检查共用） ----------
const files = await walk(path.join(root, 'src'));
let srcAll = '';
for (const file of files) srcAll += `\n// FILE ${file}\n${stripComments(await readFile(file, 'utf8'))}`;
const allSourceText = () => srcAll;

// ---------- 2. 入口求值顺序 ----------
const main = await read('src/main.ts');
if (main) {
  if (/\bimport\s+(?![(])[^;]*?from\s*['"]three/.test(main) || /^\s*import\s*['"]three/s.test(main)) {
    add('ERROR', 'STATIC_THREE_IN_MAIN', 'main.ts 静态导入了 three，会破坏「先 runtime 后 three」的求值顺序',
      '把 three 相关导入移到入口之后的动态 import 模块里');
  }
  if (!/bootstrap|createWeChatGameRuntime/.test(main)) {
    add('WARN', 'NO_BOOTSTRAP', 'main.ts 未发现 bootstrap / createWeChatGameRuntime 调用', '确认入口确实创建 runtime');
  }
}
if (srcAll) {
  if (!/import\s*\(/.test(srcAll)) {
    add('ERROR', 'NO_DYNAMIC_IMPORT', '源码中没有动态 import，无法保证 three 在 runtime 之后求值',
      '在入口或 bootstrap 中：await createWeChatGameRuntime() 之后 await import("./app/GameApp.js")');
  }
  if (!/createWeChatGameRuntime\s*\(/.test(srcAll)) {
    add('ERROR', 'NO_RUNTIME_FACTORY', '源码中没有 createWeChatGameRuntime() 调用',
      '在 platform/bootstrap.ts 里创建唯一 runtime');
  }
}

// ---------- 3. 构建配置 ----------
const viteRaw = await read('vite.config.ts');
if (viteRaw) {
  const vite = stripComments(viteRaw); // 注释里可能出现 `assets: {}` / manualChunks 等说明文字
  if (!/miniThree\s*\(/.test(vite)) add('ERROR', 'NO_PLUGIN', 'vite.config.ts 未装配 miniThree() 插件',
    "import miniThree from 'mini-three-adapter/vite'; 并加入 plugins");
  if (/assets\s*:\s*\{/.test(vite)) add('ERROR', 'NESTED_ASSETS_OPTION',
    '插件配置使用了无效的 assets: { ... } 嵌套写法（上游 README 的错误示例）',
    '改成扁平选项：outputDir / brotli / roots / manifest');

  // 打包形态：CommonJS + 真分包。
  // inlineDynamicImports 不保留惰性：Rollup 只把 import() 变成已求值模块的 Promise 包装，
  // three 顶层的 __THREE__ 探测仍在脚本求值阶段执行 → 作用域早读 → 黑屏。
  const hasInline = /inlineDynamicImports\s*:\s*true/.test(vite);
  const hasChunkName = /chunkFileNames\s*:/.test(vite);
  const hasManualChunks = /manualChunks\s*[:(]/.test(vite);

  if (hasInline) {
    add('ERROR', 'INLINE_DYNAMIC_IMPORTS_BREAKS_EVAL_ORDER',
      'inlineDynamicImports: true 会把 three 打进入口，动态 import 退化成已求值模块的 Promise 包装',
      '删除该选项；改用 output.format: "cjs" + chunkFileNames: "chunks/[name]-[hash].js"');
  }
  if (!hasChunkName && !hasManualChunks) {
    add('ERROR', 'NO_LAZY_CHUNK', '构建配置没有拆分 chunk，three 会落进入口并在脚本求值阶段执行',
      'output.chunkFileNames: "chunks/[name]-[hash].js"，入口随后 require 场景 chunk');
  }
  if (/format\s*:\s*['"]es['"]/.test(vite)) {
    add('ERROR', 'ESM_OUTPUT', '产物格式为 ESM，小游戏模块系统是 CommonJS，import() 加载 chunk 不可靠',
      '改 output.format: "cjs"，用 require 加载 chunk');
  } else if (!/format\s*:\s*['"]cjs['"]/.test(vite)) {
    add('WARN', 'FORMAT_NOT_CJS', '未显式声明 output.format: "cjs"',
      '显式写死 cjs，避免 Vite 默认输出 ESM');
  }
  if (!/preserveEntrySignatures\s*:\s*false/.test(vite)) {
    add('WARN', 'ENTRY_EXPORTS_SHARED',
      '未设置 preserveEntrySignatures: false，入口导出可能被提升为 chunk 的共享依赖',
      '在 rollupOptions（input 级）设置 preserveEntrySignatures: false，否则 chunk 会反向 require 入口');
  }
  if (!/modulePreload\s*:\s*false/.test(vite)) {
    add('WARN', 'MODULE_PRELOAD_ON', '未关闭 build.modulePreload，其垫片引用 window/dispatchEvent',
      '设置 build.modulePreload: false');
  }
  if (hasChunkName && !hasManualChunks) {
    add('WARN', 'NO_MANUAL_CHUNKS',
      '未使用 manualChunks 拆分共享模块，入口与场景共用的模块可能被留在入口形成环形依赖',
      '至少拆 adapter / three / src/config+core 三组');
  }
  if (hasManualChunks && !/node_modules\/three/.test(vite)) {
    add('WARN', 'NO_THREE_CHUNK_RULE', 'manualChunks 未单独拆分 three',
      "if (id.includes('/node_modules/three/')) return 'three'");
  }
  if (/id\.includes\(['"]mini-three-adapter['"]\)/.test(vite)) {
    add('ERROR', 'BROAD_ADAPTER_CHUNK',
      "manualChunks 用了 id.includes('mini-three-adapter')，会匹配项目目录名，导致所有模块进入同一组、退化成单文件",
      "改成 id.includes('/node_modules/mini-three-adapter/')");
  }
  if (!/target\s*:\s*['"]es2019['"]/.test(vite)) add('WARN', 'TARGET_NOT_ES2019',
    'build.target 不是 es2019，开发者工具可能报 ?. / ?? 语法错误', "设置 build.target: 'es2019'");
  if (!/entryFileNames\s*:\s*['"]game\.js['"]/.test(vite) && !/fileName\s*:\s*\(\)\s*=>\s*['"]game\.js['"]/.test(vite)) {
    add('WARN', 'NO_GAME_JS', '入口产物文件名不是固定的 game.js',
      'output.entryFileNames: "game.js"（或 build.lib.fileName: () => "game.js"）');
  }
}

// ---------- 4. 依赖 ----------
const pkgRaw = await read('package.json');
if (pkgRaw) {
  try {
    const pkg = JSON.parse(pkgRaw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const adapter = deps['mini-three-adapter'];
    if (!adapter) add('ERROR', 'NO_ADAPTER', '未声明 mini-three-adapter 依赖', 'npm i mini-three-adapter@0.1.11');
    else {
      if (/^[~^]/.test(String(adapter))) add('WARN', 'ADAPTER_NOT_PINNED',
        `mini-three-adapter ${adapter} 未锁定精确版本`, '使用精确版本（当前 0.1.11），升级走独立流程');
      const am = String(adapter).match(/(\d+)\.(\d+)\.(\d+)/);
      if (am && Number(am[1]) === 0 && (Number(am[2]) < 1 || (Number(am[2]) === 1 && Number(am[3]) < 11))) {
        add('WARN', 'ADAPTER_OUTDATED',
          `mini-three-adapter ${adapter} 早于 0.1.11，缺少真机图片事件修复、data: 对象 URL 与 createImage 取图入口（<0.1.8 真机纹理可能全部空白）`,
          '升级到 0.1.11；升级后按 references/05-workflows.md §15 → §14 回归真机图片与对象 URL');
      }
    }
    const three = deps.three;
    if (!three) add('ERROR', 'NO_THREE', '未声明 three 依赖', 'npm i three');
    else {
      const m = String(three).match(/(\d+)\.(\d+)\.(\d+)/);
      if (m && Number(m[1]) === 0 && Number(m[2]) < 163) {
        add('ERROR', 'THREE_TOO_OLD', `three ${three} < 0.163.0，WebGLRenderer 已不支持 WebGL1`, '升级到 >= 0.163.0');
      }
      if (/^[~^]/.test(String(three))) add('WARN', 'THREE_NOT_PINNED',
        `three ${three} 未锁定精确版本，升级可能导致黑屏`, '使用精确版本并走独立升级流程');
    }
  } catch {
    add('ERROR', 'BAD_PACKAGE_JSON', 'package.json 不是合法 JSON', '修复 JSON');
  }
}

// ---------- 5. game.json / project.config.json ----------
const gameRaw = await read('game.json');
if (gameRaw) {
  try {
    const game = JSON.parse(gameRaw);
    if (!game.subpackages || !Array.isArray(game.subpackages)) add('WARN', 'NO_SUBPACKAGES',
      'game.json 未配置 subpackages', '按 dist/mini-three-assets.json 的 gameJsonSuggestion 合并');
    if (game.workers && game.workers.isSubpackage === true && !/preDownloadSubpackage/.test(allSourceText())) {
      add('WARN', 'WORKERS_NOT_PRELOADED',
        'workers 配置为分包但源码里没找到 wx.preDownloadSubpackage',
        "创建 Worker 前先 wx.preDownloadSubpackage({ packageType: 'workers' })");
    }
    if (game.workers && game.subpackages) {
      const roots = game.subpackages.map((p) => String(p.root).replace(/\/$/, ''));
      const workerPath = String(game.workers.path).replace(/\/$/, '');
      if (!roots.includes(workerPath)) add('WARN', 'WORKER_DIR_MISMATCH',
        'workers.path 与 subpackages[].root 不一致', 'worker 与 wasm 必须输出到同一个目录');
    }
    if (game.iOSHighPerformance === true || game['iOSHighPerformance+'] === true) add('WARN', 'HP_ENABLED',
      '已开启 iOS 高性能/高性能+ 模式', '确认已真机验证 WebGL2、内存峰值与 RGBA 纹理格式');
  } catch {
    add('ERROR', 'BAD_GAME_JSON', 'game.json 不是合法 JSON', '修复 JSON');
  }
}
const projRaw = await read('project.config.json');
if (projRaw) {
  try {
    const proj = JSON.parse(projRaw);
    if (proj.compileType !== 'game') add('ERROR', 'NOT_GAME', 'project.config.json 的 compileType 不是 "game"',
      '小游戏入口是 game.js + game.json，不是小程序 app.js');
    if (!String(proj.miniprogramRoot ?? '').includes('dist')) add('WARN', 'ROOT_NOT_DIST',
      'miniprogramRoot 未指向 dist/', '设置 miniprogramRoot: "dist/"');
    if (proj.setting?.urlCheck === false) add('WARN', 'URL_CHECK_OFF',
      '开发者工具关闭了合法域名校验', '上线前恢复校验并在 MP 后台配置合法域名');
  } catch {
    add('ERROR', 'BAD_PROJECT_CONFIG', 'project.config.json 不是合法 JSON', '修复 JSON');
  }
}

// ---------- 6. 全量源码规则 ----------
const rules = [
  [/\bwx\.createCanvas\s*\(/, 'ERROR', 'WX_CREATE_CANVAS', '业务代码调用了 wx.createCanvas()（会偷走唯一上屏画布）',
    '额外画布改用 runtime.createCanvas() 或 document.createElement("canvas")'],
  [/\bObject\.setPrototypeOf\s*\(/, 'ERROR', 'SET_PROTOTYPE', '使用了 Object.setPrototypeOf（破坏宿主对象身份校验）',
    '适配层用就地 defineProperty；业务代码不要改原型'],
  [/new\s+Proxy\s*\([^)]*canvas/i, 'ERROR', 'PROXY_CANVAS', '用 Proxy 包装了 canvas',
    '禁止任何包装/克隆，宿主按对象身份校验'],
  [/globalThis\.(window|document|self)\s*=/, 'ERROR', 'GLOBAL_POLLUTION', '直接写 globalThis.window/document',
    '用 MiniThreeScope；确需全局时显式 installGlobals() 且可逆'],
  [/from\s*['"]three\/webgpu|WebGPURenderer/, 'ERROR', 'WEBGPU', '使用了 three/webgpu 或 WebGPURenderer',
    '小游戏无 WebGPU，改用 WebGLRenderer / WebGL 构建目标'],
  [/\beval\s*\(|new\s+Function\s*\(/, 'WARN', 'DYNAMIC_EVAL', '源码包含 eval / new Function（小游戏禁用动态执行）',
    '换实现或预编译；注意注释里的字符串会被排除'],
  [/\bnew\s+URL\s*\(/, 'WARN', 'BARE_URL_CTOR', '应用代码使用了 new URL()（业务代码不会被插件改写，小游戏无全局 URL）',
    '用字符串拼接，或从 runtime.scope.URL 取'],
  [/\binstallGlobals\s*:\s*true/, 'WARN', 'GLOBALS_OPT_IN', 'installGlobals: true 已启用（全局注入逃生舱）',
    '优先改成动态 import 求值顺序；保留时确认可逆与 dispose'],
  [/capabilities\s*:\s*\{[^}]*\bwebgl2\s*:\s*false/, 'WARN', 'HARDCODED_WEBGL2_FALSE',
    '用 capabilities.webgl2: false 覆盖了适配层探测结果', '让适配层探测；看 webgl2Source，inferred=false 只是推断，以渲染器创建成功为准'],
  [/Object\.defineProperty\s*\(\s*[\w$.]*(?:img|image|host|raw|texture)[\w$]*\s*,\s*['"](?:src|onload|onerror)['"]/i, 'WARN', 'HOST_ACCESSOR_OVERRIDE',
    '在图片宿主对象上用 defineProperty 接管 src / onload / onerror（0.1.5 时代的 workaround）',
    '删除；数据属性 src 必须直通宿主 interceptor，onload getter 由适配层维护（ADR-0011/0012）'],
  [/mini-three-blob:/, 'WARN', 'LEGACY_OBJECT_URL_PREFIX',
    '硬编码了 mini-three-blob: 前缀（0.1.10 起 URL.createObjectURL 直接返回 data: URI）',
    '按 data: 字符串处理；revokeObjectURL 已是 no-op，不要依赖旧前缀或对象 URL 可 fetch（ADR-0013）'],
];
for (const [re, level, code, message, fix] of rules) {
  if (re.test(srcAll)) add(level, code, message, fix);
}

// DOM 全局（H5 专用文件除外）
const domFiles = files.filter((f) => !/\.h5\./.test(f));
for (const file of domFiles) {
  const text = stripComments(await readFile(file, 'utf8'));
  if (/\bdocument\.(createElement|getElementById|body|querySelector)/.test(text) || /\bwindow\.(innerWidth|innerHeight|devicePixelRatio)/.test(text)) {
    add('WARN', 'BARE_DOM_GLOBAL', `${path.relative(root, file)} 使用了裸 DOM/BOM 全局（业务代码不会被插件改写）`,
      '通过 runtime.document / runtime.windowInfo / runtime.scope 取用');
  }
}

// 生命周期接线
if (srcAll && !/setAnimationLoop/.test(srcAll)) add('ERROR', 'NO_ANIMATION_LOOP',
  '未发现 renderer.setAnimationLoop', '用 three 的 setAnimationLoop，不要裸 rAF 递归');
for (const [event, code] of [['resize', 'NO_RESIZE'], ['visibilitychange', 'NO_VISIBILITY'], ['dispose', 'NO_DISPOSE']]) {
  if (srcAll && !new RegExp(`['"]${event}['"]`).test(srcAll)) {
    add('WARN', code, `未发现 runtime.on('${event}') 接线`, '按 SKILL 硬规则 6 补齐');
  }
}
if (srcAll && !/\.dispose\s*\(/.test(srcAll)) add('WARN', 'NO_DISPOSE_CALL',
  '未发现任何 dispose() 调用', '用 DisposalGroup 统一释放订阅与 three 资源');

// ---------- 7. 已有产物的形态（dist/ 存在时才查，纯静态兜底） ----------
const distGameJs = path.join(root, 'dist', 'game.js');
if (existsSync(distGameJs)) {
  const size = statSync(distGameJs).size;
  const chunkDir = path.join(root, 'dist', 'chunks');
  const chunkFiles = existsSync(chunkDir) ? readdirSync(chunkDir).filter((f) => f.endsWith('.js')) : [];

  if (chunkFiles.length === 0) {
    add('ERROR', 'NO_CHUNKS_IN_DIST',
      `dist/game.js 有 ${(size / 1024).toFixed(0)} KB 但没有 chunks/：three 被打进入了口`,
      '修正构建配置（CJS + chunkFileNames + manualChunks）后重新 build');
  } else {
    if (size > 400 * 1024) add('WARN', 'ENTRY_LOOKS_BLOATED',
      `dist/game.js ${(size / 1024).toFixed(0)} KB，入口应当只含启动逻辑`,
      '检查 manualChunks 是否真的命中了 three / adapter');
    const entryText = await readFile(distGameJs, 'utf8');
    if (!/require\(\s*["'][^"']*chunks\//.test(entryText)) add('WARN', 'CHUNKS_NOT_REQUIRED',
      'dist/game.js 没有 require chunks，拆出来的 chunk 可能没被用上',
      '确认入口是 output.entryFileNames: "game.js"，且 format 为 cjs');
    for (const name of chunkFiles) {
      const text = await readFile(path.join(chunkDir, name), 'utf8');
      if (/require\(\s*["'][^"']*game\.js["']\s*\)/.test(text)) {
        add('ERROR', 'CIRCULAR_CHUNK_IMPORT', `chunks/${name} 反向 require 了入口 game.js（环形依赖）`,
          '用 manualChunks 把共享模块（src/config、src/core 等）拆成独立 chunk');
      }
    }
  }
}

// ---------- 输出 ----------
const errors = issues.filter((i) => i.level === 'ERROR');
const warns = issues.filter((i) => i.level === 'WARN');
if (asJson) {
  console.log(JSON.stringify({ root, errors, warns, ok: errors.length === 0 }, null, 2));
} else {
  console.log(`[check_project] ${root}`);
  if (issues.length === 0) console.log('  OK  全部硬规则通过');
  for (const i of issues) {
    console.log(`  ${i.level.padEnd(5)} [${i.code}] ${i.message}`);
    if (i.fix) console.log(`         → ${i.fix}`);
  }
  console.log(`[check_project] ${errors.length} error(s), ${warns.length} warning(s)`);
}
process.exitCode = errors.length > 0 ? 1 : 0;
