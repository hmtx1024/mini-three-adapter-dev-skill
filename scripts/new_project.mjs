#!/usr/bin/env node
/**
 * 从 assets/scaffold/ 生成一个新工程。
 * 用法：node new_project.mjs <目标目录> [--name "My Game"] [--appid wx...] [--force]
 */
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scaffold = path.join(skillRoot, 'assets', 'scaffold');

const argv = process.argv.slice(2);
const targetArg = argv.find((a) => !a.startsWith('--'));
if (!targetArg) {
  console.error('用法: node new_project.mjs <目标目录> [--name "名称"] [--appid wx...] [--force]');
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const force = argv.includes('--force');
const displayName = flag('name', path.basename(path.resolve(targetArg)));
const appid = flag('appid', 'touristappid');
const target = path.resolve(targetArg);

const exists = await access(target).then(() => true).catch(() => false);
if (exists && !force) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(target);
  if (entries.length > 0) {
    console.error(`[new_project] 目标目录非空: ${target}\n使用 --force 允许写入（不会删除已有文件）。`);
    process.exit(1);
  }
}

await mkdir(target, { recursive: true });
await cp(scaffold, target, { recursive: true, force: true });

// 替换占位符
const pkgPath = path.join(target, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
pkg.name = displayName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'mini-three-game';
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const cfgPath = path.join(target, 'project.config.json');
const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
cfg.projectname = displayName;
cfg.appid = appid;
await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

console.log(`[new_project] 已生成: ${target}`);
console.log('[new_project] 下一步:');
console.log('  cd ' + targetArg);
console.log('  npm install && npm run check');
console.log('  用微信开发者工具（小游戏模式）打开该目录，miniprogramRoot = dist/');
console.log(`  node "${path.join(skillRoot, 'scripts', 'check_project.mjs')}" .`);
