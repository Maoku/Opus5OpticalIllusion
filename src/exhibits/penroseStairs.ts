import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * ペンローズの階段。
 *
 * 4 つの飛びのうち 3 つは本物の階段で、最後の 1 つだけが嘘をつく。
 *
 *   視点 E から、1 段目の足元 A へ向かうレイを引く。
 *   そのレイ上で「高さ H（4 飛び分の上昇）」になる点を E4 とする。
 *   視点が階段より上にあるので、E4 は A より手前・かつ高い位置になる。
 *   4 つ目の飛びを D から E4 まで架けると、最後の段の上端が
 *   1 段目の足元にぴったり重なって見える。
 *
 * 局所の整合性（どの段も確かに上っている）は保たれたまま、
 * 大域の整合性（一周すると元の高さに戻る）だけが破れる。
 */

const PLAN = 1.0;
const STEPS_PER_FLIGHT = 4;
const RISE = 0.028;
const TREAD_WIDTH = 0.2;
const BASE_HEIGHT = 0.62;
const VIEW_DISTANCE = 3.0;
const POSITION = { x: -5, y: BASE_HEIGHT, z: -2.4 };

type V3 = THREE.Vector3;

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const eyeWorld = ctx.eyes[0] ?? origin.clone().add(new THREE.Vector3(0, 1, VIEW_DISTANCE));
  const eye = eyeWorld.clone().sub(origin);

  const a = PLAN / 2;
  const totalSteps = STEPS_PER_FLIGHT * 4;
  const height = totalSteps * RISE;

  const corners: V3[] = [
    new THREE.Vector3(-a, 0, -a),
    new THREE.Vector3(a, 0, -a),
    new THREE.Vector3(a, 0, a),
    new THREE.Vector3(-a, 0, a),
  ];

  // 嘘をつく飛びの終点。視点 → 1 段目の足元のレイ上で、高さ H になる点
  const start = corners[0]!.clone();
  const t = 1 - height / eye.y;
  const fake = eye.clone().lerp(start, t);

  /** i 番目の段の「足元」の位置 */
  const stepBase = (index: number): V3 => {
    const flight = Math.min(3, Math.floor(index / STEPS_PER_FLIGHT));
    const local = (index - flight * STEPS_PER_FLIGHT) / STEPS_PER_FLIGHT;
    const from = corners[flight]!;
    const to = flight === 3 ? fake : corners[flight + 1]!;
    const p = from.clone().lerp(to, local);
    p.y = index * RISE;
    return p;
  };

  const reference = stepBase(0).distanceTo(eye);
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < totalSteps; i++) {
    const from = stepBase(i);
    const to = stepBase(i + 1);
    const along = to.clone().sub(from);
    along.y = 0;
    const treadDepth = Math.max(0.04, along.length());
    // 見かけの太さを揃える（近い段ほど細く作る）
    const scale = from.distanceTo(eye) / reference;
    const box = new THREE.BoxGeometry(TREAD_WIDTH * scale, RISE * 2.1 * scale, treadDepth);
    const angle = Math.atan2(along.x, along.z);
    box.rotateY(angle);
    box.translate(from.x + along.x / 2, from.y, from.z + along.z / 2);
    geometries.push(box);
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xcac4b6,
    roughness: 0.6,
    metalness: 0.1,
  });
  const stairs = new THREE.Mesh(mergeGeometries(geometries, false)!, material);
  stairs.castShadow = true;
  stairs.receiveShadow = true;
  root.add(stairs);
  for (const g of geometries) g.dispose();

  // 中庭（階段が囲む壁）。奥行きの手がかりを減らし、階段だけを読ませる
  const wellHeight = height + 0.1;
  const well = new THREE.Mesh(
    new THREE.BoxGeometry(PLAN - TREAD_WIDTH, wellHeight, PLAN - TREAD_WIDTH),
    new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95 }),
  );
  well.position.y = wellHeight / 2 - 0.02;
  well.receiveShadow = true;
  root.add(well);

  const plinthHeight = BASE_HEIGHT;
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(PLAN + 0.7, plinthHeight, PLAN + 0.7),
    new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.8 }),
  );
  plinth.position.y = -plinthHeight / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(1.4, 2.6, 1.2)),
    target: origin.clone(),
    color: 0xfff4e6,
    intensity: 20,
    angle: 0.45,
    penumbra: 0.6,
    distance: 10,
    shadow: true,
  });

  return {
    root,
    setRevealed(_revealed, progress) {
      material.emissive.setHex(0x2f6f5c);
      material.emissiveIntensity = progress * 0.4;
    },
    dispose() {
      removeSpot();
      stairs.geometry.dispose();
      material.dispose();
      well.geometry.dispose();
      (well.material as THREE.Material).dispose();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
    },
  };
}

export const penroseStairs: ExhibitDefinition = {
  id: 'penroseStairs',
  textKey: 'penroseStairs',
  room: 'impossible',
  kind: 'object',
  order: 8,
  reveal: 'orbit',
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: BASE_HEIGHT + 0.2,
    fov: 34,
    radius: 1.1,
  }),
  position: POSITION,
  revealFocus: { x: 0, y: 0.2, z: 0 },
  build,
};
