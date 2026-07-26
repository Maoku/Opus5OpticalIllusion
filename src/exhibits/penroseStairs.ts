import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * ペンローズの階段。
 *
 * 4 つの飛びのうち 3 つは本物の階段で、最後の 1 つだけが嘘をつく。
 *
 *   視点 E から、1 段目の足元 A へ向かうレイを引く。
 *   そのレイ上で「高さ H（4 飛び分の上昇）」になる点を E4 とする。
 *   視点が階段より上にあるので、E4 は A より手前・かつ高い位置になる。
 *   4 つ目の飛びを D から E4 まで架けると、最後の段の上端が
 *   1 段目の足元にぴったり重なって見える。
 *
 * 局所の整合性（どの段も確かに上っている）は保たれたまま、
 * 大域の整合性（一周すると元の高さに戻る）だけが破れる。
 */

const PLAN = 1.0;
const STEPS_PER_FLIGHT = 4;
export const TOTAL_STEPS = STEPS_PER_FLIGHT * 4;
/**
 * 1 段の上昇（§10a）。
 *
 * 以前は 0.028（総上昇 0.448m）で、嘘の飛びの終点 `fake` が視点側へ寄り、
 * 4 本目が **+Z（手前）へ逆走**して輪が閉じていなかった。
 * 成立条件は planStairs() のコメントにある不等式で、この寸法では
 * 総上昇 0.56m 未満。段として読める傾きを取りつつ余裕を残した値。
 */
const RISE = 0.0175;
const TREAD_WIDTH = 0.2;
/**
 * 模型を載せる台の高さと視距離。
 *
 * ペンローズの階段は「高い位置から見下ろす」ことが成立条件なので、台を低くし、
 * 近くに寄る。目線 1.6m ならローカルの視点高さ 1.35m・見下ろし角 35°、
 * 総上昇 0.20m に対する比は 0.148 で成立範囲（0.2 以下）に入る。
 */
const BASE_HEIGHT = 0.25;
const VIEW_DISTANCE = 1.9;
/**
 * Room B の左手前（§10b）。
 *
 * 以前は (−5, −2.4) で、台座がペンローズの三角形の立ち位置を飲み込んでいた。
 * 三角形・ネッカーキューブを左右の奥へ振り分け、階段は短い視距離で済むので
 * 手前に置く。
 */
const POSITION = { x: -7.0, y: BASE_HEIGHT, z: -1.4 };
/** 台座の一辺（PLAN + 0.7）。占有範囲の算出と build() で共有する */
const PLINTH_SIZE = PLAN + 0.7;

type V3 = THREE.Vector3;

/** 中庭を囲む 4 隅（展示ローカル、周回順） */
export function stairCorners(plan = PLAN): V3[] {
  const a = plan / 2;
  return [
    new THREE.Vector3(-a, 0, -a),
    new THREE.Vector3(a, 0, -a),
    new THREE.Vector3(a, 0, a),
    new THREE.Vector3(-a, 0, a),
  ];
}

export interface StairsPlan {
  /** 採用した 1 段の上昇 */
  rise: number;
  /** 総上昇 */
  height: number;
  /** 嘘をつく飛びの終点（展示ローカル） */
  fake: V3;
  corners: V3[];
  /**
   * 最後の飛びが輪を閉じる向きへ進むか。
   * `(fake − corners[3])` と `(corners[0] − corners[3])` の XZ 内積を
   * 正規化したもの。**正でなければ階段は繋がらない**。
   */
  closing: number;
  /** `fake` が視点 → corners[0] のレイから外れている距離（0 が理想） */
  projectionError: number;
  /**
   * 4 本目の飛びの長さ ÷ 一辺。短すぎると段が団子になって読めない。
   * 0.35 以上を目安にする。
   */
  flightRatio: number;
  /** 総上昇 ÷ 視点のローカル高さ */
  ratio: number;
}

/** 最後の飛びに残す最低限の長さ（一辺に対する比） */
const MIN_FLIGHT_RATIO = 0.35;

/**
 * 与えられた寸法で階段の環が閉じるかを解く（§10a-2）。
 *
 * 視点 E から 1 段目の足元 A へ引いたレイ上で、高さが総上昇 H になる点を
 * `fake` とする。ここへ 4 本目の飛びを架けると、最後の段の上端が 1 段目の
 * 足元に重なって見える。ただし視点が低いと `fake` が視点側（+Z）へ寄り、
 * 4 本目が逆走して輪が閉じない。
 *
 * 成立条件は t > (D − a)/(D + a)、すなわち
 *
 *     H < E · 2a / (D + a)
 *
 * （E = 視点のローカル高さ、D = 視距離、a = 一辺の半分）。
 * 改良計画の「H/E ≲ 0.2」はこれを安全側に丸めた目安で、実際の限界は
 * 視距離にも依る。ここでは不等式そのものを見る。
 */
