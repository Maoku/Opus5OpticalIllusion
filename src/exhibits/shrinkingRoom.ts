import * as THREE from 'three';
import { DEFAULT_EYE_HEIGHT } from '../player/PlayerController';
import { clamp, easeInOutSine, lerp } from '../utils/math';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * D2「縮んでいく部屋」/ The Shrinking Room（ROOM_D §1）。
 *
 * ★ 成立条件: **観測者の身体が改変されること**。
 *   何の変哲もない廊下。入ってから 60 秒かけて、プレイヤーの目線の高さが
 *   1.60m から 1.15m へ気づけない速さで下がる。来館者は自分が縮んでいるとは思わず
 *   「この部屋、だんだん天井が高くなってないか？」と感じる。
 *   出口には入室時の目線の高さに水平ラインが引いてある。それが頭上を通る。
 *
 * ★ 安全側の設計（ROOM_D §5 のリスク表）:
 *   - prefers-reduced-motion か設定トグルで完全に無効化する
 *   - スマホは 3D 酔いのリスクが高いのでドリフト時間を 90 秒へ延ばす（§4.5）
 *   - 巻き戻しは ExhibitManager が退出時・dispose 時・ワープ時に保証する
 */

const START_HEIGHT = DEFAULT_EYE_HEIGHT;
const END_HEIGHT = 1.15;
const DRIFT_SECONDS = 60;
const DRIFT_SECONDS_MOBILE = 90;

const HALF_WIDTH = 1.4;
const HEIGHT = 2.6;
const Z_NEAR = -27.5;
const Z_FAR = -38.5;
const POSITION = { x: 0, y: 0, z: (Z_NEAR + Z_FAR) / 2 };
const LENGTH = Z_NEAR - Z_FAR;

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x6e727b, roughness: 0.95 });
  const geometries: THREE.BufferGeometry[] = [];

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, wallMaterial);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };

  // 側壁と天井。原点は廊下の中心なので z は 0 基準
  addBox(0.24, HEIGHT, LENGTH, -HALF_WIDTH, HEIGHT / 2, 0);
  addBox(0.24, HEIGHT, LENGTH, HALF_WIDTH, HEIGHT / 2, 0);
  addBox(HALF_WIDTH * 2 + 0.24, 0.16, LENGTH, 0, HEIGHT, 0);

  // 側壁の当たり判定。ExhibitManager が展示 ID のタグで一括除去する
  const id = ctx.definition.id;
  for (const side of [-1, 1]) {
    ctx.collision.addSegment(
      POSITION.x + side * HALF_WIDTH,
      Z_NEAR,
      POSITION.x + side * HALF_WIDTH,
      Z_FAR,
      0.24,
      id,
    );
  }

  // 出口の水平ライン。入室時のあなたの目の高さ
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xff5c3d });
  lineMaterial.toneMapped = false;
  const line = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2, 0.018, 0.018), lineMaterial);
  line.position.set(0, START_HEIGHT, Z_FAR - POSITION.z + 0.7);
  root.add(line);

  const removeSpot = ctx.lighting.addSpot({
    position: new THREE.Vector3(POSITION.x, HEIGHT - 0.2, POSITION.z + LENGTH * 0.3),
    target: new THREE.Vector3(POSITION.x, 0.4, POSITION.z - LENGTH * 0.35),
    color: 0xf3ecdd,
    // decay = 0 で距離減衰を切り、廊下全体を均一に照らす。
    // 明るさの勾配が残ると「奥ほど暗い」が奥行きの手がかりになってしまう
    intensity: 3.4,
    angle: 0.78,
    penumbra: 0.8,
    distance: 0,
    decay: 0,
    critical: true,
  });

  let dwell = 0;
  let inside = false;
  let revealed = false;

  /** 上書きを完全に取り下げる。目線の高さは PlayerController が 0.4 秒ほどで戻す */
  const releaseOverride = (): void => {
    ctx.playerOverride.setEyeHeight(null);
    ctx.playerOverride.setMoveSpeedScale(null);
  };

  return {
    root,
    onZoneEnter() {
      inside = true;
      dwell = 0;
    },
    onZoneExit() {
      inside = false;
      dwell = 0;
      releaseOverride();
    },
    update(dt) {
      if (!inside) return;
      // 無効化されていたら何もしない。滞在中に切られた場合もここで巻き戻る
      if (!ctx.flags.shrinkingRoom || ctx.flags.reducedMotion || revealed) {
        releaseOverride();
        return;
      }
      const duration = ctx.flags.mobile ? DRIFT_SECONDS_MOBILE : DRIFT_SECONDS;
      dwell += dt;
      const k = easeInOutSine(clamp(dwell / duration, 0, 1));
      const eyeHeight = lerp(START_HEIGHT, END_HEIGHT, k);
      ctx.playerOverride.setEyeHeight(eyeHeight);
      // 歩幅も縮める。速度がそのままだと「縮んでいない」ことに気づかれる
      ctx.playerOverride.setMoveSpeedScale(Math.sqrt(eyeHeight / START_HEIGHT));
    },
    setRevealed(isRevealed, progress) {
      revealed = isRevealed;
      // タネあかしの山場は「一気に元の高さへ戻す」瞬間。
      // 上書きを外すと PlayerController が 0.4 秒ほどで 1.60m へ戻す
      if (isRevealed) {
        releaseOverride();
        dwell = 0;
      }
      lineMaterial.color.setHex(progress > 0.2 ? 0x6fd2b0 : 0xff5c3d);
    },
    dispose() {
      removeSpot();
      releaseOverride();
      for (const geometry of geometries) geometry.dispose();
      wallMaterial.dispose();
      line.geometry.dispose();
      lineMaterial.dispose();
    },
  };
}

export const shrinkingRoom: ExhibitDefinition = {
  id: 'shrinkingRoom',
  textKey: 'shrinkingRoom',
  room: 'opus',
  kind: 'zone',
  order: 22,
  reveal: 'none',
  position: POSITION,
  rotationY: 0,
  zone: {
    min: { x: POSITION.x - HALF_WIDTH, y: -1, z: Z_FAR },
    max: { x: POSITION.x + HALF_WIDTH, y: 3, z: Z_NEAR },
  },
  // 中を歩く展示なので、占有範囲＝ゾーンそのもの（§10b）
  footprint: {
    minX: POSITION.x - HALF_WIDTH,
    maxX: POSITION.x + HALF_WIDTH,
    minZ: Z_FAR,
    maxZ: Z_NEAR,
  },
  build,
};
