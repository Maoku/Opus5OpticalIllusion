import * as THREE from 'three';
import type { QualityPreset } from './Quality';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  preset: QualityPreset;
}

/**
 * WebGLRenderer の生成と画質プリセットの適用。
 *
 * トーンマッピングは ACESFilmic を既定にするが、明度系の錯視
 * （チェッカーシャドウ / ホロウマスク / D6）は影響を受けるため、
 * Phase 7 の後処理追加後に必ず再検証する（§8 リスク表）。
 */
export function createRenderer({ canvas, preset }: RendererOptions): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: preset.antialias,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x0b0c10, 1);
  applyQuality(renderer, preset);
  return renderer;
}

/** 実行中の画質変更で呼ぶ。antialias だけは再生成が要るため変えられない。 */
export function applyQuality(renderer: THREE.WebGLRenderer, preset: QualityPreset): void {
  const dpr = Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
  renderer.setPixelRatio(dpr);

  // §4.4 の例外: チェッカーシャドウとホロウマスクは影が錯視の成立条件なので、
  // low プリセットでも影自体は有効なままにする。コストはライトごとの
  // castShadow と影マップ解像度で削る（Lighting 側の責務）。
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type =
    preset.shadowMapSize > 0 ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
  renderer.shadowMap.needsUpdate = true;
}

export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  width: number,
  height: number,
): void {
  renderer.setSize(width, height, false);
  const aspect = width / Math.max(1, height);
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const cam = camera as THREE.PerspectiveCamera;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  } else {
    const cam = camera as THREE.OrthographicCamera;
    const halfH = (cam.top - cam.bottom) / 2;
    cam.left = -halfH * aspect;
    cam.right = halfH * aspect;
    cam.updateProjectionMatrix();
  }
}
