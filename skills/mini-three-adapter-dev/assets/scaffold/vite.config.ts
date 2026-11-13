import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

/**
 * 微信小游戏构建。
 *
 * 四条不可破坏的约束：
 * 1) miniThree() 的选项是**扁平**的（AssetOptions 直接扩展到顶层）。
 *    上游 README/部分示例里的 `assets: { outputDir }` 是无效配置，会被静默忽略。
 * 2) three 必须被拆成**独立 chunk**，由入口在 runtime 就绪后按需 require。
 *    不要用 `inlineDynamicImports: true`：Rollup 只是把动态 import 变成
 *    `Promise.resolve().then(() => ns)`，模块体本身仍在脚本求值阶段执行 ——
 *    three 顶层的 `window.__THREE__` 探测会早于 createWeChatGameRuntime() 触发，
 *    作用域垫片直接抛 "Scoped global ... was read before a runtime was created"，
 *    脚本中断后 `GameApp` 命名空间是 undefined，再抛出第二个 TypeError。
 * 3) 输出格式用 cjs：小游戏的模块系统本身就是 CommonJS，`require()` 必定可用；
 *    不拿 ESM `import()` 去赌基础库/模拟器的兼容性。
 * 4) 共享模块（如 src/config/）必须单独成 chunk。Rollup 会把「入口与懒加载
 *    chunk 共用」的模块留在入口里，导致 chunk 反向 require("../game.js") 形成环。
 */
export default defineConfig({
  plugins: [
    miniThree({
      webgpu: 'warn',
      outputDir: 'assets/three',
      brotli: true,
      roots: ['public/decoders'],
      report: true,
    }),
  ],
  build: {
    target: 'es2019',
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    // three 本体就是 540KB，超过 Vite 默认 500KB 阈值属于正常，关掉噪音
    chunkSizeWarningLimit: 1024,
    // 小游戏没有 <link>/<script> 预加载，Vite 的 modulePreload 垫片会引用
    // window / dispatchEvent，必须关掉。
    modulePreload: false,
    rollupOptions: {
      // 入口不是 index.html：显式指定，避免 Vite 去找 HTML 入口
      input: 'src/main.ts',
      // 入口不是库：不要把入口的导出提升为 chunk 的共享依赖（input 级选项）
      preserveEntrySignatures: false,
      output: {
        format: 'cjs',
        entryFileNames: 'game.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
        manualChunks(id: string) {
          // 必须带 /node_modules/ 前缀：只匹配包路径。若写成 id.includes('mini-three-adapter')，
          // 项目所在目录名恰好含 mini-three-adapter 时，所有模块都会被塞进 adapter 分组，
          // Rollup 会退化成单文件产物（求值顺序随之失守）。
          if (id.includes('/node_modules/mini-three-adapter/')) return 'adapter';
          if (id.includes('/node_modules/three/')) return 'three';
          // ★ 共享的业务模块（配置常量、core 等）单独成 chunk。
          // 否则 Rollup 把它们留在入口，场景 chunk 会 require("../game.js") 成环。
          if (id.includes('/src/config/') || id.includes('/src/core/')) return 'shared';
          return undefined;
        },
      },
    },
  },
});
