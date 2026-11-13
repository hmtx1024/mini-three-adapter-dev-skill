import { createBrowserRuntime } from 'mini-three-adapter/browser';
import { RUNTIME_OPTIONS } from '../config/constants.js';

/**
 * H5 双端入口：同一份 app/ 与 scenes/ 代码，零改动在浏览器里跑。
 * 日常业务逻辑迭代优先用它，不必开微信开发者工具。
 * 求值顺序与小游戏入口一致：先 runtime，再动态 import 场景。
 */
async function bootstrapH5(): Promise<void> {
  const canvas = document.getElementById('gl');
  const runtime = await createBrowserRuntime({
    ...RUNTIME_OPTIONS,
    canvas: canvas instanceof HTMLCanvasElement ? canvas : undefined,
  });
  console.log(runtime.report());

  const { GameApp } = await import('../app/GameApp.js');
  const app = new GameApp(runtime);
  await app.start();
}

void bootstrapH5().catch((error: unknown) => console.error('[h5] bootstrap failed', error));
