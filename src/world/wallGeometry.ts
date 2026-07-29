import { AREAS, type AreaDefinition, type Doorway } from '../data/layout';

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
  /**
   * 板を面のどちら半分に寄せるか。+1 なら座標が増える側、-1 なら減る側、
   * 0 なら面をまたぐ（従来どおり）。
   *
   * エリアはそれぞれ独立に4辺を建てるので、隣り合うエリアの境界には
   * **同じ平面の板が2枚**立つ。どちらも面をまたぐと表裏の面がぴったり重なり、
   * 深度値が競合して視点のわずかな移動でちらつく（Z ファイティング）。
   * 共有区間では互いに自分の部屋側の半分だけを持たせて、面の重なりを無くす。
   */
  inner: 0 | 1 | -1;
}

export interface Interval {
  from: number;
  to: number;
}

/**
 * 板が厚み方向に占める範囲。inner が 0 でなければ面の内側半分だけを返す。
 *
 * 部屋から見える内側の面（at ± thickness/2）は半分に割っても動かない。
 * 動くのは裏側の面だけで、そこは隣のエリアの板とぴったり突き合う。
 */
export function pieceSlab(piece: WallPiece, thickness: number): Interval {
  const depth = piece.inner === 0 ? thickness : thickness / 2;
  const at = piece.at + (piece.inner * thickness) / 4;
  return { from: at - depth / 2, to: at + depth / 2 };
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

/** 重なりを均した昇順の区間列にする */
function normalize(list: readonly Interval[]): Interval[] {
  const sorted = list
    .map((c) => ({ from: Math.min(c.from, c.to), to: Math.max(c.from, c.to) }))
    .filter((c) => c.to - c.from > 1e-6)
    .sort((a, b) => a.from - b.from);

  const out: Interval[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.from <= last.to + 1e-6) last.to = Math.max(last.to, c.to);
    else out.push(c);
  }
  return out;
}

/** span と list の共通部分 */
function intersectIntervals(span: Interval, list: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const c of list) {
    const from = Math.max(span.from, c.from);
    const to = Math.min(span.to, c.to);
    if (to - from > 1e-6) out.push({ from, to });
  }
  return out;
}

interface WallSpec {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  /** この面の内側（部屋のある側）の向き */
  side: 1 | -1;
}

function wallsOf(area: AreaDefinition): WallSpec[] {
  const [x0, z0] = area.min;
  const [x1, z1] = area.max;
  return [
    { axis: 'z', at: z0, from: x0, to: x1, side: 1 },
    { axis: 'z', at: z1, from: x0, to: x1, side: -1 },
    { axis: 'x', at: x0, from: z0, to: z1, side: 1 },
    { axis: 'x', at: x1, from: z0, to: z1, side: -1 },
  ];
}

/**
 * 壁 w のうち、別のエリアが裏側から接している区間を返す。
 *
 * ここが「板を半分にする」区間になる。まぐさも含めて判定するので、
 * 天井の低い通路の上に隣室のまぐさが被さってちらつくのも同時に消える。
 */
function sharedIntervals(
  w: WallSpec,
  self: AreaDefinition,
  areas: readonly AreaDefinition[],
): Interval[] {
  const out: Interval[] = [];
  for (const b of areas) {
    if (b.id === self.id) continue;
    // 裏側のエリアは、この面を自分の反対側の辺として持っている
    const axisIndex = w.axis === 'z' ? 1 : 0;
    const face = w.side === 1 ? b.max[axisIndex] : b.min[axisIndex];
    if (Math.abs(face - w.at) > 1e-6) continue;

    const alongIndex = w.axis === 'z' ? 0 : 1;
    const from = Math.max(w.from, b.min[alongIndex]);
    const to = Math.min(w.to, b.max[alongIndex]);
    if (to - from > 1e-6) out.push({ from, to });
  }
  return normalize(out);
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
 *
 * `areas` は「裏側に別のエリアが接しているか」の判定に使う。接している区間は
 * 板を半分に割って自分の側だけを持つ（WallPiece.inner）。既定は実レイアウト全体。
 */
export function buildWallPieces(
  area: AreaDefinition,
  doorways: readonly Doorway[],
  areas: readonly AreaDefinition[] = AREAS,
): WallPiece[] {
  const pieces: WallPiece[] = [];

  for (const w of wallsOf(area)) {
    const shared = sharedIntervals(w, area, areas);

    /** 区間を「隣と共有する部分」と「単独で建てる部分」に割って積む */
    const emit = (span: Interval, y0: number, y1: number, blocking: boolean): void => {
      const base = { axis: w.axis, at: w.at, y0, y1, blocking };
      for (const s of intersectIntervals(span, shared)) {
        pieces.push({ ...base, from: s.from, to: s.to, inner: w.side });
      }
      for (const s of subtractIntervals(span.from, span.to, shared)) {
        pieces.push({ ...base, from: s.from, to: s.to, inner: 0 });
      }
    };

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
      emit(solid, 0, area.height, true);
    }

    for (const { interval, doorway } of cuts) {
      const top = Math.min(doorway.height, area.height);
      // まぐさ（開口の上の壁）
      if (area.height - top > 1e-3) {
        emit(interval, top, area.height, false);
      }
    }
  }

  return pieces;
}
