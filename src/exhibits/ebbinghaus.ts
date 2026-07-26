import { createPanel, type PanelDraw } from './common/PanelExhibit';
import { wallPanel } from './common/placement';
import type { ExhibitDefinition } from './types';

const BG = '#13141a';
const CENTER = '#e8944a';
const SURROUND = '#8f97a8';
const CENTER_RADIUS = 52;

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  count: number,
  distance: number,
  radius: number,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    circle(ctx, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, radius, SURROUND);
  }
  ctx.globalAlpha = 1;
}

function draw(surroundAlpha: number): PanelDraw {
  return (ctx, w, h) => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    const y = h / 2;
    const leftX = w * 0.28;
    const rightX = w * 0.72;

    // 左: 大きな円に囲まれた中心円 → 小さく見える
    ring(ctx, leftX, y, 6, 152, 62, surroundAlpha);
    // 右: 小さな円に囲まれた中心円 → 大きく見える
    ring(ctx, rightX, y, 8, 96, 24, surroundAlpha);

    circle(ctx, leftX, y, CENTER_RADIUS, CENTER);
    circle(ctx, rightX, y, CENTER_RADIUS, CENTER);
  };
}

/** タネあかし: 周囲の円を消す。2 つの中心円が同じ大きさだと即座に分かる */
const drawReveal: PanelDraw = (ctx, w, h) => {
  draw(0)(ctx, w, h);
  const y = h / 2;
  ctx.strokeStyle = '#4fd6ff';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 9]);
  for (const y2 of [y - CENTER_RADIUS, y + CENTER_RADIUS]) {
    ctx.beginPath();
    ctx.moveTo(w * 0.14, y2);
    ctx.lineTo(w * 0.86, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
};

export const ebbinghaus: ExhibitDefinition = {
  id: 'ebbinghaus',
  textKey: 'ebbinghaus',
  room: 'plane',
  kind: 'object',
  order: 4,
  reveal: 'fadeContext',
  ...wallPanel({ x: -18, z: 2.72, rotationY: Math.PI, viewDistance: 3.0, fov: 50 }),
  build() {
    const panel = createPanel({ width: 1.9, height: 1.15, drawBase: draw(1), drawReveal });
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
