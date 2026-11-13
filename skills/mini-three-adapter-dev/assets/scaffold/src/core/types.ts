import type * as THREE from 'three';
import type { MiniThreeRuntime } from 'mini-three-adapter';
import type { DisposalGroup } from './DisposalGroup.js';
import type { EventBus } from './EventBus.js';

/** 由 runtime.capabilities 推导出的能力分级，场景只读它，不自己探测 wx。 */
export interface Quality {
  tier: 'low' | 'mid' | 'high';
  maxPixelRatio: number;
  shadows: boolean;
  maxTextureSize: number;
  particleScale: number;
}

/** 传给 config/env.ts 的最小能力快照（避免 core 依赖适配层运行时代码）。 */
export interface CapabilitySnapshot {
  webgl2: boolean;
  wasm: boolean;
  triggerGC: boolean;
  baseLibraryVersion: string;
}

export type QualityInput = {
  capabilities: CapabilitySnapshot;
  rawPixelRatio: number;
  pixelRatioCap: number;
};

/** 屏幕安全区 / 胶囊避让，单位 CSS 像素。 */
export interface UiInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface AppEvents {
  'scene:changed': { id: string };
  'quality:downgraded': Quality;
  'error': { message: string; cause?: unknown };
  [key: string]: unknown;
}

/** 场景拿到的全部依赖。业务层不 import 适配层运行时代码，只通过此上下文取用。 */
export interface SceneContext {
  runtime: MiniThreeRuntime;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: Quality;
  insets: UiInsets;
  bus: EventBus<AppEvents>;
  /** 场景自己的释放组；SceneManager 在 unmount 时自动 dispose。 */
  disposals: DisposalGroup;
}

/** 每个 scenes/<feature>/index.ts 都实现这个契约。 */
export interface Scene {
  readonly id: string;
  mount(ctx: SceneContext): void | Promise<void>;
  update?(deltaMs: number, timeMs: number): void;
  unmount(): void;
}

export type SceneFactory = () => Scene;
