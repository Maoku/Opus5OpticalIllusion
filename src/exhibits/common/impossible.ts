import * as THREE from 'three';
import { placeOnEyeRay } from './eyeProjection';

/**
 * 「あり得ない立体」の共通部品。
 *
 * 単一視点でのみ成立する立体は 2 つの条件を満たす必要がある:
 *   1. 見かけの太さが一定であること（手前の桁ほど細く作る）
 *   2. 破綻する継ぎ目で、手前の桁の端面が奥の桁の輪郭とぴったり重なること
 * 実物のペンローズ立体の彫刻も、この 2 つを木工で実現している。
 */

export type Face = [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];

/** 軸に垂直な正方形断面を、周回順（反時計回り）で返す */
export function squareFace(
  centre: THREE.Vector3,
  axis: THREE.Vector3,
  halfSize: number,
  upHint = new THREE.Vector3(0, 1, 0),
): Face {
  const n = axis.clone().normalize();
  let u = new THREE.Vector3().crossVectors(n, upHint);
  if (u.lengthSq() < 1e-8) u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(1, 0, 0));
  u.normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return [
    centre.clone().addScaledVector(u, -halfSize).addScaledVector(v, -halfSize),
    centre.clone().addScaledVector(u, halfSize).addScaledVector(v, -halfSize),
    centre.clone().addScaledVector(u, halfSize).addScaledVector(v, halfSize),
    centre.clone().addScaledVector(u, -halfSize).addScaledVector(v, halfSize),
  ];
}

/** 2 つの四角形断面をつなぐ角柱 */
export function prismFromFaces(a: Face, b: Face): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const pushQuad = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) => {
    normal.crossVectors(e1.subVectors(p1, p0), e2.subVectors(p2, p0)).normalize();
    for (const [x, y, z] of [
      [p0, p1, p2],
      [p0, p2, p3],
    ] as const) {
      positions.push(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
      for (let i = 0; i < 3; i++) normals.push(normal.x, normal.y, normal.z);
    }
  };

  pushQuad(a[0], a[3], a[2], a[1]);
  pushQuad(b[0], b[1], b[2], b[3]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pushQuad(a[i]!, b[i]!, b[j]!, a[j]!);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** 見かけの太さを一定に保つための半径（視点距離に比例させる） */
export function apparentHalfSize(
  point: THREE.Vector3,
  eye: THREE.Vector3,
  size: number,
  referenceDistance: number,
): number {
  return (size / 2) * (point.distanceTo(eye) / referenceDistance);
}

/**
 * 破綻する継ぎ目のための端面。
 *
 * 奥の桁の端面 farFace を視点から見た「見かけの輪郭」に、
 * 手前の桁の端面をぴったり重ねる。placeOnEyeRay をそのまま使う。
 * ここが合っていないと継ぎ目に段差が出て、一目で嘘だと分かる。
 */
export function alignedFace(farFace: Face, eye: THREE.Vector3, depth: number): Face {
  return farFace.map((corner) => placeOnEyeRay(eye, corner, depth)) as Face;
}

/** 周回順を巡回・反転させて、参照面に最も近い対応付けを選ぶ（角柱のねじれを最小化する） */
export function bestOrder(face: Face, reference: Face): Face {
  let best: Face = face;
  let bestCost = Infinity;
  for (const flip of [false, true]) {
    const base = flip ? ([face[0], face[3], face[2], face[1]] as Face) : face;
    for (let shift = 0; shift < 4; shift++) {
      const candidate = [0, 1, 2, 3].map((i) => base[(i + shift) % 4]!) as Face;
      let cost = 0;
      for (let i = 0; i < 4; i++) cost += candidate[i]!.distanceTo(reference[i]!);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * 局所の (1,1,1)/√3 軸を、指定した方向へ向けるクォータニオン。
 *
 * 互いに直交する3本の角柱を「立方体の対角線方向」から見ると、
 * 3本が 120° ずつに投影されて閉じた三角形に見える。
 * これがペンローズの三角形／階段の成立条件そのもの。
 */
export function alignDiagonalTo(direction: THREE.Vector3): THREE.Quaternion {
  const diagonal = new THREE.Vector3(1, 1, 1).normalize();
  return new THREE.Quaternion().setFromUnitVectors(diagonal, direction.clone().normalize());
}
