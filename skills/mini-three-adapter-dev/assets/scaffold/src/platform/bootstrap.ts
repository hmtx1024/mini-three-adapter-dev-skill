import { createWeChatGameRuntime } from 'mini-three-adapter/wechat-game';
import type { MiniThreeRuntime } from 'mini-three-adapter';
import { RUNTIME_OPTIONS } from '../config/constants.js';

/**
 * ★ 全项目唯一创建 runtime 的地方，也是唯一 import 适配层运行时代码的文件。
 *
 * 求值顺序（不可调整）：
 *   1) await createWeChatGameRuntime()  —— 安装 MiniThreeScope / 补丁画布
 *   2) await import('../app/GameApp.js') —— 此后 three 及 addons 才被求值
 *
 * 第 2 步能真正「延后」的前提是构建产物把 three 拆成独立 chunk（见 vite.config.ts）。
 * 一旦退回单文件打包，three 顶层的 window.__THREE__ 探测就会早于 runtime 创建，
 * 作用域垫片抛 "Scoped global ... was read before a runtime was created"。
 *
 * 若某个三方库无法被构建插件改写（读真实全局），才打开 installGlobals: true；
 * 它是可逆的逃生舱，不是默认路径。
 *
 * 能力探测由适配层负责（0.1.7）：
 *   - 优先用 wx.createOffscreenCanvas()；
 *   - 小游戏在离屏 API 存在、上屏画布已解析时，才回退第二次 createCanvas()，
 *     并按 reservedCanvases 做对象身份守卫，避免把上屏画布探测废掉；
 *   - 探测不到不等于不支持：按基础库版本推断，webgl2Source 标为 'inferred'。
 * 因此业务层不要再手写 1x1 离屏探测去覆盖 capabilities（0.1.1 时代的 workaround）。
 */

export async function bootstrap(): Promise<MiniThreeRuntime> {
  const runtime = await createWeChatGameRuntime(RUNTIME_OPTIONS);

  // 能力报告：真机排错的第一份证据，务必保留。
  // webgl2Source: probe=实测 / inferred=按基础库推断 / override=调用方覆盖。
  console.log(runtime.report());
  runtime.on('error', (error) => console.error('[runtime] error', error));

  const { GameApp } = await import('../app/GameApp.js');
  const app = new GameApp(runtime);
  await app.start();

  // 小程序页面 onUnload / 游戏退出时调用 app.destroy()（内部会 runtime.dispose()）
  return runtime;
}
