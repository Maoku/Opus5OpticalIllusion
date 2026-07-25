import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function saturate(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** dt に依存しない指数減衰の補間係数。`lerp(a, b, damp(rate, dt))` の形で使う。 */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** -PI..PI に正規化した角度差 */
export function shortestAngleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// ---------------------------------------------------------------- easing

export function easeInOutCubic(t: number): number {
  const x = saturate(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * saturate(t)) - 1) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - saturate(t), 3);
}

// ---------------------------------------------------------------- geometry

export interface ClosestRayPoints {
  /** ray1 上の最近接点 */
  p1: THREE.Vector3;
  /** ray2 上の最近接点 */
  p2: THREE.Vector3;
  /** p1 と p2 の距離 */
  distance: number;
  /** o1 + d1 * t1 = p1 */
  t1: number;
  /** o2 + d2 * t2 = p2 */
  t2: number;
}

/**
 * 2本のレイの最近接点対を求める（Room D1「二つの真実」の断片配置に使う）。
 * 方向ベクトルは内部で正規化するため、呼び出し側で正規化しなくてよい。
 * 平行な場合は t1 = t2 = 0（原点同士）を返す。
 */
export function closestPointsBetweenRays(
  o1: THREE.Vector3,
  d1: THREE.Vector3,
  o2: THREE.Vector3,
  d2: THREE.Vector3,
): ClosestRayPoints {
  const u = d1.clone().normalize();
  const v = d2.clone().normalize();
  const w0 = o1.clone().sub(o2);

  const b = u.dot(v);
  const d = u.dot(w0);
  const e = v.dot(w0);
  const denom = 1 - b * b;

  let t1: number;
  let t2: number;
  if (Math.abs(denom) < 1e-9) {
    // 平行（またはほぼ平行）: 一意な解が無いので原点側で評価する
    t1 = 0;
    t2 = e;
  } else {
    t1 = (b * e - d) / denom;
    t2 = (e - b * d) / denom;
  }

  const p1 = o1.clone().addScaledVector(u, t1);
  const p2 = o2.clone().addScaledVector(v, t2);
  return { p1, p2, distance: p1.distanceTo(p2), t1, t2 };
}

/** 2点の中点 */
export function midpoint(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  return a.clone().add(b).multiplyScalar(0.5);
}

/**
 * 線分 [p, p+r] と線分 [q, q+s] の交差パラメータ t（p 側）を返す。交差しなければ null。
 * 壁抜け（トンネリング）の検出に使う。
 */
export function segmentIntersectionT(
  p: THREE.Vector2,
  p2: THREE.Vector2,
  q: THREE.Vector2,
  q2: THREE.Vector2,
): number | null {
  const rx = p2.x - p.x;
  const ry = p2.y - p.y;
  const sx = q2.x - q.x;
  const sy = q2.y - q.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // 平行
  const qpx = q.x - p.x;
  const qpy = q.y - p.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/**
 * 円（中心 c・半径 r）と線分 [a, b] の衝突を解決し、めり込み解消用の押し出しベクトルを返す。
 * 衝突していなければ null。XZ 平面（Vector2 = (x, z)）で扱う。
 */
export function resolveCircleSegment(
  c: THREE.Vector2,
  r: number,
  a: THREE.Vector2,
  b: THREE.Vector2,
): THREE.Vector2 | null {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  const t = lenSq === 0 ? 0 : saturate(c.clone().sub(a).dot(ab) / lenSq);
  const closest = a.clone().addScaledVector(ab, t);
  const delta = c.clone().sub(closest);
  const dist = delta.length();
  if (dist >= r) return null;
  if (dist < 1e-6) {
    // 線分上に完全に乗ってしまった場合は法線方向へ逃がす
    const n = new THREE.Vector2(-ab.y, ab.x).normalize();
    return n.multiplyScalar(r);
  }
  return delta.multiplyScalar((r - dist) / dist);
}
