/**
 * 构建后处理：把小游戏静态配置拷进 dist/，校验资源清单，输出可执行提示。
 * 由 `npm run build` 在 vite build 之后调用。
 */
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });

// 1) game.json 必须位于 miniprogramRoot（插件不会自动改/拷 game.json）
await copyFile(path.join(root, 'game.json'), path.join(out, 'game.json'));

// 2) 检查插件产出的资源清单
const manifestPath = path.join(out, 'mini-three-assets.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entries = manifest.entries ?? [];
  const build = manifest.build ?? {};
  console.log(`[mini-three] assets emitted: ${entries.length}`);
  console.log(`[mini-three] modules rewritten: ${build.modulesRewritten ?? 0}, rewrites: ${build.rewrites ?? 0}`);

  if ((build.parseFailures ?? []).length > 0) {
    console.error('[mini-three] parseFailures:', build.parseFailures);
    process.exitCode = 1;
  }
  if ((build.missingAssets ?? []).length > 0) {
    console.warn('[mini-three] missingAssets (put them under roots or whitelist them):', build.missingAssets);
  }
  if ((build.webgpuWarnings ?? []).length > 0) {
    console.warn('[mini-three] three/webgpu detected; use the WebGL build target.');
  }

  const suggestion = manifest.gameJsonSuggestion ?? {};
  if (Object.keys(suggestion).length > 0) {
    const target = path.join(out, 'game.json.suggestion.json');
    await writeFile(target, JSON.stringify(suggestion, null, 2));
    console.log('[mini-three] merge gameJsonSuggestion into game.json ->', target);
  }
  if (Object.keys(manifest.decoderPaths ?? {}).length > 0) {
    console.log('[mini-three] decoderPaths must match src/config/constants.ts ->', manifest.decoderPaths);
  }
} else {
  console.warn('[mini-three] mini-three-assets.json not found: is miniThree() plugin configured?');
}

// 3) 产物体积预算（主包 4MB，留 20% 余量预警）
//    产物是多文件（game.js + chunks/*），必须整目录累计：只看 game.js 会严重低估。
const { readdir } = await import('node:fs/promises');
const walk = async (dir) => {
  let sum = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    sum += entry.isDirectory() ? await walk(full) : (await stat(full)).size;
  }
  return sum;
};
const total = await walk(out);
const gameJsPath = path.join(out, 'game.js');
const gameJs = existsSync(gameJsPath) ? (await stat(gameJsPath)).size : 0;
const chunkDir = path.join(out, 'chunks');
const chunkCount = existsSync(chunkDir) ? (await readdir(chunkDir)).length : 0;
const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(
  `[mini-three] game.js = ${(gameJs / 1024).toFixed(1)} KB, chunks = ${chunkCount}, dist total = ${mb(total)} MB`,
);
if (chunkCount === 0) {
  console.error('[mini-three] 没有产出 chunks/：three 被打进入了入口，求值顺序会被破坏（见 vite.config.ts 约束 2）');
  process.exitCode = 1;
}
if (gameJs > 400 * 1024) {
  console.error(`[mini-three] game.js ${(gameJs / 1024).toFixed(0)} KB 过大，入口应当只含启动逻辑`);
  process.exitCode = 1;
}
if (total > 4 * 1024 * 1024) {
  console.error('[mini-three] main package exceeds 4MB. Move three/wasm/models to a subpackage or CDN.');
  process.exitCode = 1;
} else if (total > 3.2 * 1024 * 1024) {
  console.warn('[mini-three] main package > 3.2MB (80% of budget). Plan subpackages now.');
}

console.log('[mini-three] open 微信开发者工具 with project root:', root, '(miniprogramRoot = dist/)');
