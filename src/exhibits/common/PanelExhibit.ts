import * as THREE from 'three';
import { createCanvasTexture } from './CanvasTexture';

export type PanelDraw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export interface PanelOptions {
  /** 実寸（m） */
  width: number;
  height: number;
  /** テクスチャの横解像度。縦は縦横比から決まる */
  resolution?: number;
  /** 通常状態の絵 */
  drawBase: PanelDraw;
  /** タネあかし状態の絵。省略時は base と同じ */
  drawReveal?: PanelDraw;
  /** 額縁を付けるか */
  frame?: boolean;
  frameColor?: number;
  /** 画素の境界を残す（カフェウォールのように境界そのものが効く展示） */
  nearest?: boolean;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uReveal;
uniform float uMix;
void main() {
  vec4 a = texture2D(uBase, vUv);
  vec4 b = texture2D(uReveal, vUv);
  gl_FragColor = mix(a, b, uMix);
  #include <colorspace_fragment>
}`;

export interface Panel {
  root: THREE.Group;
  mesh: THREE.Mesh;
  /** 0..1 のクロスフェード */
  setProgress(progress: number): void;
  /** 言語切替などで絵を描き直す */
  redraw(drawBase: PanelDraw, drawReveal?: PanelDraw): void;
  dispose(): void;
}

/**
 * 額縁 + テクスチャの共通実装。
 *
 * 通常時とタネあかし時の 2 枚をクロスフェードする方式にしている。
 * 「モルタル線を消す」「周囲の円を消す」「実測ガイドを重ねる」はすべて
 * この 1 つの仕組みで表現でき、毎フレーム Canvas を描き直さずに済む。
 *
 * マテリアルは非ライティング + toneMapped = false。明度・色が錯視の成立条件である
 * 展示（§8 リスク表）で、部屋の照明やトーンマッピングに絵が影響されないようにする。
 */
export function createPanel(options: PanelOptions): Panel {
  const { width, height, frame = true, frameColor = 0x14161b } = options;
  const resolution = options.resolution ?? 1024;
  const texHeight = Math.round((resolution * height) / width);

  const root = new THREE.Group();

  const make = (draw: PanelDraw): THREE.CanvasTexture =>
    createCanvasTexture(
      {
        width: resolution,
        height: texHeight,
        wrap: THREE.ClampToEdgeWrapping,
        ...(options.nearest ? { filter: 'nearest' as const } : {}),
      },
      draw,
    );

  let base = make(options.drawBase);
  let reveal = make(options.drawReveal ?? options.drawBase);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uBase: { value: base },
      uReveal: { value: reveal },
      uMix: { value: 0 },
    },
  });
  // 明度系の錯視を壊さないため、トーンマッピングを通さない
  material.toneMapped = false;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = 'panel';
  root.add(mesh);

  if (frame) {
    const border = 0.07;
    const depth = 0.06;
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: frameColor,
      roughness: 0.55,
      metalness: 0.25,
    });
    const geos: THREE.BufferGeometry[] = [];
    const outerW = width + border * 2;
    const outerH = height + border * 2;
    const push = (w: number, h: number, x: number, y: number): void => {
      const g = new THREE.BoxGeometry(w, h, depth);
      g.translate(x, y, -depth / 2 - 0.001);
      geos.push(g);
    };
    push(outerW, border, 0, height / 2 + border / 2);
    push(outerW, border, 0, -height / 2 - border / 2);
    push(border, height, -width / 2 - border / 2, 0);
    push(border, height, width / 2 + border / 2, 0);
    // 背板（裏から見たときに絵が透けないように）
    const back = new THREE.BoxGeometry(outerW, outerH, 0.02);
    back.translate(0, 0, -depth - 0.01);
    geos.push(back);

    for (const g of geos) {
      const m = new THREE.Mesh(g, frameMaterial);
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }
  }

  return {
    root,
    mesh,
    setProgress(progress) {
      material.uniforms.uMix!.value = progress;
    },
    redraw(drawBase, drawReveal) {
      base.dispose();
      reveal.dispose();
      base = make(drawBase);
      reveal = make(drawReveal ?? drawBase);
      material.uniforms.uBase!.value = base;
      material.uniforms.uReveal!.value = reveal;
    },
    dispose() {
      base.dispose();
      reveal.dispose();
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

/**
 * 壁掛け展示の共通配置ヘルパ。
 * 展示の高さは目線 1.6m を基準に、パネル中心を 1.55m に置く。
 */
export const PANEL_CENTER_HEIGHT = 1.55;

/** 壁から手前へ出す量（額縁の厚み分） */
export const PANEL_WALL_OFFSET = 0.12;
