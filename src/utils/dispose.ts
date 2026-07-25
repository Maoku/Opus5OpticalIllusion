import type * as THREE from 'three';

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

/**
 * Object3D 以下のジオメトリ・マテリアル・テクスチャを再帰的に解放する。
 *
 * §8c: setLocale() がテクスチャを作り直すため、言語切替を繰り返しても
 * リークしないことがここに懸かっている。
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh> & THREE.Object3D;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) disposeMaterial(m);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

/** 親から外したうえで解放する */
export function removeAndDispose(root: THREE.Object3D): void {
  root.removeFromParent();
  disposeObject(root);
}

/** dispose() を持つものをまとめて解放するためのごみ袋 */
export class DisposeBag {
  readonly #items: Array<{ dispose(): void }> = [];
  readonly #fns: Array<() => void> = [];

  add<T extends { dispose(): void }>(item: T): T {
    this.#items.push(item);
    return item;
  }

  addFn(fn: () => void): void {
    this.#fns.push(fn);
  }

  /** Object3D をシーングラフから外して解放するよう登録する */
  addObject<T extends THREE.Object3D>(obj: T): T {
    this.#fns.push(() => removeAndDispose(obj));
    return obj;
  }

  dispose(): void {
    for (const fn of this.#fns.splice(0).reverse()) fn();
    for (const item of this.#items.splice(0).reverse()) item.dispose();
  }
}
