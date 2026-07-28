import * as THREE from 'three';
import { closestPointsBetweenRays, midpoint } from '../../utils/math';
import type { GlyphPoint } from './GlyphSampler';

/**
 * 2 視点アナモルフォーシスの断片配置（ROOM_D §1 の D1「二つの真実」）。
 *
 * 手順は設計書のとおり:
 *
 *   1. 視点 A の理想像（字 A）の各点へレイを飛ばす        → rayA[0..N]
 *   2. 視点 B の理想像（字 B）でも同様に                  → rayB[0..M]
 *   3. rayA[i] と rayB[j] のマッチングを解く（最近接距離が評価値）
 *   4. 各ペアの最近接点の中点に断片を置く
 *   5. 断片の法線 = 2 つの視線方向の角二等分ベクトル（両視点から面が見える）
 *   6. 断片のスケール ∝ 各視点からの距離（見かけの大きさを一定に保つ）
 *   7. 同一視点から見て角度が近すぎる断片対は除去（相互遮蔽の防止）
 *
 * 純粋関数として切ってあるのは、テストで「両視点からの再投影誤差」を
 * 直接測れるようにするため。ここが汚いと看板作品が「ただの塵」で終わる。
 */

export interface Fragment {
  /** ワールド座標 */
  position: THREE.Vector3;
  /** 面の法線（2 視線の角二等分） */
  normal: THREE.Vector3;
  /** 一辺の長さ（m） */
  size: number;
  /** 元になった字 A / 字 B の点。テストと調整用 */
  source: { a: GlyphPoint; b: GlyphPoint };
  /** 2 レイの最近接距離（＝この断片のずれの大きさ） */
  error: number;
}

export interface DualViewOptions {
  eyeA: THREE.Vector3;
  eyeB: THREE.Vector3;
  /** 彫刻の中心。理想像の平面はここを通る */
  centre: THREE.Vector3;
  /** 字の実寸（m）。正規化点 ±0.5 がこの幅に対応する */
  glyphSize: number;
  pointsA: readonly GlyphPoint[];
  pointsB: readonly GlyphPoint[];
  /** 最近接距離がこれを超えるペアは捨てる（m） */
  maxError: number;
  /** 見かけの一辺（視距離 1m あたりの大きさ）。距離を掛けて実寸にする */
  angularSize: number;
  /** 同一視点から見た角度がこれ未満の断片対は片方を捨てる（ラジアン） */
  minSeparation: number;
}

/** 理想像の平面上の点。視点から中心を見たときの右・上を基底に取る */
function imagePoint(
  eye: THREE.Vector3,
  centre: THREE.Vector3,
  point: GlyphPoint,
  size: number,
): THREE.Vector3 {
  const forward = centre.clone().sub(eye).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  // 視線が真上を向いている場合の保険。本作の視点は水平なので通常は通らない
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  const planeUp = new THREE.Vector3().crossVectors(right, forward).normalize();
  return centre
    .clone()
    .addScaledVector(right, point.x * size)
    .addScaledVector(planeUp, point.y * size);
}

interface Candidate {
  a: number;
  b: number;
  error: number;
  position: THREE.Vector3;
}

export function solveDualView(options: DualViewOptions): Fragment[] {
  const { eyeA, eyeB, centre, glyphSize, pointsA, pointsB } = options;

  const raysA = pointsA.map((p) => imagePoint(eyeA, centre, p, glyphSize).sub(eyeA));
  const raysB = pointsB.map((p) => imagePoint(eyeB, centre, p, glyphSize).sub(eyeB));

  // 全ペアを評価して距離順に並べ、両端が未使用のものから確定していく。
  // 貪欲だが「近い順」なので、i を順に処理する素朴な貪欲より結果が安定する。
  const candidates: Candidate[] = [];
  for (let i = 0; i < raysA.length; i++) {
    for (let j = 0; j < raysB.length; j++) {
      const hit = closestPointsBetweenRays(eyeA, raysA[i]!, eyeB, raysB[j]!);
      // 視点の後ろに解が出たペアは論外（背後の断片は像を結ばない）
      if (hit.t1 <= 0 || hit.t2 <= 0) continue;
      if (hit.distance > options.maxError) continue;
      candidates.push({ a: i, b: j, error: hit.distance, position: midpoint(hit.p1, hit.p2) });
    }
  }
  candidates.sort((x, y) => x.error - y.error);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const fragments: Fragment[] = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.a) || usedB.has(candidate.b)) continue;
    usedA.add(candidate.a);
    usedB.add(candidate.b);

    const toA = eyeA.clone().sub(candidate.position);
    const toB = eyeB.clone().sub(candidate.position);
    const distance = (toA.length() + toB.length()) / 2;
    const normal = toA.normalize().add(toB.normalize()).normalize();
    fragments.push({
      position: candidate.position,
      normal,
      size: options.angularSize * distance,
      source: { a: pointsA[candidate.a]!, b: pointsB[candidate.b]! },
      error: candidate.error,
    });
  }

  return cullCrowded(fragments, [eyeA, eyeB], options.minSeparation);
}

/**
 * 同一視点から見て角度が近すぎる断片対を間引く。
 *
 * 近すぎる 2 枚は互いを隠し合い、字の輪郭に穴を開ける。誤差の大きいほうを
 * 落とすので、残るのは「よく結んでいる断片」のほうになる。
 */
function cullCrowded(
  fragments: readonly Fragment[],
  eyes: readonly THREE.Vector3[],
  minSeparation: number,
): Fragment[] {
  if (minSeparation <= 0) return [...fragments];
  // 誤差の小さい順に採用していく
  const ordered = [...fragments].sort((a, b) => a.error - b.error);
  const kept: Fragment[] = [];
  const directions: THREE.Vector3[][] = eyes.map(() => []);
  const cosLimit = Math.cos(minSeparation);

  outer: for (const fragment of ordered) {
    const dirs = eyes.map((eye) => fragment.position.clone().sub(eye).normalize());
    for (let e = 0; e < eyes.length; e++) {
      for (const existing of directions[e]!) {
        if (existing.dot(dirs[e]!) > cosLimit) continue outer;
      }
    }
    for (let e = 0; e < eyes.length; e++) directions[e]!.push(dirs[e]!);
    kept.push(fragment);
  }
  return kept;
}

/**
 * 断片を視点から見たときの、理想像平面上の位置（正規化座標）。
 * テストと調整で「どれだけ字からずれているか」を測るのに使う。
 */
export function reprojectFragment(
  fragment: Fragment,
  eye: THREE.Vector3,
  centre: THREE.Vector3,
  glyphSize: number,
): GlyphPoint {
  const forward = centre.clone().sub(eye).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const planeUp = new THREE.Vector3().crossVectors(right, forward).normalize();

  const toFragment = fragment.position.clone().sub(eye);
  const depth = toFragment.dot(forward);
  const planeDepth = centre.clone().sub(eye).dot(forward);
  // 理想像平面まで伸ばしてから、平面上の座標を読む
  const scaled = toFragment
    .multiplyScalar(planeDepth / depth)
    .add(eye)
    .sub(centre);
  return { x: scaled.dot(right) / glyphSize, y: scaled.dot(planeUp) / glyphSize };
}
