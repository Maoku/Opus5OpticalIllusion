import * as THREE from 'three';
import type { SceneHost } from '../core/SceneHost';
import { EventBus } from '../core/EventBus';
import type { InputState } from '../core/input/types';
import type { PlayerController } from '../player/PlayerController';
import { clamp, degToRad, easeInOutCubic } from '../utils/math';
import { type ViewSpot } from './ViewSpot';

export interface ViewpointEvents extends Record<string, unknown> {
  /** 反応半径に入った / 出た。HUD のプロンプト表示に使う */
  candidateChanged: ViewSpot | null;
  locked: ViewSpot;
  released: ViewSpot;
}

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
}

/** スナップ時間（§Phase 4: easeInOutCubic で 0.6 秒） */
const SNAP_DURATION = 0.6;
/** ロック中に許す首振り。完全固定は不気味なので ±3° だけ許可する */
const MICRO_LOOK_LIMIT = degToRad(3);
/** 移動入力でロックを解除する閾値 */
const RELEASE_MOVE_THRESHOLD = 0.4;

type State = 'idle' | 'entering' | 'locked' | 'exiting';

/**
 * ViewSpot への視点スナップとロック管理（§0.4 / Phase 4）。
 *
 * 進入は GameAction.interact で発火する。キーかタッチかは知らない。
 */
export class ViewpointController {
  readonly events = new EventBus<ViewpointEvents>();
  readonly spots: ViewSpot[] = [];

  #state: State = 'idle';
  #candidate: ViewSpot | null = null;
  #current: ViewSpot | null = null;
  #from: Pose = makePose();
  #to: Pose = makePose();
  #t = 0;
  #duration = SNAP_DURATION;
  #microYaw = 0;
  #microPitch = 0;
  /** reveal 演出が一時的に上書きするポーズ（orbit / topDown） */
  #revealPose: Pose | null = null;
  #revealQueue: Array<{ pose: Pose | null; duration: number; hold: number }> = [];
  #pendingHold = 0;
  #hold = 0;
  #ortho: THREE.OrthographicCamera;
  #reducedMotion = false;

  constructor(
    private readonly app: SceneHost,
    private readonly player: PlayerController,
  ) {
    this.#ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 200);
  }

  set reducedMotion(v: boolean) {
    this.#reducedMotion = v;
  }

  get state(): State {
    return this.#state;
  }

  get candidate(): ViewSpot | null {
    return this.#candidate;
  }

  /** ロック中（遷移中を含む）の ViewSpot */
  get current(): ViewSpot | null {
    return this.#current;
  }

  get isEngaged(): boolean {
    return this.#state !== 'idle';
  }

  add(spot: ViewSpot): void {
    this.spots.push(spot);
  }

  removeByExhibit(exhibitId: string): void {
    for (let i = this.spots.length - 1; i >= 0; i--) {
      if (this.spots[i]!.exhibitId === exhibitId) this.spots.splice(i, 1);
    }
  }

  clear(): void {
    this.spots.length = 0;
    this.#candidate = null;
    this.#current = null;
    this.#state = 'idle';
  }

  /** 指定した展示の ViewSpot（既定は先頭）へ直接ロックする。展示一覧のワープで使う。 */
  focusExhibit(exhibitId: string, index = 0): boolean {
    const spot = this.spots.find((s) => s.exhibitId === exhibitId && s.index === index);
    if (!spot) return false;
    this.player.warpTo(spot.standAt.x, spot.standAt.z, this.player.yaw);
    this.enter(spot);
    return true;
  }

