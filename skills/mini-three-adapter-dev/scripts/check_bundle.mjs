#!/usr/bin/env node
/**
 * 构建产物体检：体积预算、单文件产物、资源清单完整性。
 * 用法：node check_bundle.mjs <dist目录> [--json]
 * 退出码：0 = 通过，1 = 超预算 / 结构不合格。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const distArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
const dist = path.resolve(distArg ?? 'dist');
const MAIN_BUDGET = 4 * 1024 * 1024;
const WARN_AT = 3.2 * 1024 * 1024;
const TOTAL_BUDGET = 30 * 1024 * 1024;

if (!existsSync(dist)) {
  console.error(`[check_bundle] 目录不存在: ${dist}`);
  process.exit(1);
}

const files = [];
const walk = async (dir, rel = '') => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(full, name);
    else files.push({ name, size: (await stat(full)).size });
  }
};
await walk(dist);
files.sort((a, b) => b.size - a.size);

const total = files.reduce((sum, f) => sum + f.size, 0);
const issues = [];
const add = (level, code, message, fix) => issues.push({ level, code, message, fix });
const mb = (n) => (n / 1024 / 1024).toFixed(2);

if (!files.some((f) => f.name === 'game.js')) add('ERROR', 'NO_GAME_JS', 'dist/ 缺少 game.js',
  '检查 vite.config.ts 的 build.lib.fileName 与 postbuild');
if (!files.some((f) => f.name === 'game.json')) add('WARN', 'NO_GAME_JSON', 'dist/ 缺少 game.json',
  'postbuild.mjs 应把根目录 game.json 拷进 dist/');

// 产物形态：three 必须在独立 chunk 里。
// 单文件 game.js 意味着 three 在脚本求值阶段就执行，作用域垫片会抛
// "Scoped global ... was read before a runtime was created"，表现为黑屏。
const lazyChunks = files.filter((f) => /^chunks\/.*\.js$/.test(f.name));
const entryFile = files.find((f) => f.name === 'game.js');
if (lazyChunks.length === 0) {
  add('ERROR', 'NO_LAZY_CHUNK', 'dist/ 没有 chunks/：three 被打进入了口，求值顺序会被破坏',
    '构建配置改成 output.format:"cjs" + chunkFileNames + manualChunks（见 check_project.mjs）');
} else {
  const entryText = await readFile(path.join(dist, 'game.js'), 'utf8').catch(() => '');
  if (!/require\(\s*["'][^"']*chunks\//.test(entryText)) {
    add('ERROR', 'CHUNKS_NOT_REQUIRED', 'chunks/ 存在但入口没有 require 它们',
      '确认 output.format 为 cjs 且 entryFileNames 为 game.js');
  }
  for (const chunk of lazyChunks) {
    const text = await readFile(path.join(dist, chunk.name), 'utf8').catch(() => '');
    if (/require\(\s*["'][^"']*game\.js["']\s*\)/.test(text)) {
      add('ERROR', 'CIRCULAR_CHUNK_IMPORT', `${chunk.name} 反向 require 入口 game.js（环形依赖）`,
        '用 manualChunks 把入口与 chunk 共用的模块（src/config、src/core 等）单独拆出');
    }
  }
  if (entryFile && entryFile.size > 400 * 1024) {
    add('WARN', 'ENTRY_BLOATED', `game.js ${mb(entryFile.size)} MB，入口应当只含启动逻辑`,
      '检查 manualChunks 是否命中 three / adapter');
  }
}

const manifestFile = files.find((f) => f.name === 'mini-three-assets.json');
if (!manifestFile) {
  add('WARN', 'NO_MANIFEST', '未找到 mini-three-assets.json', '确认 miniThree() 插件已装配且 manifest !== false');
} else {
  try {
    const manifest = JSON.parse(await readFile(path.join(dist, 'mini-three-assets.json'), 'utf8'));
    const build = manifest.build ?? {};
    if ((build.parseFailures ?? []).length > 0) add('ERROR', 'PARSE_FAILURES',
      `构建有 ${build.parseFailures.length} 个模块解析失败`, '查看 plugin.api.report().parseFailures；不要用正则替换');
    if ((build.missingAssets ?? []).length > 0) add('WARN', 'MISSING_ASSETS',
      `missingAssets: ${(build.missingAssets ?? []).join(', ')}`, '把资源放进 roots 或白名单化');
    if ((build.webgpuWarnings ?? []).length > 0) add('ERROR', 'WEBGPU_IMPORTS',
      '检测到 three/webgpu 导入', '改用 WebGL 构建目标');
    if ((build.modulesRewritten ?? 0) === 0) add('WARN', 'NOTHING_REWRITTEN',
      'modulesRewritten 为 0，插件可能没命中 three', '检查 include / optimizeDeps.exclude / Vite 预打包');
    for (const entry of manifest.entries ?? []) {
      if (!files.some((f) => f.name === entry.destination)) {
        add('WARN', 'ASSET_MISSING_IN_DIST', `manifest 声明的资源不在产物中: ${entry.destination}`, '检查 emitFile 与 roots');
      }
    }
  } catch {
    add('ERROR', 'BAD_MANIFEST', 'mini-three-assets.json 无法解析', '重新构建');
  }
}

if (total > MAIN_BUDGET) add('ERROR', 'OVER_BUDGET',
  `主包 ${mb(total)} MB 超过 4MB`, '裁剪 / 动态 import / CDN / 分包');
else if (total > WARN_AT) add('WARN', 'NEAR_BUDGET',
  `主包 ${mb(total)} MB 已达预算 80%`, '提前规划分包');

if (total > TOTAL_BUDGET) add('ERROR', 'OVER_TOTAL', `${mb(total)} MB 超过总包 30MB`,
  '按控制台当前额度调整');

const summary = { dist, totalBytes: total, totalMB: Number(mb(total)), fileCount: files.length,
  top: files.slice(0, 10).map((f) => ({ name: f.name, mb: Number(mb(f.size)) })), issues,
  ok: issues.every((i) => i.level !== 'ERROR') };

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`[check_bundle] ${dist}`);
  console.log(`  产物 ${files.length} 个文件，合计 ${mb(total)} MB`);
  console.log('  体积 Top10:');
  for (const f of files.slice(0, 10)) console.log(`    ${mb(f.size).padStart(7)} MB  ${f.name}`);
  for (const i of issues) {
    console.log(`  ${i.level.padEnd(5)} [${i.code}] ${i.message}`);
    if (i.fix) console.log(`         → ${i.fix}`);
  }
  console.log(`[check_bundle] ${summary.ok ? 'PASS' : 'FAIL'}`);
}
process.exitCode = summary.ok ? 0 : 1;
