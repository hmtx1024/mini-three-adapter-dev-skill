import type { MiniThreeRuntime } from 'mini-three-adapter'; // type-only
import { DisposalGroup } from '../core/DisposalGroup.js';
import { EventBus } from '../core/EventBus.js';
import type { AppEvents, SceneContext } from '../core/types.js';
import { resolveQuality } from '../config/env.js';
import { DEFAULT_SCENE_ID, RUNTIME_OPTIONS } from '../config/constants.js';
import { readUiInsets } from '../platform/device.js';
import { triggerGC, wirePlatformLifecycle } from '../platform/lifecycle.js';
import { createRenderContext } from '../render/Renderer.js';
import { createBootScene } from '../scenes/boot/index.js';
import { Loop } from './Loop.js';
import { SceneManager } from './SceneManager.js';

/**
 * 应用编排：唯一持有 runtime、渲染上下文、场景管理与帧循环的对象。
 * 所有订阅/资源都登记在 root DisposalGroup，destroy() 一次释放干净。
 */
export class GameApp {
  private readonly root = new DisposalGroup();
  private readonly bus = new EventBus<AppEvents>();
  private readonly scenes: SceneManager;
  private readonly loop: Loop;
  private released = false;

  constructor(private readonly runtime: MiniThreeRuntime) {
    const caps = runtime.capabilities;

    // ★ 渲染器创建成功，就是 WebGL2 可用的唯一权威证据。
    // 不要拿探测/推断结果压画质：webgl2Source === 'inferred' 时 false 只是按基础库
    // 版本的猜测，开发者工具也常出现离屏探测假阴性，而屏幕画布渲染完全正常。
    const render = createRenderContext(runtime, this.root);
    if (!caps.webgl2) {
      console.warn(
        `[game] capabilities.webgl2=${caps.webgl2} (source=${caps.webgl2Source ?? 'unknown'})，` +
          '但屏幕画布已建成渲染器：以渲染器为准，画质按可用处理。',
      );
    }

    const quality = resolveQuality({
      capabilities: {
        webgl2: true, // 见上：能走到这里就说明 WebGL2 真的可用
        wasm: caps.wasm,
        triggerGC: caps.triggerGC,
        baseLibraryVersion: caps.baseLibraryVersion,
      },
      rawPixelRatio: runtime.windowInfo.rawPixelRatio,
      pixelRatioCap: RUNTIME_OPTIONS.pixelRatioCap,
    });
    console.log('[game] quality tier:', quality.tier, 'baseLibrary:', caps.baseLibraryVersion);

    const ctx: SceneContext = {
      runtime,
      renderer: render.renderer,
      scene: render.scene,
      camera: render.camera,
      quality,
      insets: readUiInsets(),
      bus: this.bus,
      disposals: this.root,
    };

    this.scenes = new SceneManager(ctx).register(DEFAULT_SCENE_ID, createBootScene);
    this.loop = new Loop(render.renderer, render.scene, render.camera, (delta, time) => {
      this.scenes.emitUpdate(delta, time);
    });

    this.root.add(() => this.scenes.dispose());
    this.root.add(() => this.bus.clear());
    this.wire();
  }

  async start(): Promise<void> {
    await this.scenes.switchTo(DEFAULT_SCENE_ID);
    this.loop.start();
  }

  /** 页面 onUnload / 游戏退出时调用。幂等，且会释放 runtime。 */
  destroy(): void {
    this.release();
    if (!this.runtime.disposed) this.runtime.dispose();
  }

  private wire(): void {
    this.root.add(this.runtime.on('visibilitychange', (visible) => {
      if (visible) this.loop.resume();
      else this.loop.pause();
    }));
    this.root.add(this.runtime.on('dispose', () => this.release()));

    wirePlatformLifecycle(this.root, {
      onShow: () => {
        // 无 wx.onWindowResize 的基础库靠这里补一次重新测量
        void this.runtime.resize().then(() => {
          if (!this.released) this.loop.resume();
        });
      },
      onHide: () => this.loop.pause(),
      onMemoryWarning: (level) => {
        console.warn('[game] memory warning, level =', level);
        triggerGC();
        this.bus.emit('error', { message: `memory warning level ${level}` });
      },
    });
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.loop.pause();
    this.root.dispose();
  }
}
