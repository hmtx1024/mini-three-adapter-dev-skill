import { ASSET_CDN, SUBPACKAGES } from '../config/constants.js';

/**
 * ★ 资源单一数据源。所有 loader 只认 AssetId，不散落路径字符串。
 * 新增资源只改这张表；分包迁移时改 subpackage 字段即可。
 */
export const ASSETS = {
  hero: {
    id: 'hero',
    url: 'models/hero.glb',
    kind: 'gltf',
    subpackage: SUBPACKAGES.stage1,
    remote: true,
  },
  envMap: {
    id: 'envMap',
    url: 'textures/env.ktx2',
    kind: 'ktx2',
    subpackage: SUBPACKAGES.stage1,
    remote: true,
  },
  uiAtlas: {
    id: 'uiAtlas',
    url: 'textures/ui.png',
    kind: 'image',
    subpackage: null,
    remote: false,
  },
} as const;

export type AssetId = keyof typeof ASSETS;
export type AssetEntry = (typeof ASSETS)[AssetId];

/**
 * 远程资源 URL 必须落在 MP 后台合法域名白名单内。
 * 注意：应用代码**不会**被构建插件改写，因此这里不能用 `new URL()`
 * （小游戏运行时没有全局 URL 构造器；只有被改写的三方模块能拿到 MiniURL）。
 */
export function resolveAssetUrl(id: AssetId): string {
  const entry = ASSETS[id];
  if (entry.remote) return ASSET_CDN + entry.url;
  // 包内相对路径不能用 fetch/XHR 读取，需 wx.getFileSystemManager().readFile()
  return entry.url;
}

/** 校验资源 id 是否存在（供测试与运行时防御）。 */
export function assertAssetId(value: string): asserts value is AssetId {
  if (!(value in ASSETS)) throw new Error(`[assets] unknown asset id: ${value}`);
}
