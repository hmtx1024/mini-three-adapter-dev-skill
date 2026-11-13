import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

/**
 * H5 冒烟用构建配置（不是小游戏产物）。
 *
 * 为什么不用 `vite dev`：适配层的 AST 重写只在**构建期**跑，dev server 下
 * three 的原始 ESM 会读到未激活的作用域全局（`__THREE__` / `window`），
 * 直接抛 "Scoped global ... was read before a runtime was created"。
 * 因此浏览器预览统一走 `npm run h5`（build + preview），与真机产物同一条重写管线。
 */
export default defineConfig({
  plugins: [
    miniThree({
      webgpu: 'warn',
      outputDir: 'assets/three',
      brotli: true,
      report: true,
    }),
  ],
  build: {
    target: 'es2019',
    outDir: 'dist-h5',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    // three 本体就有 540KB，超过默认 500KB 阈值属正常
    chunkSizeWarningLimit: 1024,
  },
});
