import { DisposalGroup } from '../core/DisposalGroup.js';
import type { Scene, SceneContext, SceneFactory } from '../core/types.js';

interface ActiveScene {
  id: string;
  scene: Scene;
  group: DisposalGroup;
}

/**
 * 场景注册表与切换器。切换时先释放旧场景的 DisposalGroup 再挂载新场景，
 * 从结构上杜绝「切场景不释放 → 内存持续上涨」。
 */
export class SceneManager {
  private readonly factories = new Map<string, SceneFactory>();
  private active: ActiveScene | null = null;

  constructor(private readonly base: SceneContext) {}

  register(id: string, factory: SceneFactory): this {
    this.factories.set(id, factory);
    return this;
  }

  get currentId(): string | null {
    return this.active?.id ?? null;
  }

  async switchTo(id: string): Promise<void> {
    if (this.active?.id === id) return;
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`[SceneManager] unknown scene: ${id}`);

    this.unmountActive();

    const group = new DisposalGroup();
    const scene = factory();
    const ctx: SceneContext = { ...this.base, disposals: group };
    try {
      await scene.mount(ctx);
    } catch (error) {
      group.dispose();
      throw error;
    }

    this.active = { id, scene, group };
    this.base.bus.emit('scene:changed', { id });
  }

  emitUpdate(deltaMs: number, timeMs: number): void {
    this.active?.scene.update?.(deltaMs, timeMs);
  }

  dispose(): void {
    this.unmountActive();
    this.factories.clear();
  }

  private unmountActive(): void {
    const current = this.active;
    if (!current) return;
    this.active = null;
    try {
      current.scene.unmount();
    } finally {
      current.group.dispose();
    }
  }
}
