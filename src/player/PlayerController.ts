import * as THREE from 'three';
import type { InputState } from '../core/input/types';
import { PITCH_LIMIT } from '../core/input/KeyboardMouseSource';
import type { Collision } from '../world/Collision';
import { clamp, damp } from '../utils/math';

export const PLAYER_RADIUS = 0.35;
export const DEFAULT_EYE_HEIGHT = 1.6;

export interface PlayerTuning {
  walkSpeed: number;
  dashSpeed: number;
  acceleration: number;
  deceleration: number;
  /** §Phase 3: ヘッドボブ既定 OFF（3D 酔い対策） */
  headBob: boolean;
  headBobAmplitude: number;
}

export const DEFAULT_TUNING: PlayerTuning = {
  walkSpeed: 2.9,
  dashSpeed: 5.2,
  acceleration: 26,
  deceleration: 18,
  headBob: false,
  headBobAmplitude: 0.028,
};

/**
 * 展示がプレイヤーの身体を一時的に書き換えるためのハンドル（ROOM_D §2.3）。
 *
 * 巻き戻しの保証が最重要。縮んだまま他の部屋へ行けると全展示の錯視が壊れる。
 * ExhibitManager が退出時・dispose 時・ワープ時に release() を呼ぶ責任を持つ。
 */
export interface PlayerOverrideHandle {
  readonly owner: string;
  readonly released: boolean;
  setEyeHeight(value: number | null): void;
  setMoveSpeedScale(value: number | null): void;
  /** 上書きをすべて取り消す。何度呼んでも安全。 */
  release(): void;
}

interface OverrideRecord {
  owner: string;
  eyeHeight: number | null;
  moveSpeedScale: number | null;
  released: boolean;
}

