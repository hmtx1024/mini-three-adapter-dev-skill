import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DECODER_BASE } from '../config/constants.js';
import type { DisposalGroup } from '../core/DisposalGroup.js';
import { resolveAssetUrl, type AssetId } from './manifest.js';

export interface LoaderBundle {
  gltf: GLTFLoader;
  draco: DRACOLoader;
  ktx2: KTX2Loader;
  loadGltf(id: AssetId): Promise<THREE.Group>;
}

/**
 * decoder 路径必须与 dist/mini-three-assets.json 的 decoderPaths 一致。
 * Worker 并发上限 1：同一时刻只跑一条 decoder 管线，切场景时先释放旧的 LoaderBundle。
 */
export function createLoaderBundle(renderer: THREE.WebGLRenderer, group: DisposalGroup): LoaderBundle {
  const draco = group.track(new DRACOLoader());
  draco.setDecoderPath(DECODER_BASE);

  const ktx2 = group.track(new KTX2Loader());
  ktx2.setTranscoderPath(DECODER_BASE).detectSupport(renderer);

  const gltf = new GLTFLoader();
  gltf.setDRACOLoader(draco);
  gltf.setKTX2Loader(ktx2);

  return {
    gltf,
    draco,
    ktx2,
    loadGltf(id: AssetId): Promise<THREE.Group> {
      return new Promise((resolve, reject) => {
        gltf.load(
          resolveAssetUrl(id),
          (gltfResult) => {
            group.trackObject(gltfResult.scene);
            resolve(gltfResult.scene);
          },
          undefined,
          (error) => reject(error),
        );
      });
    },
  };
}
