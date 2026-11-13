/** 构建期 / 运行期共享常量。业务代码禁止散落硬编码路径与数值。 */

/** 必须与 dist/mini-three-assets.json 的 decoderPaths 一致。 */
export const DECODER_BASE = 'assets/three/';

/** 远程资源域名：必须在 MP 后台 request/downloadFile 合法域名白名单内。 */
export const ASSET_CDN = 'https://cdn.example.com/game/';

/** 主包预算（字节）。留 20% 余量作为预警线。 */
export const MAIN_PACKAGE_BUDGET = 4 * 1024 * 1024;
export const MAIN_PACKAGE_WARN = 3.2 * 1024 * 1024;

/** 传给 createWeChatGameRuntime 的选项，集中在此便于机型分级调整。 */
export const RUNTIME_OPTIONS = {
  pixelRatioCap: 2,
  logLevel: 'warn',
  slowFrameThreshold: 33,
  normalizeWebGL: true,
  cacheContexts: true,
} as const;

/** 分包名（与 game.json 的 subpackages[].name 对应）。 */
export const SUBPACKAGES = {
  threeAssets: 'three-assets',
  stage1: 'stage1',
} as const;

export const DEFAULT_SCENE_ID = 'boot';
