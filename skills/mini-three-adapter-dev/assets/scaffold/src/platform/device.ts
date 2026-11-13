import type { UiInsets } from '../core/types.js';

/** 无安全区 / 胶囊信息时的安全兜底。 */
const EMPTY: UiInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * 计算 HUD 需要避让的边距。
 * getMenuButtonBoundingClientRect 在部分安卓机型/早于界面就绪时返回 null 或异常值，必须容错。
 */
export function readUiInsets(): UiInsets {
  if (typeof wx === 'undefined') return EMPTY;
  try {
    const info = wx.getWindowInfo();
    const safe = info.safeArea;
    if (!safe) return EMPTY;

    const menu = wx.getMenuButtonBoundingClientRect?.();
    const menuBottom = menu && Number.isFinite(menu.bottom) && menu.bottom > 0 && menu.bottom < info.windowHeight
      ? menu.bottom
      : safe.top;

    return {
      top: Math.max(safe.top, menuBottom),
      bottom: Math.max(0, info.windowHeight - safe.bottom),
      left: Math.max(0, safe.left),
      right: Math.max(0, info.windowWidth - safe.right),
    };
  } catch {
    return EMPTY;
  }
}
