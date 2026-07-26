import { createPanel, type PanelDraw } from './common/PanelExhibit';
import { wallPanel } from './common/placement';
import type { ExhibitDefinition } from './types';

const BG = '#12131a';
const INK = '#f2f0eb';
const GUIDE = '#4fd6ff';
const LINE_WIDTH = 9;
/** 矢羽根の長さと角度 */
const FIN = 84;
const FIN_ANGLE = Math.PI / 4;

interface Shaft {
  y: number;
  /** 1 で外向き（長く見えるほう）、-1 で内向き */
  direction: 1 | -1;
}

function shafts(h: number): Shaft[] {
  return [
    { y: h * 0.34, direction: 1 },
    { y: h * 0.68, direction: -1 },
  ];
}

function drawShaft(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
}

function drawFins(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: 1 | -1,
  end: 1 | -1,
): void {
  // end = -1 が左端、+1 が右端。direction = 1 で外へ開く
  const sign = direction * end;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sign * FIN * Math.cos(FIN_ANGLE), y + s * FIN * Math.sin(FIN_ANGLE));
    ctx.stroke();
  }
}

const drawBase: PanelDraw = (ctx, w, h) => {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = 'round';

  const x0 = w * 0.24;
  const x1 = w * 0.76;
  for (const shaft of shafts(h)) {
    drawShaft(ctx, x0, x1, shaft.y);
    drawFins(ctx, x0, shaft.y, shaft.direction, -1);
    drawFins(ctx, x1, shaft.y, shaft.direction, 1);
  }
};

/**
 * タネあかし: 矢羽根を消し、両端に垂直の実測ガイドを立てる。
 * 2 本の軸が同じ x 範囲に収まっていることが一目で分かる。
 */
const drawReveal: PanelDraw = (ctx, w, h) => {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = 'round';

  const x0 = w * 0.24;
  const x1 = w * 0.76;
  const list = shafts(h);
  for (const shaft of list) drawShaft(ctx, x0, x1, shaft.y);

  ctx.strokeStyle = GUIDE;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  const top = list[0]!.y - 90;
  const bottom = list[list.length - 1]!.y + 90;
  for (const x of [x0, x1]) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  ctx.setLineDash([]);
};

const PLACEMENT = wallPanel({
  x: -24,
  z: 2.72,
  rotationY: Math.PI,
  viewDistance: 3.0,
  width: 1.9,
  fov: 50,
});

export const muellerLyer: ExhibitDefinition = {
  id: 'muellerLyer',
  textKey: 'muellerLyer',
  room: 'plane',
  kind: 'object',
  order: 2,
  reveal: 'measure',
  ...PLACEMENT,
  build() {
    const panel = createPanel({ width: 1.9, height: 1.15, drawBase, drawReveal });
    return {
      root: panel.root,
      setRevealed(_revealed, progress) {
        panel.setProgress(progress);
      },
      dispose() {
        panel.dispose();
      },
    };
  },
};
