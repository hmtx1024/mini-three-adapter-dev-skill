import * as THREE from 'three';
import type { MiniThreeRuntime } from 'mini-three-adapter'; // type-only：不产生运行时求值
import { DisposalGroup } from '../core/DisposalGroup.js';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  disposals: DisposalGroup;
}

/**
 * 创建 WebGLRenderer 并接线 resize / contextlost / dispose。
 * 注意 setSize 的第三个参数必须为 false：小游戏没有 DOM style 可改。
 */
export function createRenderContext(runtime: MiniThreeRuntime, parent: DisposalGroup): RenderContext {
  const { windowInfo } = runtime;
  const renderer = new THREE.WebGLRenderer(runtime.rendererHints);
  renderer.setPixelRatio(windowInfo.pixelRatio);
  renderer.setSize(windowInfo.width, windowInfo.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, windowInfo.width / windowInfo.height, 0.1, 200);
  const disposals = new DisposalGroup();
  parent.add(() => disposals.dispose());

  disposals.add(runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(info.pixelRatio);
    renderer.setSize(info.width, info.height, false);
  }));

  disposals.add(runtime.on('contextlost', () => {
    console.warn('[render] WebGL context lost; rebuild GPU resources on next onShow');
  }));

  disposals.add(() => {
    renderer.setAnimationLoop(null); // ★ 必须先停帧循环再释放
    renderer.dispose();
  });

  return { renderer, scene, camera, disposals };
}
