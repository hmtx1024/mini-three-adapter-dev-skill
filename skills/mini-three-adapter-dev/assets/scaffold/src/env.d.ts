/// <reference types="vite/client" />

/**
 * 最小 wx 声明。只覆盖本模板用到的 API，避免引入官方 typings 造成与
 * mini-three-adapter 自带的结构化 WxLike 类型冲突。新增 API 时在此补声明，
 * 或改用 `wx.canIUse('...')` 做能力保护。
 */
interface WxWindowInfo {
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  screenWidth?: number;
  screenHeight?: number;
  safeArea?: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  SDKVersion?: string;
}

interface WxMenuRect {
  width: number; height: number; top: number; right: number; bottom: number; left: number;
}

interface WxGlobal {
  getWindowInfo(): WxWindowInfo;
  getMenuButtonBoundingClientRect?(): WxMenuRect | null;
  onShow?(cb: (arg?: unknown) => void): void;
  offShow?(cb: (arg?: unknown) => void): void;
  onHide?(cb: (arg?: unknown) => void): void;
  offHide?(cb: (arg?: unknown) => void): void;
  onError?(cb: (e: unknown) => void): void;
  offError?(cb: (e: unknown) => void): void;
  onUnhandledRejection?(cb: (e: unknown) => void): void;
  offUnhandledRejection?(cb: (e: unknown) => void): void;
  onMemoryWarning?(cb: (e: { level?: number }) => void): void;
  offMemoryWarning?(cb: (e: { level?: number }) => void): void;
  loadSubpackage?(o: { name: string; success?: () => void; fail?: (e: unknown) => void }): void;
  preDownloadSubpackage?(o: { packageType: 'workers'; success?: () => void; fail?: (e: unknown) => void }): void;
  triggerGC?(): void;
  env: { USER_DATA_PATH: string };
  canIUse?(schema: string): boolean;
  [key: string]: unknown;
}

declare const wx: WxGlobal;
declare const GameGlobal: Record<string, unknown> | undefined;
