import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Scene, SceneContext } from '../../core/types.js';

/**
 * 最小可运行场景：一个旋转立方体 + OrbitControls。
 * 它同时是真机验收的探针 —— 能出图且单指/双指可控，说明适配层、事件桥、
 * resize、帧循环全部接通。新增场景请复制本文件的契约结构。
 */
export function createBootScene(): Scene {
  let root: THREE.Group | null = null;
  let cube: THREE.Mesh | null = null;
  let controls: OrbitControls | null = null;
  let elapsed = 0;

  return {
    id: 'boot',

    mount(ctx: SceneContext): void {
      const group = new THREE.Group();
      root = group;

      const cubeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.35, metalness: 0.1 }),
      );
      cube = cubeMesh;
      group.add(cubeMesh);

      const ambient = new THREE.AmbientLight(0xffffff, 1.2);
      const key = new THREE.DirectionalLight(0xffffff, 2);
      key.position.set(3, 5, 4);
      group.add(ambient, key);

      ctx.scene.add(group);
      ctx.scene.background = new THREE.Color(0x101820);
      ctx.camera.position.set(2.4, 1.8, 3.2);

      // 控制器挂在已补丁的 canvas 上；适配层自动把 wx.onTouch* 转成 pointer*
      const orbit = new OrbitControls(ctx.camera, ctx.renderer.domElement);
      orbit.enableDamping = true;
      controls = orbit;

      // ★ 所有资源与订阅登记到场景自己的释放组，SceneManager 切换时自动释放
      ctx.disposals.trackObject(group);
      ctx.disposals.track(orbit);
      ctx.disposals.add(() => { ctx.scene.background = null; });
    },

    update(deltaMs: number): void {
      elapsed += deltaMs;
      if (cube) {
        cube.rotation.x = elapsed * 0.0004;
        cube.rotation.y = elapsed * 0.0006;
      }
      controls?.update();
    },

    unmount(): void {
      controls = null;
      cube = null;
      root = null;
      elapsed = 0;
    },
  };
}
