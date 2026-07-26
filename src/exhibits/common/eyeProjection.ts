import * as THREE from 'three';

/**
 * Room B / C の生命線となる計算。
 *
 * 「視点 eye から見て、見かけの点 apparent に重なるように、
 *   eye から距離 depth の位置へ実点を置きたい」を解く。
 *
 * ペンローズの三角形（7）・階段（8）、アナモルフォーシス（10）、
 * エイムズの部屋（11）、ブーシェの椅子（12）はすべてこの式に帰着する。
 */
export function placeOnEyeRay(
  eye: THREE.Vector3,
  apparent: THREE.Vector3,
  depth: number,
): THREE.Vector3 {
  const dir = apparent.clone().sub(eye);
  const len = dir.length();
  if (len < 1e-9) {
    // 視点と見かけの点が一致している場合は方向が決まらない。前方（-Z）に置く。
    return eye.clone().add(new THREE.Vector3(0, 0, -depth));
  }
  return eye.clone().addScaledVector(dir.divideScalar(len), depth);
}

/**
 * 実点 real が、視点 eye から見て「理想形状の平面」上のどこに投影されるかを返す。
 * placeOnEyeRay の逆向きの検算に使う。plane は THREE.Plane。
 * レイが平面と交わらない場合は null。
 */
export function projectToPlaneFromEye(
  eye: THREE.Vector3,
  real: THREE.Vector3,
  plane: THREE.Plane,
): THREE.Vector3 | null {
  const ray = new THREE.Ray(eye, real.clone().sub(eye).normalize());
  const hit = ray.intersectPlane(plane, new THREE.Vector3());
  return hit ?? null;
}

/**
 * 「見かけの大きさを一定に保つ」ためのスケール係数。
 * 基準距離 refDistance に置いたときのサイズを 1 とし、
 * 距離 depth に置いた場合に同じ見かけの大きさになる倍率を返す。
 */
export function apparentSizeScale(depth: number, refDistance: number): number {
  if (refDistance <= 0) return 1;
  return depth / refDistance;
}

/**
 * 視点 eye から見た点 p の視野角（ラジアン）を、視線方向 forward に対して返す。
 * ViewSpot からの可視判定や、断片同士の角度分離チェックに使う。
 */
export function angleFromEye(eye: THREE.Vector3, forward: THREE.Vector3, p: THREE.Vector3): number {
  const to = p.clone().sub(eye);
  if (to.lengthSq() < 1e-18) return 0;
  return to.normalize().angleTo(forward.clone().normalize());
}
