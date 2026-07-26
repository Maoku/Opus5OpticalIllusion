import * as THREE from 'three';
import { createCanvasTexture } from './common/CanvasTexture';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';
import type { SpotRequest } from '../world/Lighting';

/**
 * D6「縞の下の嘘」/ Under the Stripes（ROOM_D §1）。
 *
 * ★ 成立条件: **実光源による投影**であること。
 *   2D の Munker 錯視は「そういう画像だから」で片付けられる。
 *   実物体・実光源・自由な視点移動が揃うと逃げ場がなくなり、
 *   「絶対に色が違う」という確信が生まれる。その確信を裏切るのが展示の目的。
 *
 * 6 つの球は **同一の MeshStandardMaterial インスタンスを共有** している。
 * インスタンスを分けないのがミソで、デバッグ中も同一性が保証される。
 */

const COUNT = 6;
const RADIUS = 0.16;
const SPACING = 0.44;
const TOP_HEIGHT = 0.92;
const VIEW_DISTANCE = 3.3;
const POSITION = { x: -7, y: 0, z: -24 };

/** 帯ごとの縞の色。白との細かい交替が同化を起こす */
const STRIPE_COLORS = ['#ff7a2f', '#ff4fa3', '#3ad46a', '#39c9ff', '#ffd23a', '#6a6cff'];

function goboTexture(): THREE.CanvasTexture {
  return createCanvasTexture(
    { width: 1024, height: 1024, wrap: THREE.ClampToEdgeWrapping },
    (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const band = w / COUNT;
      // 縞が細いほど同化が強く、球そのものの色として取り込まれる
      const period = 13;
      for (let i = 0; i < COUNT; i++) {
        ctx.fillStyle = STRIPE_COLORS[i]!;
        for (let x = i * band; x < (i + 1) * band; x += period) {
          ctx.fillRect(x, 0, period / 2, h);
        }
      }
      // 縁を落として、投影の外周が硬く切れないようにする
      const fade = ctx.createRadialGradient(w / 2, h / 2, w * 0.34, w / 2, h / 2, w * 0.5);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = fade;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
  );
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(SPACING * COUNT + 0.3, TOP_HEIGHT - 0.02, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x191b21, roughness: 0.9 }),
  );
  plinth.position.y = (TOP_HEIGHT - 0.02) / 2;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  root.add(plinth);

  // ★ 6 球で 1 つのマテリアルを共有する
  const shared = new THREE.MeshStandardMaterial({
    color: 0xb9b2a6,
    roughness: 0.62,
    metalness: 0.02,
  });
  const geometry = new THREE.SphereGeometry(RADIUS, 32, 24);
  const spheres: THREE.Mesh[] = [];
  const homes: THREE.Vector3[] = [];
  for (let i = 0; i < COUNT; i++) {
    const mesh = new THREE.Mesh(geometry, shared);
    const home = new THREE.Vector3((i - (COUNT - 1) / 2) * SPACING, TOP_HEIGHT + RADIUS, 0);
    mesh.position.copy(home);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    homes.push(home);
    spheres.push(mesh);
    root.add(mesh);
  }

  const gobo = goboTexture();
  const request: SpotRequest = {
    position: origin.clone().add(new THREE.Vector3(0, 3.1, 0.05)),
    target: origin.clone().add(new THREE.Vector3(0, TOP_HEIGHT, 0)),
    color: 0xffffff,
    intensity: 26,
    angle: 0.52,
    penumbra: 0.12,
    distance: 10,
    // 常にプールへ割り当てさせる。外れるたびに map の付け外しが起きると
    // シェーダが再コンパイルされてカクつく
    critical: true,
    shadow: true,
    map: gobo,
  };
  const removeSpot = ctx.lighting.addSpot(request);

  const baseIntensity = request.intensity;
  return {
    root,
    setRevealed(_revealed, progress) {
      // 前半: 縞の光を落とす / 後半: 縞なしの白色光で戻す
      if (progress < 0.5) {
        request.map = gobo;
        request.intensity = baseIntensity * (1 - progress * 2);
      } else {
        request.map = null;
        request.intensity = baseIntensity * (progress - 0.5) * 2;
      }
      // さらに 6 球を中央へ寄せ、隣り合わせで見比べられるようにする
      const gather = Math.max(0, (progress - 0.6) / 0.4);
      for (let i = 0; i < spheres.length; i++) {
        const home = homes[i]!;
        const target = new THREE.Vector3((i - (COUNT - 1) / 2) * RADIUS * 2.02, home.y, home.z);
        spheres[i]!.position.lerpVectors(home, target, gather);
      }
    },
    dispose() {
      removeSpot();
      gobo.dispose();
      geometry.dispose();
      shared.dispose();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
    },
  };
}

export const underTheStripes: ExhibitDefinition = {
  id: 'underTheStripes',
  textKey: 'underTheStripes',
  room: 'opus',
  kind: 'object',
  order: 20,
  reveal: 'fadeContext',
  // §4.5: 端末の色再現・自動輝度調整に左右されるため、キャプションで注意を促す
  noticeTextKey: 'brightnessNotice',
  brightnessCritical: true,
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: TOP_HEIGHT + RADIUS,
    // 横長の台（球が並ぶ）。奥行きは 0.6m しかない
    halfX: (SPACING * COUNT + 0.3) / 2,
    halfZ: 0.3,
    fov: 46,
    radius: 1.1,
  }),
  position: POSITION,
  build,
};