export function planStairs(eye: V3, rise: number, plan = PLAN, steps = TOTAL_STEPS): StairsPlan {
  const corners = stairCorners(plan);
  const height = steps * rise;
  const start = corners[0]!.clone();
  const t = 1 - height / eye.y;
  const fake = eye.clone().lerp(start, t);

  const toClose = new THREE.Vector2(corners[0]!.x - corners[3]!.x, corners[0]!.z - corners[3]!.z);
  const step = new THREE.Vector2(fake.x - corners[3]!.x, fake.z - corners[3]!.z);
  const closing = toClose.lengthSq() > 0 ? step.dot(toClose) / toClose.length() : 0;

  // fake と、視点 → corners[0] の直線との距離
  const dir = start.clone().sub(eye);
  const projected = eye
    .clone()
    .addScaledVector(dir, fake.clone().sub(eye).dot(dir) / dir.lengthSq());

  return {
    rise,
    height,
    fake,
    corners,
    closing,
    projectionError: projected.distanceTo(fake),
    flightRatio: step.length() / plan,
    ratio: height / eye.y,
  };
}

/** 不変条件を満たすまで rise を縮める（§10a-2）。レイアウトを動かしても壊れない保険 */
export function fitStairs(eye: V3, rise: number, plan = PLAN, steps = TOTAL_STEPS): StairsPlan {
  let current = rise;
  for (let i = 0; i < 24; i++) {
    const solution = planStairs(eye, current, plan, steps);
    if (solution.closing > 0 && solution.flightRatio >= MIN_FLIGHT_RATIO) return solution;
    current *= 0.85;
  }
  return planStairs(eye, current, plan, steps);
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const eyeWorld =
    ctx.eyes[0] ?? origin.clone().add(new THREE.Vector3(0, 1.6 - BASE_HEIGHT, VIEW_DISTANCE));
  const eye = eyeWorld.clone().sub(origin);

  const totalSteps = TOTAL_STEPS;
  const solution = fitStairs(eye, RISE);
  const { corners, fake } = solution;
  const rise = solution.rise;

  /** i 番目の段の「足元」の位置 */
  const stepBase = (index: number): V3 => {
    const flight = Math.min(3, Math.floor(index / STEPS_PER_FLIGHT));
    const local = (index - flight * STEPS_PER_FLIGHT) / STEPS_PER_FLIGHT;
    const from = corners[flight]!;
    const to = flight === 3 ? fake : corners[flight + 1]!;
    const p = from.clone().lerp(to, local);
    p.y = index * rise;
    return p;
  };

  const reference = stepBase(0).distanceTo(eye);
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < totalSteps; i++) {
    const from = stepBase(i);
    const to = stepBase(i + 1);
    const along = to.clone().sub(from);
    along.y = 0;
    const treadDepth = Math.max(0.04, along.length());
    // 見かけの太さを揃える（近い段ほど細く作る）
    const scale = from.distanceTo(eye) / reference;
    // 厚みは 1 段の上昇の 2.1 倍。隣り合う段の上端と下端がちょうど接する
    const box = new THREE.BoxGeometry(TREAD_WIDTH * scale, rise * 2.1 * scale, treadDepth);
    const angle = Math.atan2(along.x, along.z);
    box.rotateY(angle);
    box.translate(from.x + along.x / 2, from.y, from.z + along.z / 2);
    geometries.push(box);
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xcac4b6,
    roughness: 0.6,
    metalness: 0.1,
  });
  const stairs = new THREE.Mesh(mergeGeometries(geometries, false)!, material);
  stairs.castShadow = true;
  stairs.receiveShadow = true;
  root.add(stairs);
  for (const g of geometries) g.dispose();

  // 中庭（階段が囲む壁）。奥行きの手がかりを減らし、階段だけを読ませる。
  // **最下段より高くしない**（§10a）。高くすると奥の 2 本の飛びが中庭の陰に
  // 隠れ、肝心の「環が閉じている」ことが見えなくなる。
  const wellHeight = Math.max(0.04, rise * 3);
  const well = new THREE.Mesh(
    new THREE.BoxGeometry(PLAN - TREAD_WIDTH, wellHeight, PLAN - TREAD_WIDTH),
    new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95 }),
  );
  well.position.y = wellHeight / 2 - 0.02;
  well.receiveShadow = true;
  root.add(well);

  const plinthHeight = BASE_HEIGHT;
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(PLINTH_SIZE, plinthHeight, PLINTH_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.8 }),
  );
  plinth.position.y = -plinthHeight / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(1.4, 2.6, 1.2)),
    target: origin.clone(),
    color: 0xfff4e6,
    intensity: 20,
    angle: 0.45,
    penumbra: 0.6,
    distance: 10,
    shadow: true,
  });

  return {
    root,
    setRevealed(_revealed, progress) {
      material.emissive.setHex(0x2f6f5c);
      material.emissiveIntensity = progress * 0.4;
    },
    dispose() {
      removeSpot();
      stairs.geometry.dispose();
      material.dispose();
      well.geometry.dispose();
      (well.material as THREE.Material).dispose();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
    },
  };
}

export const penroseStairs: ExhibitDefinition = {
  id: 'penroseStairs',
  textKey: 'penroseStairs',
  room: 'impossible',
  kind: 'object',
  order: 8,
  reveal: 'orbit',
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: BASE_HEIGHT + 0.1,
    halfX: PLINTH_SIZE / 2,
    // 見下ろし角が浅いと段の重なりが読めない。模型が小さくなったぶん寄せて絞る
    fov: 30,
    radius: 1.1,
  }),
  position: POSITION,
  revealFocus: { x: 0, y: 0.2, z: 0 },
  build,
};