/**
 * 移動・衝突・視点高さ。入力は InputState のみを見る。
 * キーボードかタッチかによる分岐がここに存在しないことが Phase 3 の DoD。
 */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector2();
  tuning: PlayerTuning = { ...DEFAULT_TUNING };

  yaw = 0;
  pitch = 0;
  /** ViewSpot ロック中など、外部から移動を止めるためのフラグ */
  frozen = false;

  #baseEyeHeight = DEFAULT_EYE_HEIGHT;
  #eyeHeight = DEFAULT_EYE_HEIGHT;
  #bobPhase = 0;
  #bobOffset = 0;
  readonly #overrides: OverrideRecord[] = [];
  readonly #scratch = new THREE.Vector2();
  readonly #target = new THREE.Vector2();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly collision: Collision,
  ) {
    camera.rotation.order = 'YXZ';
  }

  spawn(x: number, z: number, yaw: number): void {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.#bobOffset = 0;
    this.syncCamera();
  }

  /**
   * 展示リストからのワープ（§8c: 歩行不要でも全展示に到達できる導線）。
   * 壁にめり込む座標なら押し出してから着地する。
   */
  warpTo(x: number, z: number, yaw: number): void {
    this.#target.set(x, z);
    this.collision.resolve(this.#target, PLAYER_RADIUS);
    this.position.set(this.#target.x, 0, this.#target.y);
    this.velocity.set(0, 0);
    this.yaw = yaw;
    this.syncCamera();
  }

  get eyeHeight(): number {
    return this.#eyeHeight;
  }

  get baseEyeHeight(): number {
    return this.#baseEyeHeight;
  }

  /** 現在有効な移動速度倍率（override の合成結果） */
  get moveSpeedScale(): number {
    let scale = 1;
    for (const o of this.#overrides) {
      if (!o.released && o.moveSpeedScale !== null) scale = o.moveSpeedScale;
    }
    return scale;
  }

  get activeOverrideCount(): number {
    return this.#overrides.filter((o) => !o.released).length;
  }

  /** 展示に身体改変の権限を渡す */
  createOverride(owner: string): PlayerOverrideHandle {
    const record: OverrideRecord = {
      owner,
      eyeHeight: null,
      moveSpeedScale: null,
      released: false,
    };
    this.#overrides.push(record);
    return {
      owner,
      get released() {
        return record.released;
      },
      setEyeHeight: (value) => {
        if (record.released) return;
        record.eyeHeight = value;
      },
      setMoveSpeedScale: (value) => {
        if (record.released) return;
        record.moveSpeedScale = value;
      },
      release: () => {
        if (record.released) return;
        record.released = true;
        record.eyeHeight = null;
        record.moveSpeedScale = null;
        this.#pruneOverrides();
      },
    };
  }

  /** 保険。ワープ時やシーン破棄時に、残っている上書きを全部巻き戻す。 */
  releaseAllOverrides(): void {
    for (const o of this.#overrides) {
      o.released = true;
      o.eyeHeight = null;
      o.moveSpeedScale = null;
    }
    this.#overrides.length = 0;
    this.#eyeHeight = this.#baseEyeHeight;
  }

  update(dt: number, input: InputState): void {
    this.#applyLook(input);
    if (!this.frozen) this.#applyMove(dt, input);
    else this.velocity.set(0, 0);
    this.#applyEyeHeight(dt);
    this.syncCamera();
  }

  syncCamera(): void {
    this.camera.position.set(
      this.position.x,
      this.position.y + this.#eyeHeight + this.#bobOffset,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  // ------------------------------------------------------------- internals

  #applyLook(input: InputState): void {
    if (this.frozen) return;
    this.yaw += input.look.yaw;
    this.pitch = clamp(this.pitch + input.look.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  #applyMove(dt: number, input: InputState): void {
    const { x, y } = input.move;
    const magnitude = Math.hypot(x, y);
    const dashing = magnitude > 0.9;
    const speed = (dashing ? this.tuning.dashSpeed : this.tuning.walkSpeed) * this.moveSpeedScale;

    // 入力をワールド座標へ（yaw のみ。上下は移動に影響しない）
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const desiredX = (x * cos - y * sin) * speed;
    const desiredZ = (-x * sin - y * cos) * speed;

    const rate = magnitude > 0 ? this.tuning.acceleration : this.tuning.deceleration;
    const k = damp(rate, dt);
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, desiredX, k);
    this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, desiredZ, k);
    if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0);

    this.#scratch.set(this.position.x, this.position.z);
    this.#target.set(
      this.position.x + this.velocity.x * dt,
      this.position.z + this.velocity.y * dt,
    );
    const resolved = this.collision.move(this.#scratch, this.#target, PLAYER_RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.y;

    if (this.tuning.headBob) {
      const travelled = Math.hypot(resolved.x - this.#scratch.x, resolved.y - this.#scratch.y);
      this.#bobPhase += travelled * 4.6;
      this.#bobOffset = Math.sin(this.#bobPhase) * this.tuning.headBobAmplitude;
    } else if (this.#bobOffset !== 0) {
      this.#bobOffset = THREE.MathUtils.lerp(this.#bobOffset, 0, damp(8, dt));
      if (Math.abs(this.#bobOffset) < 1e-4) this.#bobOffset = 0;
    }
  }

  #applyEyeHeight(dt: number): void {
    let target = this.#baseEyeHeight;
    for (const o of this.#overrides) {
      if (!o.released && o.eyeHeight !== null) target = o.eyeHeight;
    }
    // 上書きが外れたときは 0.4 秒程度で戻る（D2 の「戻し」の山場に使う）
    this.#eyeHeight = THREE.MathUtils.lerp(this.#eyeHeight, target, damp(9, dt));
    if (Math.abs(this.#eyeHeight - target) < 1e-4) this.#eyeHeight = target;
  }

  #pruneOverrides(): void {
    for (let i = this.#overrides.length - 1; i >= 0; i--) {
      if (this.#overrides[i]!.released) this.#overrides.splice(i, 1);
    }
  }
}
