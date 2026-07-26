import { createPanel, type PanelDraw } from './common/PanelExhibit';
import { wallPanel } from './common/placement';
import type { ExhibitDefinition } from './types';

/**
 * 回転する蛇（周辺ドリフト錯視）。
 *
 * 成立条件は「黒 → 濃い色 → 白 → 淡い色」という決まった順序の並び。
 * 明るい部分と暗い部分で信号が届く速さが違い、その時間差が
 * 周辺視野の動き検出器を誤作動させる。
 * 彩度を落とすと（reveal）効果は大きく弱まる。
 */

const BG = '#14151b';
/** 一巡の 4 色。順序が向きを決めるので、入れ替えると回転方向が反転する */
const SEQUENCE = ['#000000', '#2f6cc9', '#ffffff', '#f0c419'];
const GRAY = ['#000000', '#5c5c5c', '#ffffff', '#b4b4b4'];
const RINGS = [0.94, 0.72, 0.5, 0.28];
const SEGMENTS = 36;

function draw(colors: string[]): PanelDraw {
  return (ctx, w, h) => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const unit = Math.min(w, h) / 2;

    for (let r = 0; r < RINGS.length; r++) {
      const outer = unit * RINGS[r]!;
      const inner = outer * 0.72;
      // 隣り合うリングで並びを半区画ずらすと、渦の見え方が強くなる
      const phase = r % 2 === 0 ? 0 : 0.5;
      for (let i = 0; i < SEGMENTS; i++) {
        for (let k = 0; k < 4; k++) {
          const t0 = ((i + (k + phase) / 4) / SEGMENTS) * Math.PI * 2;
          const t1 = ((i + (k + 1 + phase) / 4) / SEGMENTS) * Math.PI * 2;
          ctx.fillStyle = colors[r % 2 === 0 ? k : 3 - k]!;
          ctx.beginPath();
          ctx.arc(cx, cy, outer, t0, t1);
          ctx.arc(cx, cy, inner, t1, t0, true);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // 中心の固視点。じっと見ると動きが止まることを試せるようにする
    ctx.fillStyle = '#f2f0eb';
    ctx.beginPath();
    ctx.arc(cx, cy, unit * 0.035, 0, Math.PI * 2);
    ctx.fill();
  };
}

export const peripheralDrift: ExhibitDefinition = {
  id: 'peripheralDrift',
  textKey: 'peripheralDrift',
  room: 'plane',
  kind: 'object',
  order: 6,
  reveal: 'grayscale',
  ...wallPanel({ x: -18, z: -12.72, rotationY: 0, viewDistance: 3.2, width: 1.5, fov: 52 }),
  build() {
    const panel = createPanel({
      width: 1.5,
      height: 1.5,
      resolution: 1024,
      drawBase: draw(SEQUENCE),
      // タネあかし: 彩度を落とす。順序が保たれていても動きは大きく弱まる
      drawReveal: draw(GRAY),
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
