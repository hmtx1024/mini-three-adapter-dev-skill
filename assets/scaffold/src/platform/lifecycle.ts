import type { DisposalGroup } from '../core/DisposalGroup.js';

export interface LifecycleHandlers {
  onShow?: () => void;
  onHide?: () => void;
  onMemoryWarning?: (level: number) => void;
}

/**
 * 把 wx 生命周期/错误事件接到应用，并把所有 off* 登记进 DisposalGroup。
 * 所有 API 用可选链保护：老基础库可能没有 off* / onMemoryWarning。
 * H5 / Node 环境没有 wx，直接跳过（双端共用同一份 app 代码）。
 */
export function wirePlatformLifecycle(group: DisposalGroup, handlers: LifecycleHandlers): void {
  if (typeof wx === 'undefined') return;

  if (handlers.onShow && typeof wx.onShow === 'function') {
    const cb = handlers.onShow;
    wx.onShow(cb);
    group.add(() => wx.offShow?.(cb));
  }

  if (handlers.onHide && typeof wx.onHide === 'function') {
    const cb = handlers.onHide;
    wx.onHide(cb);
    group.add(() => wx.offHide?.(cb));
  }

  if (handlers.onMemoryWarning && typeof wx.onMemoryWarning === 'function') {
    const handler = handlers.onMemoryWarning;
    const cb = (event: { level?: number }): void => handler(event?.level ?? 0);
    wx.onMemoryWarning(cb);
    group.add(() => wx.offMemoryWarning?.(cb));
  }

  const onError = (error: unknown): void => console.error('[wx:error]', error);
  if (typeof wx.onError === 'function') {
    wx.onError(onError);
    group.add(() => wx.offError?.(onError));
  }

  const onRejection = (error: unknown): void => console.error('[wx:unhandledRejection]', error);
  if (typeof wx.onUnhandledRejection === 'function') {
    wx.onUnhandledRejection(onRejection);
    group.add(() => wx.offUnhandledRejection?.(onRejection));
  }
}

/** 内存告警时尝试主动 GC。只在这里触碰 wx，保持上层与平台解耦。 */
export function triggerGC(): void {
  try {
    wx.triggerGC?.();
  } catch {
    // 部分基础库不支持，忽略
  }
}
