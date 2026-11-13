import type { Quality, QualityInput } from '../core/types.js';

/**
 * 能力分级。场景只读 SceneContext.quality，不自己探测 wx。
 * 判定规则集中在这里，方便按机型回归表（docs/compat.md）迭代。
 */
export function resolveQuality(input: QualityInput): Quality {
  const { capabilities, rawPixelRatio, pixelRatioCap } = input;
  const lowMemory = capabilities.wasm === false || capabilities.baseLibraryVersion === '';

  if (!capabilities.webgl2 || lowMemory) {
    return {
      tier: 'low',
      maxPixelRatio: Math.min(1, pixelRatioCap),
      shadows: false,
      maxTextureSize: 1024,
      particleScale: 0.25,
    };
  }

  if (rawPixelRatio >= 3 || capabilities.triggerGC === false) {
    return {
      tier: 'mid',
      maxPixelRatio: Math.min(1.5, pixelRatioCap),
      shadows: false,
      maxTextureSize: 2048,
      particleScale: 0.6,
    };
  }

  return {
    tier: 'high',
    maxPixelRatio: Math.min(2, pixelRatioCap),
    shadows: true,
    maxTextureSize: 2048,
    particleScale: 1,
  };
}

/** 特性开关。默认全部关闭，按真机验证结果逐个打开。 */
export const FEATURES = {
  clearDepthWorkaround: false, // PMREM/后处理黑屏时再开，有额外开销
  postProcessing: false,
  iosHighPerformancePlus: false,
} as const;
