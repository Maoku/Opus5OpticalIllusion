import * as THREE from 'three';
import { areaAt, type AreaDefinition, type PaletteId } from '../data/layout';
import type { Quality, QualityPreset } from '../core/Quality';
import { damp } from '../utils/math';

interface LightProfile {
  hemi: number;
  ambient: number;
  key: number;
  /** キーライトの仰角（度）。低いほど影が長い */
  elevation: number;
}

const PROFILES: Record<PaletteId, LightProfile> = {
  hall: { hemi: 0.55, ambient: 0.35, key: 1.5, elevation: 62 },
  gallery: { hemi: 0.4, ambient: 0.3, key: 1.7, elevation: 58 },
  corridor: { hemi: 0.35, ambient: 0.28, key: 1.0, elevation: 70 },
  // Opus 棟は暗い。投影光と影を読ませるため環境光を落とす（ROOM_D §1 D6）
  opus: { hemi: 0.08, ambient: 0.06, key: 0.35, elevation: 75 },
};

export interface SpotRequest {
  position: THREE.Vector3;
  target: THREE.Vector3;
  color: number;
  intensity: number;
  angle: number;
  penumbra: number;
  distance: number;
  /** 距離減衰。0 にすると照度が距離によらず一定になる（校正済みの展示で使う） */
  decay?: number;
  /**
   * 錯視の成立条件である照明（チェッカーシャドウ / ホロウマスク）。
   * §4.4 の例外扱い: low プリセットでも必ず点灯し、影も維持する。
   */
  critical?: boolean;
  /** 影を落とすか */
  shadow?: boolean;
  map?: THREE.Texture | null;
}

interface PoolEntry {
  light: THREE.SpotLight;
  request: SpotRequest | null;
  /** 0..1。切り替え時のポップを避けるためのフェード */
  fade: number;
}

/**
 * 環境光 + 部屋のキーライト + 展示スポットのプール。
 *
 * ライトの「本数」を実行中に変えると three がシェーダを再コンパイルして
 * カクつくため、本数は起動時に決め打ちし、以後は位置と強度だけを動かす。
 */
export class Lighting {
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly key: THREE.DirectionalLight;

