import * as THREE from 'three';
import { createCanvasTexture } from './common/CanvasTexture';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * くぼんだ顔（ホロウマスク錯視）。
 *
 * ★ 錯視の成立条件: **凹面であること**と**単一方向の照明**。
 * §4.4 の例外扱いで、low プリセットでも専用ライトと影を維持する。
 *
 * 顔の形状は手続き的に生成している。CC0 のスキャンモデルを調達できない場合の
 * 代替として §8 のリスク表が挙げている「簡易なレリーフ状の顔を自前生成」に相当する。
 * 外部アセットに依存しないぶん、ライセンス表記も不要になる。
 */

const WIDTH = 0.52;
const HEIGHT = 0.74;
const SEGMENTS = 72;
const RELIEF = 0.26;
const CENTER_HEIGHT = 1.45;
const VIEW_DISTANCE = 2.6;
const POSITION = { x: 20.5, y: CENTER_HEIGHT, z: -12.0 };

function gaussian(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy));
}

/** 凸の顔レリーフの高さ。u, v は -1..1 */
function faceRelief(u: number, v: number): number {
  const outside = u * u + (v * 0.82) ** 2;
  if (outside > 1) return 0;
  // 頭部の球面
  let h = Math.sqrt(Math.max(0, 1 - outside)) * 0.62;
  // 眉の隆起
  h += gaussian(u, v, 0, 0.3, 0.5, 0.09) * 0.16;
  // 鼻筋
  h += gaussian(u, v, 0, 0.02, 0.1, 0.3) * 0.34;
  // 鼻先
  h += gaussian(u, v, 0, -0.16, 0.11, 0.09) * 0.16;
  // 眼窩のくぼみ
  h -= gaussian(u, v, -0.34, 0.16, 0.19, 0.11) * 0.2;
  h -= gaussian(u, v, 0.34, 0.16, 0.19, 0.11) * 0.2;
  // 頬
  h += gaussian(u, v, -0.46, -0.1, 0.26, 0.22) * 0.1;
  h += gaussian(u, v, 0.46, -0.1, 0.26, 0.22) * 0.1;
  // 口元と顎
  h += gaussian(u, v, 0, -0.42, 0.22, 0.07) * 0.1;
  h -= gaussian(u, v, 0, -0.52, 0.24, 0.05) * 0.06;
  h += gaussian(u, v, 0, -0.68, 0.24, 0.12) * 0.08;
  // 縁をなだらかに落とす
  return h * Math.max(0, 1 - outside ** 4);
}

function buildMaskGeometry(concave: boolean): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT, SEGMENTS, SEGMENTS);
  const position = geometry.getAttribute('position');
  const sign = concave ? -1 : 1;
  for (let i = 0; i < position.count; i++) {
    const u = (position.getX(i) / WIDTH) * 2;
    const v = (position.getY(i) / HEIGHT) * 2;
    position.setZ(i, sign * faceRelief(u, v) * RELIEF);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);

  // 板の四隅を隠す楕円のアルファマスク。矩形の縁が見えると「面に描いた絵」に見える
  const alphaMap = createCanvasTexture(
    { width: 256, height: 256, colorSpace: THREE.NoColorSpace, wrap: THREE.ClampToEdgeWrapping },
    (c, w, h) => {
      c.fillStyle = '#000000';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(w / 2, h / 2, w * 0.49, h * 0.49, 0, 0, Math.PI * 2);
      c.fill();
    },
  );
  const material = new THREE.MeshStandardMaterial({
    color: 0xd9cdbc,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaMap,
    transparent: true,
    alphaTest: 0.5,
  });
  const geometry = buildMaskGeometry(true);
  const mask = new THREE.Mesh(geometry, material);
  mask.castShadow = true;
  mask.receiveShadow = true;
  pivot.add(mask);

  const plinthHeight = CENTER_HEIGHT - 0.5;
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, plinthHeight, 24),
    new THREE.MeshStandardMaterial({ color: 0x1e2027, roughness: 0.85 }),
  );
  plinth.position.y = -CENTER_HEIGHT + plinthHeight / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  // 上方からの単一方向光。これが錯視の成立条件（§4.4 の critical 扱い）
  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(0.15, 2.2, 1.6)),
    target: origin.clone(),
    color: 0xfff0dd,
    intensity: 22,
    angle: 0.36,
    penumbra: 0.5,
    distance: 9,
    critical: true,
    shadow: true,
  });

  let elapsed = 0;
  let progress = 0;
  return {
    root,
    update(dt) {
      elapsed += dt;
      // ゆっくり首を振る。凹面だと「こちらを追いかけてくる」ように見える
      const sweep = Math.sin(elapsed * 0.42) * 0.55;
      pivot.rotation.y = sweep * (1 + progress);
    },
    setRevealed(_revealed, p) {
      progress = p;
      // タネあかし: 振り幅を広げ、真横まで回して凹んでいることを見せる
      material.emissive.setHex(0x101418);
      material.emissiveIntensity = p * 0.25;
    },
    dispose() {
      removeSpot();
      geometry.dispose();
      material.dispose();
      alphaMap.dispose();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
    },
  };
}

export const hollowMask: ExhibitDefinition = {
  id: 'hollowMask',
  textKey: 'hollowMask',
  room: 'space',
  kind: 'object',
  order: 13,
  reveal: 'orbit',
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: CENTER_HEIGHT,
    fov: 34,
    radius: 1.0,
    eyeHeight: CENTER_HEIGHT,
  }),
  position: POSITION,
  build,
};
