import { SUBPACKAGES } from '../config/constants.js';

/** 下载并执行分包代码（wx.loadSubpackage 会自动执行）。 */
export function loadSubpackage(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof wx.loadSubpackage !== 'function') {
      reject(new Error(`[subpackage] wx.loadSubpackage unavailable: ${name}`));
      return;
    }
    wx.loadSubpackage({ name, success: () => resolve(), fail: (error) => reject(error) });
  });
}

/**
 * Worker 分包预下载。
 * 基础库 2.27.3+ 且 workers.isSubpackage=true 时，必须先预下载成功，
 * 再 wx.createWorker()；且 Worker 并发上限为 1，用完要 terminate()。
 * 老基础库没有该 API 时视为 worker 在主包，直接放行。
 */
export function preDownloadWorkers(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof wx.preDownloadSubpackage !== 'function') {
      resolve();
      return;
    }
    wx.preDownloadSubpackage({
      packageType: 'workers',
      success: () => resolve(),
      fail: (error) => reject(error),
    });
  });
}

/** 首屏之后按需加载关卡/资源分包。 */
export async function loadStage1(): Promise<void> {
  await preDownloadWorkers();
  await loadSubpackage(SUBPACKAGES.threeAssets);
  await loadSubpackage(SUBPACKAGES.stage1);
}