  readonly #pool: PoolEntry[] = [];
  readonly #requests: SpotRequest[] = [];
  #currentArea: AreaDefinition | null = null;
  #profile: LightProfile = PROFILES.hall;
  #targetProfile: LightProfile = PROFILES.hall;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly quality: Quality,
  ) {
    this.hemi = new THREE.HemisphereLight(0xbfd0ff, 0x201c17, PROFILES.hall.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, PROFILES.hall.ambient);
    this.key = new THREE.DirectionalLight(0xfff6e8, PROFILES.hall.key);
    this.key.target = new THREE.Object3D();
    scene.add(this.hemi, this.ambient, this.key, this.key.target);

    this.#applyShadowQuality(quality.preset);
    quality.events.on('changed', (preset) => this.#applyShadowQuality(preset));

    for (let i = 0; i < quality.preset.maxSpotLights; i++) {
      const light = new THREE.SpotLight(0xffffff, 0, 20, Math.PI / 6, 0.4, 1.4);
      light.target = new THREE.Object3D();
      light.visible = true;
      light.intensity = 0;
      scene.add(light, light.target);
      this.#pool.push({ light, request: null, fade: 0 });
    }
  }

  /** 展示が照明を要求する。プールの空き状況に応じて実際に点灯するかが決まる。 */
  addSpot(request: SpotRequest): () => void {
    this.#requests.push(request);
    return () => {
      const i = this.#requests.indexOf(request);
      if (i >= 0) this.#requests.splice(i, 1);
    };
  }

  update(dt: number, playerPosition: THREE.Vector3): void {
    this.#updateArea(playerPosition);
    this.#updateProfile(dt);
    this.#updateSpots(dt, playerPosition);
  }

  dispose(): void {
    for (const entry of this.#pool) {
      entry.light.dispose();
      entry.light.removeFromParent();
      entry.light.target.removeFromParent();
    }
    this.#pool.length = 0;
    this.#requests.length = 0;
    this.key.dispose();
    this.scene.remove(this.hemi, this.ambient, this.key, this.key.target);
  }

  // ------------------------------------------------------------- internals

  #applyShadowQuality(preset: QualityPreset): void {
    const size = preset.shadowMapSize;
    this.key.castShadow = size > 0;
    if (size > 0) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.bias = -0.0006;
      this.key.shadow.normalBias = 0.02;
    }
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
  }

  /** 影のカメラを現在の部屋に密着させる。部屋をまたいだときだけ再設定する。 */
  #updateArea(playerPosition: THREE.Vector3): void {
    const area = areaAt(playerPosition.x, playerPosition.z);
    if (!area || area === this.#currentArea) return;
    this.#currentArea = area;
    this.#targetProfile = PROFILES[area.palette];

    const cx = (area.min[0] + area.max[0]) / 2;
    const cz = (area.min[1] + area.max[1]) / 2;
    const halfW = (area.max[0] - area.min[0]) / 2 + 1;
    const halfD = (area.max[1] - area.min[1]) / 2 + 1;
    const radius = Math.hypot(halfW, halfD);

    const elevation = THREE.MathUtils.degToRad(this.#targetProfile.elevation);
    const dist = radius * 1.6;
    this.key.position.set(
      cx + Math.cos(elevation) * dist * 0.55,
      area.height + Math.sin(elevation) * dist,
      cz + Math.cos(elevation) * dist * 0.35,
    );
    this.key.target.position.set(cx, 0, cz);
    this.key.target.updateMatrixWorld();

    const cam = this.key.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.5;
    cam.far = dist + area.height + radius * 2;
    cam.updateProjectionMatrix();
  }

  #updateProfile(dt: number): void {
    const k = damp(3, dt);
    this.#profile = {
      hemi: THREE.MathUtils.lerp(this.#profile.hemi, this.#targetProfile.hemi, k),
      ambient: THREE.MathUtils.lerp(this.#profile.ambient, this.#targetProfile.ambient, k),
      key: THREE.MathUtils.lerp(this.#profile.key, this.#targetProfile.key, k),
      elevation: this.#targetProfile.elevation,
    };
    this.hemi.intensity = this.#profile.hemi;
    this.ambient.intensity = this.#profile.ambient;
    this.key.intensity = this.#profile.key;
  }

  /** プレイヤーに近い順（critical 優先）でプールに割り当てる */
  #updateSpots(dt: number, playerPosition: THREE.Vector3): void {
    if (this.#pool.length === 0) return;

    const ranked = [...this.#requests].sort((a, b) => {
      if (!!a.critical !== !!b.critical) return a.critical ? -1 : 1;
      return a.position.distanceToSquared(playerPosition) - b.position.distanceToSquared(playerPosition);
    });

    const shadowBudget = this.quality.preset.shadowMapSize > 0 ? 2 : 0;
    let shadowsUsed = 0;

    for (let i = 0; i < this.#pool.length; i++) {
      const entry = this.#pool[i]!;
      const request = ranked[i] ?? null;
      if (request !== entry.request) {
        entry.request = request;
        entry.fade = 0;
      }
      const k = damp(6, dt);
      entry.fade = THREE.MathUtils.lerp(entry.fade, request ? 1 : 0, k);

      const light = entry.light;
      if (!request) {
        light.intensity = light.intensity * (1 - k);
        continue;
      }
      light.position.copy(request.position);
      light.target.position.copy(request.target);
      light.target.updateMatrixWorld();
      light.color.setHex(request.color);
      light.angle = request.angle;
      light.penumbra = request.penumbra;
      light.distance = request.distance;
      light.decay = request.decay ?? 1.4;
      light.intensity = request.intensity * entry.fade;
      light.map = request.map ?? null;

      // §4.4 の例外: critical な展示は low でも影を維持する
      const wantsShadow = request.shadow === true || request.critical === true;
      const allowed = wantsShadow && (request.critical === true || shadowsUsed < shadowBudget);
      if (allowed) shadowsUsed++;
      if (light.castShadow !== allowed) {
        light.castShadow = allowed;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0008;
        light.shadow.normalBias = 0.02;
      }
    }
  }
}