  enter(spot: ViewSpot): void {
    if (this.#state === 'entering' || this.#state === 'locked') return;
    this.#current = spot;
    this.#state = 'entering';
    this.#microYaw = 0;
    this.#microPitch = 0;
    this.#revealPose = null;
    this.#from = currentPose(this.app.camera);
    this.#to = poseFromSpot(spot);
    this.#t = 0;
    this.#duration = this.#reducedMotion ? SNAP_DURATION * 0.35 : SNAP_DURATION;
    this.player.frozen = true;
    this.events.emit('locked', spot);
  }

  exit(): void {
    if (this.#state !== 'locked' && this.#state !== 'entering') return;
    const spot = this.#current;
    this.#state = 'exiting';
    this.#from = currentPose(this.app.camera);
    this.#to = playerPose(this.player, this.app.camera.fov);
    this.#t = 0;
    this.#revealPose = null;
    this.#revealQueue = [];
    this.#hold = 0;
    this.#pendingHold = 0;
    this.#useOrtho(false);
    if (spot) this.events.emit('released', spot);
  }

  /**
   * §8c: モーション低減時の「段階送り」。
   * 連続したスイープの代わりに、途中のポーズで一度止めてから最終ポーズへ移る。
   * 前庭感覚との齟齬が出る長い回転を避けつつ、中間状態（＝破綻が見える角度）は残す。
   */
  setRevealSequence(steps: Array<{ pose: Pose | null; duration: number; hold: number }>): void {
    const [first, ...rest] = steps;
    if (!first) return;
    this.#revealQueue = rest;
    this.#hold = 0;
    this.setRevealPose(first.pose, first.duration);
    this.#pendingHold = first.hold;
  }

  /**
   * reveal 演出からカメラを借りる（orbit / topDown）。
   * null を渡すと ViewSpot の正解ポーズへ戻る。
   */
  setRevealPose(pose: Pose | null, duration = 1.2): void {
    if (this.#state !== 'locked' && this.#state !== 'entering') return;
    this.#revealPose = pose;
    this.#from = currentPose(this.app.camera);
    this.#to = pose ?? (this.#current ? poseFromSpot(this.#current) : this.#to);
    this.#t = 0;
    this.#duration = this.#reducedMotion ? duration * 0.5 : duration;
    this.#state = 'entering';
  }

  /** 段階送りの途中で止まっているか */
  get holding(): boolean {
    return this.#hold > 0;
  }

  update(dt: number, input: InputState): void {
    this.#updateCandidate(dt, input);

    // 段階送りの「ため」。時間が来たら次のポーズへ進む
    if (this.#hold > 0) {
      this.#hold -= dt;
      if (this.#hold <= 0) {
        const next = this.#revealQueue.shift();
        if (next) {
          this.setRevealPose(next.pose, next.duration);
          this.#pendingHold = next.hold;
        }
      }
    }

    switch (this.#state) {
      case 'idle':
        break;
      case 'entering':
      case 'exiting': {
        this.#t = Math.min(1, this.#t + dt / this.#duration);
        const k = easeInOutCubic(this.#t);
        applyPose(this.app.camera, lerpPose(this.#from, this.#to, k));
        if (this.#t >= 1) {
          if (this.#state === 'exiting') {
            this.#state = 'idle';
            this.#current = null;
            this.player.frozen = false;
          } else {
            this.#state = 'locked';
            if (this.#pendingHold > 0) {
              this.#hold = this.#pendingHold;
              this.#pendingHold = 0;
            }
            if (!this.#revealPose) {
              this.#useOrtho(this.#current?.definition.projection === 'orthographic');
            }
          }
        }
        break;
      }
      case 'locked': {
        // ロック中の微小な首振り（±3°）。完全固定は不気味なので許可する
        this.#microYaw = clamp(
          this.#microYaw + input.look.yaw,
          -MICRO_LOOK_LIMIT,
          MICRO_LOOK_LIMIT,
        );
        this.#microPitch = clamp(
          this.#microPitch + input.look.pitch,
          -MICRO_LOOK_LIMIT,
          MICRO_LOOK_LIMIT,
        );
        const base = this.#revealPose ?? (this.#current ? poseFromSpot(this.#current) : null);
        if (base) {
          const q = base.quaternion.clone();
          q.multiply(
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(this.#microPitch, this.#microYaw, 0, 'YXZ'),
            ),
          );
          this.app.camera.position.copy(base.position);
          this.app.camera.quaternion.copy(q);
          this.#setFov(base.fov);
        }
        if (Math.hypot(input.move.x, input.move.y) > RELEASE_MOVE_THRESHOLD) this.exit();
        break;
      }
    }

    if (this.#state !== 'idle') this.#syncOrtho();
  }

  dispose(): void {
    this.#useOrtho(false);
    this.clear();
    this.events.clear();
  }

  // ------------------------------------------------------------- internals

  #updateCandidate(dt: number, _input: InputState): void {
    let best: ViewSpot | null = null;
    let bestDistance = Infinity;
    const position = this.player.position;
    for (const spot of this.spots) {
      const d = spot.distanceTo(position);
      if (d <= spot.radius && d < bestDistance) {
        best = spot;
        bestDistance = d;
      }
    }
    if (best !== this.#candidate) {
      this.#candidate = best;
      this.events.emit('candidateChanged', best);
    }
    for (const spot of this.spots) {
      spot.setHighlighted(spot === best && this.#state === 'idle');
      spot.update(dt, this.app.elapsed);
    }
  }

  #setFov(fov: number): void {
    if (Math.abs(this.app.camera.fov - fov) < 1e-4) return;
    this.app.camera.fov = fov;
    this.app.camera.updateProjectionMatrix();
  }

  /**
   * 正投影へ切り替える。遷移は透視のまま行い、着地の瞬間に差し替える。
   * ViewSpot 側の fov を十分小さく取っておけば切替は目に見えない。
   */
  #useOrtho(enabled: boolean): void {
    if (enabled) {
      this.#syncOrtho();
      this.app.renderCamera = this.#ortho;
    } else if (this.app.renderCamera !== this.app.camera) {
      this.app.renderCamera = this.app.camera;
    }
  }

  #syncOrtho(): void {
    if (this.app.renderCamera !== this.#ortho) return;
    const spot = this.#current;
    const height = spot?.definition.orthoHeight ?? 4;
    const aspect = this.app.camera.aspect;
    this.#ortho.top = height / 2;
    this.#ortho.bottom = -height / 2;
    this.#ortho.left = (-height / 2) * aspect;
    this.#ortho.right = (height / 2) * aspect;
    this.#ortho.position.copy(this.app.camera.position);
    this.#ortho.quaternion.copy(this.app.camera.quaternion);
    this.#ortho.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------ helpers

// Object3D.lookAt は非カメラだと「+Z を対象へ向ける」逆向きの規則になる。
// 視線の計算に使うので、必ずカメラを temp に使うこと。
const TMP_CAMERA = new THREE.PerspectiveCamera();

function makePose(): Pose {
  return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 70 };
}

export function poseLookingAt(eye: THREE.Vector3, lookAt: THREE.Vector3, fov: number): Pose {
  TMP_CAMERA.position.copy(eye);
  TMP_CAMERA.up.set(0, 1, 0);
  TMP_CAMERA.lookAt(lookAt);
  return { position: eye.clone(), quaternion: TMP_CAMERA.quaternion.clone(), fov };
}

function poseFromSpot(spot: ViewSpot): Pose {
  return poseLookingAt(spot.eye, spot.lookAt, spot.definition.fov);
}

function currentPose(camera: THREE.PerspectiveCamera): Pose {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    fov: camera.fov,
  };
}

function playerPose(player: PlayerController, fov: number): Pose {
  const position = new THREE.Vector3(
    player.position.x,
    player.position.y + player.eyeHeight,
    player.position.z,
  );
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'),
  );
  return { position, quaternion, fov };
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    position: a.position.clone().lerp(b.position, t),
    quaternion: a.quaternion.clone().slerp(b.quaternion, t),
    fov: THREE.MathUtils.lerp(a.fov, b.fov, t),
  };
}

function applyPose(camera: THREE.PerspectiveCamera, pose: Pose): void {
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  if (Math.abs(camera.fov - pose.fov) > 1e-4) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
}
