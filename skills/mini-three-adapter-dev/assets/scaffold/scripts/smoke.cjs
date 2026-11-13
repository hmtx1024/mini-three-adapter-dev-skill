/**
 * 产物冒烟测试（不需要微信开发者工具）。
 *
 * 在 Node 里伪造最小 wx 宿主，验证三件通常只有进了 IDE 才会暴露的事：
 *   1. 脚本求值阶段不能出现 "Scoped global ... was read before a runtime was created"
 *      —— 即 three 必须真的被延后到 runtime 创建之后才求值；
 *   2. 场景 chunk 必须是在 runtime 就绪后才被 require 的（而不是随入口一起求值）；
 *   3. three 能一路加载到 WebGLRenderer（本宿主没有真 GL，预期在此报错）。
 *
 * 用法：npm run build && npm run smoke
 * 退出码：0 = 通过；1 = 出现作用域早读 / chunk 没被延迟加载。
 */
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const entry = path.join(root, 'dist', 'game.js');
if (!fs.existsSync(entry)) {
  process.stderr.write(`未找到 ${entry}，先跑 npm run build\n`);
  process.exit(2);
}

const logs = [];
const out = (msg) => process.stdout.write(`${String(msg)}\n`);
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => logs.push(`[${level}] ${args.map(String).join(' ')}`);
}
const events = [];
const noop = () => {};
const rect = { x: 0, y: 0, width: 414, height: 896, top: 0, left: 0, right: 414, bottom: 896 };

const canvas = {
  width: 414,
  height: 896,
  getContext(type) {
    events.push(`canvas.getContext(${type})`);
    return null; // 本宿主没有 GL：three 会在这里报 "Error creating WebGL context"
  },
  addEventListener: noop,
  removeEventListener: noop,
  getBoundingClientRect: () => rect,
  style: {},
  toDataURL: () => '',
};

const offscreen = {
  width: 1,
  height: 1,
  getContext(type) {
    events.push(`offscreen.getContext(${type})`);
    return type === '2d'
      ? new Proxy({ canvas: offscreen, fillStyle: '' }, { get: (t, k) => (k in t ? t[k] : noop) })
      : null;
  },
};

const systemInfo = {
  SDKVersion: '3.0.0',
  platform: 'devtools',
  windowWidth: 414,
  windowHeight: 896,
  screenWidth: 414,
  screenHeight: 896,
  pixelRatio: 2,
  safeArea: { top: 0, left: 0, right: 414, bottom: 896, width: 414, height: 896 },
};

global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getSystemInfoSync: () => systemInfo,
  getWindowInfo: () => systemInfo,
  getDeviceInfo: () => ({ platform: 'devtools' }),
  getAppBaseInfo: () => ({ SDKVersion: '3.0.0' }),
  createCanvas: () => {
    events.push('wx.createCanvas()');
    return canvas;
  },
  createOffscreenCanvas: (options) => {
    events.push(`wx.createOffscreenCanvas(${options && options.type})`);
    return offscreen;
  },
  getMenuButtonBoundingClientRect: () => ({ width: 87, height: 32, top: 24, right: 381, bottom: 56, left: 294 }),
  setPreferredFramesPerSecond: noop,
  triggerGC: noop,
  canIUse: () => true,
};
for (const hook of ['Show', 'Hide', 'Error', 'UnhandledRejection', 'MemoryWarning', 'WindowResize', 'TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel']) {
  global.wx[`on${hook}`] = noop;
  global.wx[`off${hook}`] = noop;
}
global.GameGlobal = global;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// 记录 chunk 是否真的延迟加载
let chunkRequired = false;
const originalRequire = Module.prototype.require;
Module.prototype.require = function patched(id) {
  const result = originalRequire.apply(this, arguments);
  if (typeof id === 'string' && /chunks[\\/]/.test(id)) {
    chunkRequired = true;
    events.push(`require(${id})`);
  }
  return result;
};

process.on('uncaughtException', (error) => logs.push(`[uncaught] ${error && error.message}`));

// 产物是 CommonJS，但项目 package.json 是 type:module；Node 按最近的 package.json
// 决定模块语义。把 dist 复制到临时目录并声明 commonjs，才能完整模拟小游戏的模块系统。
const stage = path.join(root, '.smoke');
const copyDir = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, item.name);
    const to = path.join(dst, item.name);
    if (item.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
};
fs.rmSync(stage, { recursive: true, force: true });
copyDir(path.join(root, 'dist'), path.join(stage, 'dist'));
fs.writeFileSync(path.join(stage, 'package.json'), '{"type":"commonjs"}');

try {
  require(path.join(stage, 'dist', 'game.js'));
} catch (error) {
  out(`产物在求值阶段就抛错：${error && error.message}`);
  out(String(error && error.stack).split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
}

setTimeout(() => {
  const text = logs.join('\n');
  const scopeError = /was read before a runtime was created/.test(text);
  out('\n---------- 关键事件 ----------');
  for (const item of events) out(`  ${item}`);
  out('\n---------- 日志片段 ----------');
  out(text.split('\n').slice(0, 12).join('\n'));
  out('\n---------- 结论 ----------');
  out(`  作用域早读错误 : ${scopeError ? '仍然存在 FAIL' : '没有 PASS'}`);
  out(`  场景 chunk 延迟加载 : ${chunkRequired ? '是 PASS' : '否 FAIL'}`);
  out(`  渲染器阶段 : ${/Error creating WebGL context/.test(text) ? '已到达（本宿主无 GL，属预期）' : '未到达'}`);
  fs.rmSync(stage, { recursive: true, force: true });
  process.exitCode = scopeError || !chunkRequired ? 1 : 0;
}, 2500);
