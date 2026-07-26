import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCanvasTexture } from './common/CanvasTexture';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * チェッカーシャドウ錯視（Adelson, 1995）—— 実物 3D + 実際の影。
 *
 * ★ 錯視の成立条件:
 *   影の中の明るいマス B と、影の外の暗いマス A が、
 *   画面上で同じ明るさに描かれること。
 *
 * 反射率は違ってよい（むしろ違うのが本質）。等しくすべきは「描かれた値」である。
 *   A の輝度 = albedoDark  * (環境光 + 直接光)
 *   B の輝度 = albedoLight * (環境光)
 * が一致するよう albedoDark を決める。ratio は実測して校正した値（下記 CALIBRATION）。
 *
 * §4.4 の例外扱い: この展示の影は「削ってよい描画」ではないので、
 * low プリセットでも専用ライトと影を維持する（critical: true）。
 */

const TILE = 0.3;
const GRID = 8;
const BOARD = TILE * GRID;
const BOARD_TOP = 0.78;

const LIGHT_ALBEDO = 0.42;
/**
 * 影の中に入ったときの照度の比（実測値）。
 * albedoDark = LIGHT_ALBEDO * ratio とすると、A と B が同じ輝度で描かれる。
 *
 * 校正時の実測（high プリセット / gallery の環境光 / ACES トーンマッピング）:
 *   影の外の明タイル 232 / A（影の外の暗タイル）163 / B（影の中の明タイル）163 /
 *   影の中の暗タイル 60 —— A と B が 1 階調以内で一致している
 * 後処理を追加したら必ず再校正すること（§8 リスク表「明度系錯視が後処理で壊れる」）。
 */
const CALIBRATION = 0.185;
const DARK_ALBEDO = LIGHT_ALBEDO * CALIBRATION;

/** 影の外の暗いマス */
const TILE_A = { col: 3, row: 4 };
/** 影の中の明るいマス */
const TILE_B = { col: 2, row: 2 };

function tileCenter(col: number, row: number): THREE.Vector3 {
  return new THREE.Vector3((col - (GRID - 1) / 2) * TILE, BOARD_TOP, (row - (GRID - 1) / 2) * TILE);
}

function isLightTile(col: number, row: number): boolean {
  return (col + row) % 2 === 0;
}

/**
 * A / B のラベルはタイルの上に「寝かせて」置く。
 * 空中に浮かせると遠近で 1 マスずれた位置に見え、どのマスの話か分からなくなる。
 */
