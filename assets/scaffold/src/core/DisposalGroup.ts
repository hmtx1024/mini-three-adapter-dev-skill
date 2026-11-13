import type * as THREE from 'three';

export type Disposer = () => void;

/**
 * 统一释放组：所有订阅、定时器、loader、three 资源都登记到这里。
 * dispose() 逆序执行且幂等，单个 disposer 抛错不阻断其余释放。
 */
export class DisposalGroup {
  private readonly items: Disposer[] = [];
  private done = false;

  get disposed(): boolean {
    return this.done;
  }

  add(...items: Array<Disposer | undefined | null>): this {
    if (this.done) throw new Error('[DisposalGroup] already disposed');
    for (const item of items) {
      if (typeof item === 'function') this.items.push(item);
    }
    return this;
  }

  /** 登记带 dispose() 的 three 对象（loader、controls、material…）并返回原对象。 */
  track<T extends { dispose(): void }>(resource: T): T {
    this.add(() => resource.dispose());
    return resource;
  }

  /** 登记 setTimeout / setInterval。 */
  timer(handle: ReturnType<typeof setTimeout>, isInterval = false): this {
    return this.add(() => {
      if (isInterval) clearInterval(handle as ReturnType<typeof setInterval>);
      else clearTimeout(handle);
    });
  }

  /** 递归释放 Object3D 下的 geometry / material / texture，并从父节点摘除。 */
  trackObject(root: THREE.Object3D): this {
    return this.add(() => disposeObject(root));
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (const fn of this.items.splice(0).reverse()) {
      try {
        fn();
      } catch (error) {
        console.warn('[DisposalGroup] disposer threw', error);
      }
    }
  }
}

/** 供场景手动调用：递归释放一个 Object3D 子树。 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    const materials: THREE.Material[] = Array.isArray(material)
      ? material
      : material
        ? [material]
        : [];
    for (const mat of materials) {
      for (const value of Object.values(mat)) {
        if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture === true) {
          (value as THREE.Texture).dispose();
        }
      }
      mat.dispose();
    }
  });
  root.removeFromParent();
}
