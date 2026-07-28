import * as THREE from 'three';
import { degToRad } from '../../utils/math';

/**
 * 「いま見られているか」を判定する（ROOM_D §2.4 の `VisibilityTracker`）。
 *
 * D3「後ろの正面」の成立条件は **観測者の視線そのもの**である。
 * 見ていないことが入力になるので、判定を間違えると
 * 「目の前で動いた」＝ただのバグにしか見えなくなる。安全側に倒し、
 * 少しでも見えている可能性があるものは「見えている」と扱う。
 *
 * 判定は 3 段:
 *   1. 視錐台に入っているか（`Frustum.intersectsSphere`）
 *   2. 遮蔽物に隠れていないか（カメラからのレイキャスト）
 *   3. 注視されたか（画面中央から一定角以内に一定時間）
 *
 * 3 は「視界の端をかすめただけ」と「じっと見た」を分けるためにある。
 * 直前に注視された個体を触ると、記憶と食い違って気づかれる。
 *
 * §Phase 4 の展示カリング（一定距離を超えたら update を止める）と同じ材料を
 * 扱うので、距離の上限もここで持つ。
 */

export interface VisibilityTarget {
  /** ワールド座標 */
  position: THREE.Vector3;
  /** 判定に使う球の半径。実体より少し大きめに取る */
  radius: number;
}

export interface VisibilityOptions {
  /** 「注視」とみなす画面中央からの角度（度） */
  gazeAngle?: number;
  /** 注視の成立に必要な継続時間（秒） */
  gazeSeconds?: number;
  /** 注視の記憶を保つ時間（秒） */
  memorySeconds?: number;
  /** これより遠い対象は「見えていない」とする（m） */
  maxDistance?: number;
  /** 遮蔽判定に使うオブジェクト。空なら遮蔽なしとして扱う */
  occluders?: THREE.Object3D[];
}

interface TargetState {
  visible: boolean;
  /** 最後に見えていた時刻。一度も見えていなければ -Infinity */
  lastVisibleAt: number;
  /** 注視が成立した最後の時刻 */
  lastGazedAt: number;
  /** 現在の連続注視時間 */
  gazeHeld: number;
}

export class VisibilityTracker {
  readonly #frustum = new THREE.Frustum();
  readonly #matrix = new THREE.Matrix4();
  readonly #sphere = new THREE.Sphere();
  readonly #raycaster = new THREE.Raycaster();
  readonly #cameraPosition = new THREE.Vector3();
  readonly #forward = new THREE.Vector3();
  readonly #toTarget = new THREE.Vector3();
  readonly #states: TargetState[] = [];

  #occluders: THREE.Object3D[];
  #time = 0;

  readonly gazeCos: number;
  readonly gazeSeconds: number;
  readonly memorySeconds: number;
  readonly maxDistance: number;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly targets: readonly VisibilityTarget[],
    options: VisibilityOptions = {},
  ) {
    this.gazeCos = Math.cos(degToRad(options.gazeAngle ?? 20));
    this.gazeSeconds = options.gazeSeconds ?? 0.3;
    this.memorySeconds = options.memorySeconds ?? 2;
    this.maxDistance = options.maxDistance ?? 20;
    this.#occluders = options.occluders ?? [];
    for (let i = 0; i < targets.length; i++) {
      this.#states.push({
        visible: false,
        lastVisibleAt: -Infinity,
        lastGazedAt: -Infinity,
        gazeHeld: 0,
      });
    }
  }

  setOccluders(objects: THREE.Object3D[]): void {
    this.#occluders = objects;
  }

  get time(): number {
    return this.#time;
  }

  update(dt: number): void {
    this.#time += dt;
    this.camera.updateMatrixWorld();
    this.#matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.#frustum.setFromProjectionMatrix(this.#matrix);
    this.camera.getWorldPosition(this.#cameraPosition);
    this.camera.getWorldDirection(this.#forward);

    for (let i = 0; i < this.targets.length; i++) {
      const target = this.targets[i]!;
      const state = this.#states[i]!;
      this.#toTarget.copy(target.position).sub(this.#cameraPosition);
      const distance = this.#toTarget.length();

      let visible = distance <= this.maxDistance;
      if (visible) {
        this.#sphere.set(target.position, target.radius);
        visible = this.#frustum.intersectsSphere(this.#sphere);
      }
      if (visible && this.#occluders.length > 0 && distance > target.radius) {
        visible = !this.#isOccluded(distance, target.radius);
      }

      state.visible = visible;
      if (visible) state.lastVisibleAt = this.#time;

      // 注視: 画面中央に近いまま一定時間留まったか
      const centred =
        visible && distance > 1e-4 && this.#toTarget.dot(this.#forward) / distance >= this.gazeCos;
      state.gazeHeld = centred ? state.gazeHeld + dt : 0;
      if (state.gazeHeld >= this.gazeSeconds) state.lastGazedAt = this.#time;
    }
  }

  isVisible(index: number): boolean {
    return this.#states[index]?.visible ?? false;
  }

  /** 最後に見えてからの経過秒。一度も見えていなければ Infinity */
  secondsSinceVisible(index: number): number {
    const state = this.#states[index];
    if (!state) return Infinity;
    return this.#time - state.lastVisibleAt;
  }

  /** 記憶が残っている間に注視されたか */
  wasGazedRecently(index: number, seconds = this.memorySeconds): boolean {
    const state = this.#states[index];
    if (!state) return false;
    return this.#time - state.lastGazedAt <= seconds;
  }

  /**
   * 触ってよい対象か。「見えていない」かつ「直近に注視されていない」が条件。
   * D3 はこの判定だけを使って変化を掛ける。
   */
  isUnobserved(index: number, seconds = this.memorySeconds): boolean {
    return !this.isVisible(index) && !this.wasGazedRecently(index, seconds);
  }

  #isOccluded(distance: number, radius: number): boolean {
    this.#raycaster.set(this.#cameraPosition, this.#toTarget.clone().normalize());
    this.#raycaster.near = 0;
    // 対象の手前までしか見ない。対象そのものを遮蔽物に含めてはいけない
    this.#raycaster.far = distance - radius;
    if (this.#raycaster.far <= 0) return false;
    return this.#raycaster.intersectObjects(this.#occluders, true).length > 0;
  }
}
