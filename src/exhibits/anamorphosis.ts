import * as THREE from 'three';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * アナモルフォーシス（床の歪んだ絵）。
 *
 * 「宙に浮いた立方体」を理想の形として決め、その各面の頂点を
 * 視点から床へ投影する。床に残るのは意味をなさない歪んだ多角形だが、
 * 正解の視点からは立方体としてぴったり組み上がる。
 *
 * 面の描画順は理想空間での奥行き順（画家のアルゴリズム）。
 * 床に寝ている面同士は深度で解決できないため、renderOrder で明示する。
 */

const EYE_HEIGHT = 1.6;
/** 展示の原点＝立つ場所。絵はそこから前方に伸びる */
const POSITION = { x: 0, y: 0, z: -2.0 };
/**
 * 浮かんで見せたい立方体の中心（展示ローカル）。
 *
 * 目より高い点は床へ投影できない（レイが上を向いて床と交わらない）。
 * 地平線に近いほど絵は際限なく長く伸びるので、理想の物体は
 * 「低く・近く」に置く必要がある。ここでは 1.5m 先・高さ 0.42m。
 */
const IDEAL_CENTER = new THREE.Vector3(0, 0.42, -1.5);
const IDEAL_SIZE = 0.72;

const FACES: Array<{ normal: THREE.Vector3; color: number }> = [
  { normal: new THREE.Vector3(0, 1, 0), color: 0xe8d9b8 },
  { normal: new THREE.Vector3(0, -1, 0), color: 0x6e6252 },
  { normal: new THREE.Vector3(1, 0, 0), color: 0xc39a6b },
  { normal: new THREE.Vector3(-1, 0, 0), color: 0x8a6f4e },
  { normal: new THREE.Vector3(0, 0, 1), color: 0xd6b78a },
  { normal: new THREE.Vector3(0, 0, -1), color: 0x7d6547 },
];

/** 立方体の 1 面の四隅（周回順） */
function faceCorners(normal: THREE.Vector3, half: number): THREE.Vector3[] {
  const n = normal.clone();
  const u = Math.abs(n.y) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3().crossVectors(n, u).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const centre = n.clone().multiplyScalar(half);
  return [
    centre.clone().addScaledVector(t1, -half).addScaledVector(t2, -half),
    centre.clone().addScaledVector(t1, half).addScaledVector(t2, -half),
    centre.clone().addScaledVector(t1, half).addScaledVector(t2, half),
    centre.clone().addScaledVector(t1, -half).addScaledVector(t2, half),
  ];
}

/** 視点から点を床（y = floorY）へ投影する */
function toFloor(eye: THREE.Vector3, point: THREE.Vector3, floorY: number): THREE.Vector3 {
  const dir = point.clone().sub(eye);
  if (Math.abs(dir.y) < 1e-6) return point.clone();
  const t = (floorY - eye.y) / dir.y;
  return eye.clone().addScaledVector(dir, t);
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const eye = (ctx.eyes[0] ?? origin.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0)))
    .clone()
    .sub(origin);

  const meshes: THREE.Mesh[] = [];
  const half = IDEAL_SIZE / 2;
  const painted: Array<{ mesh: THREE.Mesh; depth: number }> = [];

  for (const face of FACES) {
    const cornersLocal = faceCorners(face.normal, half).map((c) => c.add(IDEAL_CENTER));
    // 視点から見て裏を向く面は描かない
    const toEye = eye.clone().sub(IDEAL_CENTER).normalize();
    if (face.normal.dot(toEye) <= 0.02) continue;

    const projected = cornersLocal.map((c) => toFloor(eye, c, 0.012));
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    for (const [i, j, k] of [
      [0, 1, 2],
      [0, 2, 3],
    ] as const) {
      for (const index of [i, j, k]) {
        const p = projected[index]!;
        positions.push(p.x, p.y, p.z);
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: face.color,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.toneMapped = false;
    const mesh = new THREE.Mesh(geometry, material);
    const centre = cornersLocal
      .reduce((acc, c) => acc.add(c), new THREE.Vector3())
      .multiplyScalar(0.25);
    painted.push({ mesh, depth: centre.distanceTo(eye) });
    meshes.push(mesh);
  }

  // 画家のアルゴリズム: 理想空間で遠い面から描く
  painted.sort((a, b) => b.depth - a.depth);
  painted.forEach((entry, index) => {
    entry.mesh.renderOrder = 10 + index;
    root.add(entry.mesh);
  });

  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(0, 4.0, -0.4)),
    target: origin.clone().add(new THREE.Vector3(0, 0, -2.2)),
    color: 0xffffff,
    intensity: 24,
    angle: 0.5,
    penumbra: 0.7,
    distance: 12,
  });

  return {
    root,
    setRevealed(_revealed, progress) {
      // 真上からの視点（ExhibitManager が担当）で、床の歪んだ実体を見せる。
      // 同時に彩度を落として「絵にすぎない」ことを強調する
      for (const mesh of meshes) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 1 - progress * 0.25;
        material.transparent = progress > 0.001;
      }
    },
    dispose() {
      removeSpot();
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}

export const anamorphosis: ExhibitDefinition = {
  id: 'anamorphosis',
  textKey: 'anamorphosis',
  room: 'impossible',
  kind: 'object',
  order: 10,
  reveal: 'topDown',
  position: POSITION,
  rotationY: 0,
  // 床に投影された絵の広がり（立つ場所そのものは含まない、§10b）
  footprint: { minX: -0.9, maxX: 0.9, minZ: -5.9, maxZ: -3.6 },
  revealFocus: { x: 0, y: 0, z: -2.2 },
  viewSpots: [
    {
      standAt: { x: POSITION.x, y: 0, z: POSITION.z },
      eye: { x: POSITION.x, y: EYE_HEIGHT, z: POSITION.z },
      lookAt: {
        x: POSITION.x + IDEAL_CENTER.x,
        y: IDEAL_CENTER.y,
        z: POSITION.z + IDEAL_CENTER.z,
      },
      fov: 58,
      radius: 0.9,
    },
  ],
  build,
};