function labelTexture(letter: string): THREE.CanvasTexture {
  return createCanvasTexture({ width: 128, height: 128 }, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = `bold ${Math.round(h * 0.72)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(10,12,18,0.85)';
    ctx.strokeText(letter, w / 2, h / 2);
    ctx.fillStyle = '#ff5c3d';
    ctx.fillText(letter, w / 2, h / 2);
  });
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = ctx.definition.position;

  // --- 台 -----------------------------------------------------------------
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD + 0.16, BOARD_TOP - 0.04, BOARD + 0.16),
    new THREE.MeshStandardMaterial({ color: 0x1d1f26, roughness: 0.8 }),
  );
  plinth.position.y = (BOARD_TOP - 0.04) / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  // --- 市松板 -------------------------------------------------------------
  const lightGeos: THREE.BufferGeometry[] = [];
  const darkGeos: THREE.BufferGeometry[] = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const g = new THREE.BoxGeometry(TILE, 0.04, TILE);
      const c = tileCenter(col, row);
      g.translate(c.x, BOARD_TOP - 0.02, c.z);
      (isLightTile(col, row) ? lightGeos : darkGeos).push(g);
    }
  }
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(LIGHT_ALBEDO, LIGHT_ALBEDO, LIGHT_ALBEDO),
    roughness: 1,
    metalness: 0,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(DARK_ALBEDO, DARK_ALBEDO, DARK_ALBEDO),
    roughness: 1,
    metalness: 0,
  });
  const lightTiles = new THREE.Mesh(mergeGeometries(lightGeos, false)!, lightMaterial);
  const darkTiles = new THREE.Mesh(mergeGeometries(darkGeos, false)!, darkMaterial);
  for (const mesh of [lightTiles, darkTiles]) {
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  for (const g of [...lightGeos, ...darkGeos]) g.dispose();

  // --- 影を落とす円柱 -----------------------------------------------------
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.92, 40),
    new THREE.MeshStandardMaterial({ color: 0x5c7a52, roughness: 0.7 }),
  );
  cylinder.position.set(BOARD / 2 - 0.25, BOARD_TOP + 0.46, -TILE * 1.5);
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  root.add(cylinder);

  // --- A / B のラベル -----------------------------------------------------
  const labels: THREE.Mesh[] = [];
  const labelTextures: THREE.Texture[] = [];
  for (const [letter, tile] of [
    ['A', TILE_A],
    ['B', TILE_B],
  ] as const) {
    const texture = labelTexture(letter);
    labelTextures.push(texture);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    material.toneMapped = false;
    const geometry = new THREE.PlaneGeometry(TILE * 0.55, TILE * 0.55);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    const c = tileCenter(tile.col, tile.row);
    mesh.position.set(c.x, BOARD_TOP + 0.004, c.z);
    mesh.renderOrder = 3;
    labels.push(mesh);
    root.add(mesh);
  }

  // --- タネあかし: A と B を同輝度の帯でつなぐ -----------------------------
  const a = tileCenter(TILE_A.col, TILE_A.row);
  const b = tileCenter(TILE_B.col, TILE_B.row);
  const stripLength = a.distanceTo(b) + TILE * 0.9;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(stripLength, TILE * 0.44),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(DARK_ALBEDO, DARK_ALBEDO, DARK_ALBEDO),
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0,
    }),
  );
  strip.geometry.rotateX(-Math.PI / 2);
  strip.position.set((a.x + b.x) / 2, BOARD_TOP + 0.006, (a.z + b.z) / 2);
  strip.rotation.y = Math.atan2(a.x - b.x, a.z - b.z) + Math.PI / 2;
  // 帯は影を受けない。全長にわたって「A と同じ照度」で描かれることが要点。
  strip.receiveShadow = false;
  strip.castShadow = false;
  strip.visible = false;
  root.add(strip);

  // --- 専用ライト（錯視の成立条件） ---------------------------------------
  // decay = 0 で距離減衰を切り、板の上の照度を一様にする。
  // これがないと帯の左右で明るさが変わり、A と B の一致が崩れる。
  const removeSpot = ctx.lighting.addSpot({
    // 仰角およそ 30°。影が板の大半を横切る長さになる
    position: new THREE.Vector3(origin.x + 5.0, BOARD_TOP + 2.9, origin.z - TILE * 1.5),
    target: new THREE.Vector3(origin.x, BOARD_TOP, origin.z - TILE * 1.5),
    color: 0xfff3e0,
    intensity: 14,
    // 板の外へ光が漏れて背後の壁が光るのを避けるため、円錐は絞る
    angle: 0.38,
    penumbra: 0.1,
    distance: 0,
    decay: 0,
    critical: true,
    shadow: true,
  });

  return {
    root,
    setRevealed(_revealed, progress) {
      strip.visible = progress > 0.001;
      (strip.material as THREE.MeshStandardMaterial).opacity = progress;
      for (const label of labels) {
        (label.material as THREE.MeshBasicMaterial).opacity = 1 - progress * 0.6;
      }
    },
    dispose() {
      removeSpot();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
      lightTiles.geometry.dispose();
      darkTiles.geometry.dispose();
      lightMaterial.dispose();
      darkMaterial.dispose();
      cylinder.geometry.dispose();
      (cylinder.material as THREE.Material).dispose();
      strip.geometry.dispose();
      (strip.material as THREE.Material).dispose();
      for (const label of labels) {
        label.geometry.dispose();
        (label.material as THREE.Material).dispose();
      }
      for (const texture of labelTextures) texture.dispose();
    },
  };
}

export const checkerShadow: ExhibitDefinition = {
  id: 'checkerShadow',
  textKey: 'checkerShadow',
  room: 'plane',
  kind: 'object',
  order: 3,
  reveal: 'strip',
  brightnessCritical: true,
  ...pedestal({
    x: -24,
    z: -7,
    dirY: 0,
    viewDistance: 3.1,
    targetHeight: BOARD_TOP + 0.05,
    // 台は盤面 (BOARD) より一回り大きい箱
    halfX: (BOARD + 0.16) / 2,
    fov: 42,
    radius: 1.1,
  }),
  build,
};
