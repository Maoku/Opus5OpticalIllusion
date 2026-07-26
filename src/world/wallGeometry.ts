import type { AreaDefinition, Doorway } from '../data/layout';

/** 壁の一片。軸平行なので「どの座標に立つ面か」+「どこからどこまでか」で表せる。 */
export interface WallPiece {
  /** 'x' なら x = at の面（z 方向に伸びる壁）、'z' なら z = at の面 */
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  y0: number;
  y1: number;
  /** まぐさ（開口の上）は通行を妨げない */
  blocking: boolean;
  /** locked な開口を塞ぐ扉。開錠時に取り除く */
  door?: boolean;
}

export interface Interval {
  from: number;
  to: number;
}

/** [start, end] から cuts を差し引いた残りの区間を返す */
export function subtractIntervals(start: number, end: number, cuts: Interval[]): Interval[] {
  const sorted = cuts
    .map((c) => ({
      from: Math.max(start, Math.min(c.from, c.to)),
      to: Math.min(end, Math.max(c.from, c.to)),
    }))
    .filter((c) => c.to - c.from > 1e-6)
    .sort((a, b) => a.from - b.from);

  const out: Interval[] = [];
  let cursor = start;
  for (const cut of sorted) {
    if (cut.from > cursor + 1e-6) out.push({ from: cursor, to: cut.from });
    cursor = Math.max(cursor, cut.to);
  }
  if (end > cursor + 1e-6) out.push({ from: cursor, to: end });
  return out;
}

interface WallSpec {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
}

function wallsOf(area: AreaDefinition): WallSpec[] {
  const [x0, z0] = area.min;
  const [x1, z1] = area.max;
  return [
    { axis: 'z', at: z0, from: x0, to: x1 },
    { axis: 'z', at: z1, from: x0, to: x1 },
    { axis: 'x', at: x0, from: z0, to: z1 },
    { axis: 'x', at: x1, from: z0, to: z1 },
  ];
}

/** 開口 d が壁 w を横切るなら、その壁に沿った切り欠き区間を返す */
function cutFor(w: WallSpec, d: Doorway): Interval | null {
  if (w.axis === 'z') {
    if (w.at < d.min[1] || w.at > d.max[1]) return null;
    const from = Math.max(w.from, d.min[0]);
    const to = Math.min(w.to, d.max[0]);
    return to - from > 1e-6 ? { from, to } : null;
  }
  if (w.at < d.min[0] || w.at > d.max[0]) return null;
  const from = Math.max(w.from, d.min[1]);
  const to = Math.min(w.to, d.max[1]);
  return to - from > 1e-6 ? { from, to } : null;
}

/**
 * エリアの4辺から、開口を刳り抜いた壁の一片群を生成する。
 *
 * 隣接エリアの共有壁は同じ開口で両側とも切られるため、
 * 通路の端に壁が残ることはない（layout.ts の図を参照）。
 */
export function buildWallPieces(area: AreaDefinition, doorways: readonly Doorway[]): WallPiece[] {
  const pieces: WallPiece[] = [];

  for (const w of wallsOf(area)) {
    const cuts: Array<{ interval: Interval; doorway: Doorway }> = [];
    for (const d of doorways) {
      const interval = cutFor(w, d);
      if (interval) cuts.push({ interval, doorway: d });
    }

    for (const solid of subtractIntervals(
      w.from,
      w.to,
      cuts.map((c) => c.interval),
    )) {
      pieces.push({
        axis: w.axis,
        at: w.at,
        from: solid.from,
        to: solid.to,
        y0: 0,
        y1: area.height,
        blocking: true,
      });
    }

    for (const { interval, doorway } of cuts) {
      const top = Math.min(doorway.height, area.height);
      // まぐさ（開口の上の壁）
      if (area.height - top > 1e-3) {
        pieces.push({
          axis: w.axis,
          at: w.at,
          from: interval.from,
          to: interval.to,
          y0: top,
          y1: area.height,
          blocking: false,
        });
      }
    }
  }

  return pieces;
}

/**
 * 施錠中の開口を塞ぐ扉。
 *
 * 扉は「開口ごとに1枚」であってエリアごとではない。共有壁は両側のエリアから
 * 切られるため、buildWallPieces の中で作ると同じ場所に2枚重なってしまう。
 */
export function buildDoorPieces(doorways: readonly Doorway[]): WallPiece[] {
  const pieces: WallPiece[] = [];
  for (const d of doorways) {
    if (!d.locked) continue;
    const spanX = d.max[0] - d.min[0];
    const spanZ = d.max[1] - d.min[1];
    // 薄いほうの軸が壁の法線。開口は「壁を横切る細長い AABB」として書かれている。
    if (spanZ <= spanX) {
      pieces.push({
        axis: 'z',
        at: (d.min[1] + d.max[1]) / 2,
        from: d.min[0],
        to: d.max[0],
        y0: 0,
        y1: d.height,
        blocking: true,
        door: true,
      });
    } else {
      pieces.push({
        axis: 'x',
        at: (d.min[0] + d.max[0]) / 2,
        from: d.min[1],
        to: d.max[1],
        y0: 0,
        y1: d.height,
        blocking: true,
        door: true,
      });
    }
  }
  return pieces;
}
