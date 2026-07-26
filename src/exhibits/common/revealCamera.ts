import type { Footprint } from '../types';

/**
 * 「タネあかし」でカメラを回り込ませるときの視点選び（§11d-1）。
 *
 * 以前は正解視点から常に +72° と決め打ちしていた。ブーシェの椅子では
 * 中心 (31, −6.2)・半径 6.67m なので +72° の視点が x ≈ 37.3 になり、
 * Room C（x∈[14,34]）の壁の外へ抜けていた。壁の外からでは何も見えない。
 *
 * 角度を候補列にして、エリアの内側に収まり、かつ他展示の占有範囲に
 * 潜り込まない最初のものを採る。全滅したら半径を縮めて再試行し、
 * それでも駄目なら最後にエリア矩形へクランプして必ず室内に着地させる。
 */

/** 試す角度（度）。破綻がよく見える順に並べる */
export const ORBIT_ANGLES: readonly number[] = [72, -72, 52, -52, 36, -36];
/** 角度が全滅したときに縮める半径の倍率 */
export const ORBIT_RADIUS_STEPS: readonly number[] = [1, 0.7, 0.49];

export interface OrbitPick {
  /** 採用した角度（度） */
  degrees: number;
  /** 採用した半径 */
  radius: number;
  x: number;
  z: number;
  /** 候補が全滅し、矩形へのクランプで着地したか */
  clamped: boolean;
}

export interface OrbitOptions {
  centre: { x: number; z: number };
  radius: number;
  /** 正解視点の方位（ラジアン、atan2(dx, dz)） */
  baseAngle: number;
  /** 収めたいエリアの矩形。null なら制約なし */
  bounds: Footprint | null;
  /** 避けたい他展示の占有範囲 */
  blockers?: readonly Footprint[];
  /** 壁からの余白 */
  margin?: number;
}

function inside(bounds: Footprint | null, x: number, z: number, margin: number): boolean {
  if (!bounds) return true;
  return (
    x >= bounds.minX + margin &&
    x <= bounds.maxX - margin &&
    z >= bounds.minZ + margin &&
    z <= bounds.maxZ - margin
  );
}

function blocked(blockers: readonly Footprint[], x: number, z: number): boolean {
  return blockers.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}

function clamp(value: number, min: number, max: number): number {
  // 部屋が余白の 2 倍より狭い場合に min > max になる。中点へ寄せる
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

export function pickOrbitViewpoint(options: OrbitOptions): OrbitPick {
  const { centre, baseAngle, bounds } = options;
  const blockers = options.blockers ?? [];
  const margin = options.margin ?? 0.6;

  const at = (degrees: number, radius: number): { x: number; z: number } => {
    const angle = baseAngle + (degrees * Math.PI) / 180;
    return { x: centre.x + Math.sin(angle) * radius, z: centre.z + Math.cos(angle) * radius };
  };

  for (const step of ORBIT_RADIUS_STEPS) {
    const radius = options.radius * step;
    for (const degrees of ORBIT_ANGLES) {
      const p = at(degrees, radius);
      if (!inside(bounds, p.x, p.z, margin)) continue;
      if (blocked(blockers, p.x, p.z)) continue;
      return { degrees, radius, x: p.x, z: p.z, clamped: false };
    }
  }

  // 全滅。いちばん小さい半径の第一候補を室内へ押し込む
  const radius = options.radius * ORBIT_RADIUS_STEPS[ORBIT_RADIUS_STEPS.length - 1]!;
  const degrees = ORBIT_ANGLES[0]!;
  const p = at(degrees, radius);
  if (!bounds) return { degrees, radius, x: p.x, z: p.z, clamped: false };
  return {
    degrees,
    radius,
    x: clamp(p.x, bounds.minX + margin, bounds.maxX - margin),
    z: clamp(p.z, bounds.minZ + margin, bounds.maxZ - margin),
    clamped: true,
  };
}

/** 真上からの視点も部屋の外へ出うる。XZ だけ矩形へ収める */
export function clampToBounds(
  bounds: Footprint | null,
  x: number,
  z: number,
  margin = 0.6,
): { x: number; z: number } {
  if (!bounds) return { x, z };
  return {
    x: clamp(x, bounds.minX + margin, bounds.maxX - margin),
    z: clamp(z, bounds.minZ + margin, bounds.maxZ - margin),
  };
}
