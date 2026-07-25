import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { EventBus } from './EventBus';

export interface AssetsEvents extends Record<string, unknown> {
  /** 0..1 */
  progress: { loaded: number; total: number; ratio: number; url: string };
  loaded: void;
  error: { url: string };
}

/**
 * ローダのラッパ。LoadingManager 経由で進捗を EventBus に流す。
 *
 * 本作のテクスチャは可能な限り手続き生成する方針（§9 総アセット 5MB 以下）なので、
 * 実際にここを通るのはホロウマスクの glTF と D5 の visual hull 程度になる。
 */
export class Assets {
  readonly manager = new THREE.LoadingManager();
  readonly events = new EventBus<AssetsEvents>();

  readonly #textures = new Map<string, THREE.Texture>();
  readonly #models = new Map<string, GLTF>();
  readonly #gltf: GLTFLoader;
  readonly #texture: THREE.TextureLoader;

  constructor(private readonly baseUrl: string = import.meta.env.BASE_URL) {
    this.manager.onProgress = (url, loaded, total) => {
      this.events.emit('progress', { url, loaded, total, ratio: total > 0 ? loaded / total : 1 });
    };
    this.manager.onLoad = () => this.events.emit('loaded', undefined);
    this.manager.onError = (url) => this.events.emit('error', { url });

    this.#gltf = new GLTFLoader(this.manager);
    this.#texture = new THREE.TextureLoader(this.manager);
  }

  #resolve(path: string): string {
    if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path;
    return this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  async loadTexture(path: string, colorSpace = THREE.SRGBColorSpace): Promise<THREE.Texture> {
    const cached = this.#textures.get(path);
    if (cached) return cached;
    const tex = await this.#texture.loadAsync(this.#resolve(path));
    tex.colorSpace = colorSpace;
    tex.anisotropy = 4;
    this.#textures.set(path, tex);
    return tex;
  }

  async loadModel(path: string): Promise<GLTF> {
    const cached = this.#models.get(path);
    if (cached) return cached;
    const gltf = await this.#gltf.loadAsync(this.#resolve(path));
    this.#models.set(path, gltf);
    return gltf;
  }

  /** 失敗しても展示を落とさない読み込み。null が返ったら代替形状を生成する。 */
  async tryLoadModel(path: string): Promise<GLTF | null> {
    try {
      return await this.loadModel(path);
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const tex of this.#textures.values()) tex.dispose();
    this.#textures.clear();
    this.#models.clear();
    this.events.clear();
  }
}
