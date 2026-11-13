/**
 * ★ 唯一入口。静态依赖图里绝对不能出现 `three`。
 *
 * ESM 静态导入会在模块体执行前求值；three 及其 addons 在初始化时会读取
 * 作用域对象，因此必须先 createRuntime()，再动态 import 场景模块。
 *
 * 这个「延后」只有在构建产物把 three 拆成独立 chunk 时才真正生效（见 vite.config.ts）。
 * 单文件打包下 Rollup 只会把 import() 变成已求值模块的 Promise 包装，three 的顶层
 * 语句照样在脚本求值阶段执行 —— 那正是黑屏的成因。
 */
import { bootstrap } from './platform/bootstrap.js';

// 小游戏启动初期部分 wx 配置尚未就绪，延后一拍再初始化（官方未记载的实测坑）
function deferInit(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  } else {
    setTimeout(fn, 50);
  }
}

setTimeout(() => {
  deferInit(() => {
    void bootstrap().catch((error: unknown) => {
      console.error('[game] bootstrap failed', error);
      const message = error instanceof Error ? error.message : String(error);
      // 最常见的一种失败：工具/设备拿不到 WebGL2 上下文，给一条可执行的建议
      if (message.includes('WebGL context') || message.includes('WebGL2')) {
        console.error(
          '[game] 拿不到 WebGL2 上下文。开发者工具：设置 → 通用设置 → 打开「使用硬件加速」，' +
            '重启工具后重新编译；真机：确认基础库 ≥ 2.20.0 且未关闭 GPU 渲染。',
        );
      }
    });
  });
}, 0);
