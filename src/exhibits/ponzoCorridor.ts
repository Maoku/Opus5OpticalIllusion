import * as THREE from 'three';
import { createCanvasTexture } from './common/CanvasTexture';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * ポンゾ錯視の廊下。
 *
 * 2 本の棒は「目に映る大きさ」がまったく同じになるよう、
 * 距離に比例した長さで作ってある（奥の棒のほうが物理的には長い）。
 * それでも奥の棒のほうが長く見える。大きさの恒常性——
 * 「遠くにあるのに同じ大きさに写るなら、実際は大きいはずだ」という補正が、
 * ここでは裏目に出る。
 */

const EYE_HEIGHT = 1.6;
const NEAR_Z = -2.6;
const FAR_Z = -7.4;
const NEAR_LENGTH = 0.6;
const POSITION = { x: 24, y: 0, z: -1.0 };

function stripeTexture(): THREE.CanvasTexture {
  return createCanvasTexture({ width: 256, height: 256 }, (ctx, w, h) => {
    ctx.fillStyle = '#3a3833';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#524f47';
    for (let i = 0; i < 8; i += 2) ctx.fillRect(0, (i / 8) * h, w, h / 8);
  });
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const eye = new THREE.Vector3(0, EYE_HEIGHT, 0);

  // --- 収束する廊下 -------------------------------------------------------
  const floorMap = stripeTexture();
  floorMap.wrapS = THREE.RepeatWrapping;
  floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set(1, 6);
  const corridorMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9b3a6,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.95 });

  const width0 = 2.6;
  const width1 = 1.0;
  const height0 = 2.6;
  const height1 = 1.5;
  const zStart = -1.2;
  const zEnd = -9.0;

  const floorGeometry = new THREE.BufferGeometry();
  const fp = [
    -width0 / 2, 0.01, zStart,
    width0 / 2, 0.01, zStart,
    width1 / 2, 0.01, zEnd,
    -width1 / 2, 0.01, zEnd,
  ];
  floorGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [fp[0]!, fp[1]!, fp[2]!, fp[3]!, fp[4]!, fp[5]!, fp[6]!, fp[7]!, fp[8]!,
       fp[0]!, fp[1]!, fp[2]!, fp[6]!, fp[7]!, fp[8]!, fp[9]!, fp[10]!, fp[11]!],
      3,
    ),
  );
  floorGeometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2),
  );
  floorGeometry.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.receiveShadow = true;
  root.add(floor);

  const walls: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const geometry = new THREE.BufferGeometry();
    const a = new THREE.Vector3((side * width0) / 2, 0, zStart);
    const b = new THREE.Vector3((side * width1) / 2, 0, zEnd);
    const c = new THREE.Vector3((side * width1) / 2, height1, zEnd);
    const d = new THREE.Vector3((side * width0) / 2, height0, zStart);
    const pts = [a, b, c, a, c, d];
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3),
    );
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, corridorMaterial);
    mesh.receiveShadow = true;
    walls.push(mesh);
    root.add(mesh);
  }

  // --- 同じ「見かけの長さ」の棒 2 本 --------------------------------------
  const barMaterial = new THREE.MeshStandardMaterial({ color: 0xe86a3c, roughness: 0.5 });
  const nearDistance = eye.distanceTo(new THREE.Vector3(0, 0.02, NEAR_Z));
  const farDistance = eye.distanceTo(new THREE.Vector3(0, 0.02, FAR_Z));
  const farLength = (NEAR_LENGTH * farDistance) / nearDistance;

  const bars: THREE.Mesh[] = [];
  for (const [z, length] of [
    [NEAR_Z, NEAR_LENGTH],
    [FAR_Z, farLength],
  ] as const) {
    const thickness = 0.05 * (length / NEAR_LENGTH);
    const geometry = new THREE.BoxGeometry(length, thickness, thickness);
    const mesh = new THREE.Mesh(geometry, barMaterial);
    mesh.position.set(0, 0.06 * (length / NEAR_LENGTH), z);
    mesh.castShadow = true;
    bars.push(mesh);
    root.add(mesh);
  }

  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(0, 3.2, -3.0)),
    target: origin.clone().add(new THREE.Vector3(0, 0.4, -5.5)),
    color: 0xfff3e2,
    intensity: 30,
    angle: 0.55,
    penumbra: 0.7,
    distance: 14,
  });

  const nearBase = bars[0]!.position.clone();
  const farBase = bars[1]!.position.clone();
  const nearScale = bars[0]!.scale.clone();

  return {
    root,
    setRevealed(_revealed, progress) {
      // タネあかし: 奥の棒を手前の棒の隣へ運んでくる。
      // 距離ぶんの縮尺も戻すので、目に映る長さが同じだったことが分かる
      const target = nearBase.clone().add(new THREE.Vector3(0, 0.34, 0));
      bars[1]!.position.lerpVectors(farBase, target, progress);
      const scale = THREE.MathUtils.lerp(1, nearDistance / farDistance, progress);
      bars[1]!.scale.set(scale, scale, scale);
      bars[0]!.scale.copy(nearScale);
    },
    dispose() {
      removeSpot();
      floor.geometry.dispose();
      floorMaterial.dispose();
      floorMap.dispose();
      for (const wall of walls) wall.geometry.dispose();
      corridorMaterial.dispose();
      for (const bar of bars) bar.geometry.dispose();
      barMaterial.dispose();
    },
  };
}

export const ponzoCorridor: ExhibitDefinition = {
  id: 'ponzoCorridor',
  textKey: 'ponzoCorridor',
  room: 'space',
  kind: 'object',
  order: 14,
  reveal: 'measure',
  position: POSITION,
  rotationY: 0,
  revealFocus: { x: 0, y: 0.4, z: -3.0 },
  viewSpots: [
    {
      standAt: { x: POSITION.x, y: 0, z: POSITION.z },
      eye: { x: POSITION.x, y: EYE_HEIGHT, z: POSITION.z },
      lookAt: { x: POSITION.x, y: 0.5, z: POSITION.z - 5 },
      fov: 55,
      radius: 1.0,
    },
  ],
  build,
};
