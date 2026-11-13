import type * as THREE from 'three';

/**
 * 帧循环封装。用 renderer.setAnimationLoop（three 推荐 API），
 * 而不是裸 requestAnimationFrame 递归；pause 会真正注销回调，避免切后台耗电。
 */
export class Loop {
  private running = false;
  private last = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly tick: (deltaMs: number, timeMs: number) => void,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.renderer.setAnimationLoop((time: number) => {
      if (!this.running) return;
      const t = Number.isFinite(time) ? time : Date.now();
      // 切后台回来时 time 可能大跳，钳到 100ms 防止物理/动画爆炸
      const delta = this.last === 0 ? 16.67 : Math.min(t - this.last, 100);
      this.last = t;
      this.tick(delta, t);
      this.renderer.render(this.scene, this.camera);
    });
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.last = 0;
  }

  resume(): void {
    this.start();
  }
}
