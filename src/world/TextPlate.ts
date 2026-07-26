import * as THREE from 'three';
import { createCanvasTexture } from '../exhibits/common/CanvasTexture';

/**
 * ワールド内の文字板（キャプションプレート・案内板・部屋名サイン）。
 *
 * §5.3 の方針どおり、フォントは**システムフォント**を Canvas で焼く。
 * 日本語 Web フォントは素で 3〜5MB あり、それ単独で総アセット 5MB の目標を壊す。
 * OS 間でデザインは揺れるが、モバイル回線での転送量のほうが遥かに重い。
 *
 * §5.4: 言語切替時は 3D のテキストも作り直す必要がある。
 * setContent() を呼ぶと古いテクスチャを破棄して描き直す。
 */

export interface TextPlateLine {
  text: string;
  /** 見出しか本文か。行間と字送りが変わる */
  weight?: 'title' | 'body' | 'note';
}

export interface TextPlateOptions {
  /** 実寸（m） */
  width: number;
  height: number;
  /** テクスチャの 1m あたりの画素数 */
  pixelsPerMetre?: number;
  background?: string;
  /** 板そのものを出すか（案内板は板あり、壁貼りは板なし） */
  frame?: boolean;
  align?: 'left' | 'center';
  /**
   * 文字の大きさの倍率。
   * 板の高さに対する比で決めると、細長い部屋名サインと小さなキャプションで
   * 破綻するため、基準はメートル（＝実寸）にしてある。
   */
  scale?: number;
}

export interface TextPlate {
  root: THREE.Group;
  setLines(lines: TextPlateLine[]): void;
  dispose(): void;
}

const COLORS = {
  title: '#f2f0eb',
  body: '#c3c7d0',
  note: '#8fd8bd',
};

/** 基準の字高（m）。実寸で決めるので、板の縦横比が変わっても字の大きさは変わらない */
const FONT_METRES = { title: 0.075, body: 0.046, note: 0.038 };
const LINE_SPACING = { title: 1.3, body: 1.55, note: 1.5 };

const FONT_STACK = 'system-ui, "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif';

/** 幅に収まるよう単語／文字単位で折り返す */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    // 日本語は単語境界が無いので、まず単語で試し、溢れたら 1 文字ずつ詰める
    const words = paragraph.split(/(\s+)/);
    let line = '';
    const push = (): void => {
      if (line) out.push(line);
      line = '';
    };
    for (const word of words) {
      const candidate = line + word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (ctx.measureText(word).width <= maxWidth) {
        push();
        line = word.trimStart();
        continue;
      }
      for (const ch of word) {
        if (ctx.measureText(line + ch).width > maxWidth) push();
        line += ch;
      }
    }
    push();
  }
  return out;
}

export function createTextPlate(options: TextPlateOptions): TextPlate {
  const { width, height, frame = true, align = 'left', scale = 1 } = options;
  const ppm = options.pixelsPerMetre ?? 620;
  const texWidth = Math.round(width * ppm);
  const texHeight = Math.round(height * ppm);
  const background = options.background ?? '#12141a';

  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ transparent: true });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 1;
  root.add(mesh);

  if (frame) {
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.03, height + 0.03, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.7, metalness: 0.2 }),
    );
    backing.position.z = -0.013;
    backing.castShadow = true;
    backing.receiveShadow = true;
    root.add(backing);
  }

  let texture: THREE.CanvasTexture | null = null;

  const setLines = (lines: TextPlateLine[]): void => {
    texture?.dispose();
    texture = createCanvasTexture(
      { width: texWidth, height: texHeight, wrap: THREE.ClampToEdgeWrapping },
      (ctx, w, h) => {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);

        const padding = Math.round(Math.min(w, h) * 0.09);
        const maxWidth = w - padding * 2;
        let y = padding;
        for (const line of lines) {
          const kind = line.weight ?? 'body';
          const size = Math.round(FONT_METRES[kind] * scale * ppm);
          ctx.font = `${kind === 'title' ? '600' : '400'} ${size}px ${FONT_STACK}`;
          ctx.fillStyle = COLORS[kind];
          ctx.textBaseline = 'top';
          ctx.textAlign = align === 'center' ? 'center' : 'left';
          const x = align === 'center' ? w / 2 : padding;
          const lineHeight = Math.round(size * LINE_SPACING[kind]);
          for (const row of wrap(ctx, line.text, maxWidth)) {
            if (y + lineHeight > h - padding * 0.4) return;
            ctx.fillText(row, x, y);
            y += lineHeight;
          }
          y += Math.round(size * 0.4);
        }
      },
    );
    material.map = texture;
    material.needsUpdate = true;
  };

  return {
    root,
    setLines,
    dispose() {
      texture?.dispose();
      texture = null;
      material.dispose();
      mesh.geometry.dispose();
      for (const child of root.children) {
        if (child instanceof THREE.Mesh && child !== mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
    },
  };
}
