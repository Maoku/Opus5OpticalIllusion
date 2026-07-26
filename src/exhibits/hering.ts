import { createPanel, type PanelDraw } from './common/PanelExhibit';
import { wallPanel } from './common/placement';
import type { ExhibitDefinition } from './types';

const BG = '#12131a';
const RAY = '#6a7285';
const LINE = '#f2f0eb';
const RAY_COUNT = 40;

function draw(rayAlpha: number, guide: boolean): PanelDraw {
  return (ctx, w, h) => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    // 放射線。これが「奥へ収束する空間」の手がかりになる
    if (rayAlpha > 0) {
      ctx.globalAlpha = rayAlpha;
      ctx.strokeStyle = RAY;
      ctx.lineWidth = 2.5;
      const reach = Math.hypot(w, h);
      for (let i = 0; i < RAY_COUNT; i++) {
        const angle = (i / RAY_COUNT) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 平行な 2 本の直線
    ctx.strokeStyle = guide ? '#4fd6ff' : LINE;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    for (const x of [w * 0.36, w * 0.64]) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.1);
      ctx.lineTo(x, h * 0.9);
      ctx.stroke();
    }
  };
}

export const hering: ExhibitDefinition = {
  id: 'hering',
  textKey: 'hering',
  room: 'plane',
  kind: 'object',
  order: 5,
  reveal: 'fadeContext',
  ...wallPanel({ x: -30, z: -12.72, rotationY: 0, viewDistance: 3.0, fov: 50 }),
  build() {
    const panel = createPanel({
      width: 1.55,
      height: 1.35,
      drawBase: draw(1, false),
      // タネあかし: 放射線を消す。直線が真っ直ぐに戻る
      drawReveal: draw(0, true),
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
