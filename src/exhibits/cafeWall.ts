import { createPanel, type PanelDraw } from './common/PanelExhibit';
import { wallPanel } from './common/placement';
import type { ExhibitDefinition } from './types';

const TILE = 84;
const ROWS = 9;
const MORTAR = 9;
/** 目地の明るさ。中間輝度でないと効果が出ない（これが成立条件） */
const MORTAR_COLOR = '#8a8a8a';
const DARK = '#111114';
const LIGHT = '#f2f0eb';

/**
 * 行ごとの横ずれ。
 * 明暗の周期は 2 タイルなので、半タイル（＝周期の 1/4）ずらしが最も強く傾く。
 * 0 や 1 タイルではずれが周期と揃ってしまい、傾きは生じない。
 */
function offsetFor(row: number): number {
  return row % 2 === 0 ? 0 : TILE * 0.5;
}

function drawTiles(ctx: CanvasRenderingContext2D, w: number, h: number, mortar: boolean): void {
  const rowHeight = h / ROWS;
  ctx.fillStyle = mortar ? MORTAR_COLOR : DARK;
  ctx.fillRect(0, 0, w, h);

  for (let row = 0; row < ROWS; row++) {
    const y = row * rowHeight;
    const inset = mortar ? MORTAR / 2 : 0;
    const offset = offsetFor(row);
    // 端が切れないよう 1 タイル分余分に描く
    for (let i = -1; i * TILE - offset < w + TILE; i++) {
      const x = i * TILE - offset;
      ctx.fillStyle = i % 2 === 0 ? LIGHT : DARK;
      ctx.fillRect(x, y + inset, TILE, rowHeight - inset * 2);
    }
  }
}

const drawBase: PanelDraw = (ctx, w, h) => {
  drawTiles(ctx, w, h, true);
};

/**
 * タネあかし: 目地を消し、行の境界に水平ガイドを重ねて
 * 「どの行も平行である」ことを示す。
 */
const drawReveal: PanelDraw = (ctx, w, h) => {
  drawTiles(ctx, w, h, false);
  const rowHeight = h / ROWS;
  ctx.strokeStyle = '#4fd6ff';
  ctx.lineWidth = 3;
  for (let row = 1; row < ROWS; row++) {
    const y = row * rowHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
};

const PLACEMENT = wallPanel({ x: -30, z: 2.72, rotationY: Math.PI, viewDistance: 3.2, width: 1.9, fov: 50 });

export const cafeWall: ExhibitDefinition = {
  id: 'cafeWall',
  textKey: 'cafeWall',
  room: 'plane',
  kind: 'object',
  order: 1,
  reveal: 'fadeContext',
  ...PLACEMENT,
  build() {
    const panel = createPanel({
      width: 1.9,
      height: 1.15,
      resolution: 1024,
      drawBase,
      drawReveal,
      // 目地とタイルの境界そのものが効くので、補間で滲ませない
      nearest: true,
    });
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
