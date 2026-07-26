import * as THREE from 'three';
import type { App, Updatable } from '../core/App';
import { areaAt, type AreaDefinition } from '../data/layout';
import { Collision } from './Collision';
import { Lighting } from './Lighting';
import { RoomBuilder, type BuiltMuseum } from './RoomBuilder';
import { removeAndDispose } from '../utils/dispose';

/**
 * ルームの合成。建築（RoomBuilder）・照明（Lighting）・当たり判定（Collision）を束ね、
 * プレイヤー位置に応じて「現在のエリア」を配信する。
 */
export class Museum implements Updatable {
  readonly collision = new Collision();
  readonly lighting: Lighting;
  readonly group: THREE.Group;

  readonly #built: BuiltMuseum;
  readonly #builder: RoomBuilder;
  #currentArea: AreaDefinition | null = null;
  #areaListeners: Array<(area: AreaDefinition | null) => void> = [];
  /** プレイヤー位置の供給元。Phase 3 で PlayerController に差し替わる */
  #tracked: THREE.Object3D;

  constructor(app: App) {
    this.#builder = new RoomBuilder(this.collision);
    this.#built = this.#builder.build();
    this.group = this.#built.group;
    app.scene.add(this.group);

    this.lighting = new Lighting(app.scene, app.quality);
    this.#tracked = app.camera;

    app.scene.fog = new THREE.Fog(0x0b0c10, 30, 90);
  }

  /** 現在のエリアの供給元を差し替える（既定はカメラ） */
  track(object: THREE.Object3D): void {
    this.#tracked = object;
  }

  get currentArea(): AreaDefinition | null {
    return this.#currentArea;
  }

  onAreaChange(listener: (area: AreaDefinition | null) => void): () => void {
    this.#areaListeners.push(listener);
    return () => {
      const i = this.#areaListeners.indexOf(listener);
      if (i >= 0) this.#areaListeners.splice(i, 1);
    };
  }

  update(dt: number): void {
    const p = this.#tracked.position;
    const area = areaAt(p.x, p.z);
    if (area !== this.#currentArea) {
      this.#currentArea = area;
      for (const listener of this.#areaListeners) listener(area);
    }
    this.lighting.update(dt, p);
  }

  dispose(): void {
    this.lighting.dispose();
    removeAndDispose(this.group);
    this.#built.dispose();
    this.collision.clear();
    this.#areaListeners = [];
  }
}
