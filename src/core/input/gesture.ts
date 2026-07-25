/**
 * タッチ操作の純ロジック（§9: pointerId 管理のロジックを純関数化して検証する）。
 * DOM に触れないのでそのまま Vitest で回せる。
 */

/** タップ判定の閾値（§4.2: 移動 10px 未満 & 300ms 未満） */
export const TAP_MAX_DISTANCE_PX = 10;
export const TAP_MAX_DURATION_MS = 300;

export interface PointerSample {
  x: number;
  y: number;
  time: number;
}

export function isTap(start: PointerSample, end: PointerSample): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return (
    Math.hypot(dx, dy) < TAP_MAX_DISTANCE_PX && end.time - start.time < TAP_MAX_DURATION_MS
  );
}

/**
 * 可変原点スティックの出力（§4.2）。
 * origin から現在位置までのベクトルを radius で正規化し、長さを 1 で頭打ちにする。
 * 返り値の y は「画面下方向が正」ではなく「前進が正」になるよう反転済み。
 */
export function stickVector(
  origin: { x: number; y: number },
  current: { x: number; y: number },
  radius: number,
): { x: number; y: number } {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || radius <= 0) return { x: 0, y: 0 };
  const scale = Math.min(len, radius) / radius / len;
  return { x: dx * scale, y: -dy * scale };
}

/** 微小な指のぶれを切り捨てる */
export function applyDeadzone(v: { x: number; y: number }, deadzone: number): { x: number; y: number } {
  const len = Math.hypot(v.x, v.y);
  if (len <= deadzone) return { x: 0, y: 0 };
  // デッドゾーンの外側を 0..1 に張り直す（境界で飛ばないように）
  const scaled = (len - deadzone) / (1 - deadzone) / len;
  return { x: v.x * scaled, y: v.y * scaled };
}

/** §4.2: スティックを外周まで倒すとダッシュ */
export const DASH_THRESHOLD = 0.9;

export function isDashing(move: { x: number; y: number }): boolean {
  return Math.hypot(move.x, move.y) > DASH_THRESHOLD;
}

/** 画面座標を NDC (-1..1, y は上が正) に変換する */
export function toNdc(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((x - rect.left) / rect.width) * 2 - 1,
    y: -(((y - rect.top) / rect.height) * 2 - 1),
  };
}
