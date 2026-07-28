/**
 * 文字を点群にする（ROOM_D §2.4 の `GlyphSampler`）。
 *
 * D1「二つの真実」は、同じ断片群が視点 A で「真」、視点 B で「偽」を結ぶ。
 * その第一歩が「字を N 個の点に落とす」こと。
 *
 * ここは **locale 非依存**である（§5.4 の確定方針: 字は日本語のまま固定）。
 * それでも任意の文字列を受け取る汎用実装にしてあるのは、調整段階で字を
 * 差し替えて画数と点数の釣り合いを試せるようにするため。
 *
 * ラスタライズだけが DOM（Canvas 2D）を必要とする。サンプリングは純粋関数に
 * 切り出してあり、テストは合成マスクで検証できる。
 */

/** 文字を焼いたグレースケール。data[y * width + x] が 0..255 のカバレッジ */
export interface GlyphMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 字の外接枠を [-0.5, 0.5]² に正規化した点。y は上が正 */
export interface GlyphPoint {
  x: number;
  y: number;
}

/**
 * §5.3 と同じ判断でシステムフォントを使う。日本語 Web フォントは素で 3〜5MB あり、
 * 2 文字のために積む重さではない。字形は OS 間で揺れるが、断片配置は初期化時に
 * 解くので、揺れたらそのぶん違う雲になるだけで破綻はしない。
 */
const FONT_STACK = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';

/** 文字を正方のマスクへ焼く。Canvas 2D が要るのでブラウザ専用 */
export function rasteriseGlyph(text: string, size = 256, fontStack = FONT_STACK): GlyphMask {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  // 字面の外周に余白を残す。枠いっぱいだと外接枠の正規化で字が痩せて見える
  ctx.font = `${Math.round(size * 0.82)}px ${fontStack}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2);

  const image = ctx.getImageData(0, 0, size, size);
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i++) data[i] = image.data[i * 4]!;
  return { width: size, height: size, data };
}

export interface SampleOptions {
  /** 格子の間隔（画素）。複数の字で揃えると、両者の点が同じ高さに並ぶ */
  spacing: number;
  /** セルの平均カバレッジがこれ以上なら点を置く（0..1） */
  threshold?: number;
  /** 横方向のゆらぎ。間隔に対する比。0 で完全な格子 */
  jitter?: number;
}

/**
 * マスクを格子で走査して点を拾う。
 *
 * **行の高さを揃えることが要点**。ブルーノイズのほうが見た目は自然だが、
 * 2 つの字の点を 1 対 1 に対応させる段（`solveDualView`）で効いてくるのは
 * 「同じ高さに点があること」のほうである。視点 A・B の目線が同じ高さなら、
 * 高さの揃った点どうしのレイはほぼ交差する。ここで揃えておくと、
 * 断片が理想位置からほとんどずれない。
 */
export function sampleGlyph(mask: GlyphMask, options: SampleOptions): GlyphPoint[] {
  const spacing = Math.max(1, options.spacing);
  const threshold = (options.threshold ?? 0.5) * 255;
  const jitter = options.jitter ?? 0.16;
  const points: GlyphPoint[] = [];

  const rows = Math.floor(mask.height / spacing);
  const columns = Math.floor(mask.width / spacing);
  // 端数は上下・左右へ均等に割り振り、字を枠の中央に置いたまま走査する
  const originY = (mask.height - rows * spacing) / 2;
  const originX = (mask.width - columns * spacing) / 2;

  for (let row = 0; row < rows; row++) {
    const cy = originY + (row + 0.5) * spacing;
    for (let column = 0; column < columns; column++) {
      const offset = jitter === 0 ? 0 : (hash01(row * 131 + column * 17) - 0.5) * 2 * jitter;
      const cx = originX + (column + 0.5 + offset) * spacing;
      if (cellCoverage(mask, cx, cy, spacing) < threshold) continue;
      points.push({
        x: cx / mask.width - 0.5,
        // 画像は下向きが +y。ワールドは上向きが +y
        y: 0.5 - cy / mask.height,
      });
    }
  }
  return points;
}

/**
 * 目標点数から格子の間隔（画素）を決める。
 *
 * 「字の面積の平均 ÷ 目標点数」なので、画数の近い字どうしなら点数も揃う
 * （「真」10画・「偽」11画はこの条件を満たす）。
 *
 * 呼び出し側にも公開してあるのは、**断片の大きさと間引きの閾値を
 * この値から導かせる**ため。字や点数を変えたときに、片方だけ古い前提のまま
 * 取り残されると、断片が重なって字が潰れる。
 */
export function glyphSpacing(
  masks: readonly GlyphMask[],
  targetCount: number,
  threshold = 0.5,
): number {
  if (masks.length === 0) return 1;
  let area = 0;
  for (const mask of masks) area += filledArea(mask, threshold * 255);
  const mean = area / masks.length;
  return Math.max(2, Math.sqrt(mean / Math.max(1, targetCount)));
}

/** 複数の字を **同じ間隔**でサンプリングする（行の高さが揃う） */
export function sampleGlyphs(
  masks: readonly GlyphMask[],
  targetCount: number,
  options: Omit<SampleOptions, 'spacing'> = {},
): GlyphPoint[][] {
  if (masks.length === 0) return [];
  const spacing = glyphSpacing(masks, targetCount, options.threshold ?? 0.5);
  return masks.map((mask) => sampleGlyph(mask, { ...options, spacing }));
}

/** しきい値を超えた画素の数 */
export function filledArea(mask: GlyphMask, threshold = 127): number {
  let count = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]! > threshold) count++;
  }
  return count;
}

// ------------------------------------------------------------------ internals

/** (cx, cy) を中心とする一辺 size のセルの平均カバレッジ */
function cellCoverage(mask: GlyphMask, cx: number, cy: number, size: number): number {
  const half = size / 2;
  const x0 = Math.max(0, Math.floor(cx - half));
  const x1 = Math.min(mask.width - 1, Math.ceil(cx + half));
  const y0 = Math.max(0, Math.floor(cy - half));
  const y1 = Math.min(mask.height - 1, Math.ceil(cy + half));
  if (x1 < x0 || y1 < y0) return 0;
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * mask.width;
    for (let x = x0; x <= x1; x++) {
      sum += mask.data[row + x]!;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** 決定的な 0..1。毎回同じ雲になってほしいので Math.random は使わない */
function hash01(n: number): number {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 0xffffffff;
}
