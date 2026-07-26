import * as THREE from 'three';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * ネッカーキューブ。
 *
 * ★ 成立条件: **正投影**であること。
 * 透視投影だと遠近の手がかり（奥の面が小さく描かれる）が混ざり、
 * 解釈が片方に固定されて「反転する」体験にならない。
 * ViewSpot 側に projection: 'orthographic' を宣言している。
 *
 * 立方体は視線に対して傾けてある。カメラを傾けるのではなく物体を傾けるのは、
 * 視点マーカーを床に置いたまま古典的な「ずれた二つの正方形」の見え方を作るため。
 */

const SIZE = 0.92;
const EDGE = 0.026;
const CENTER_HEIGHT = 1.5;
const VIEW_DISTANCE = 6.0;
/** Room B の右奥。ペンローズの三角形と左右対称に置く（§10b） */
const POSITION = { x: 6.5, y: CENTER_HEIGHT, z: -10.0 };

/** 立方体の頂点（±1 の組み合わせ） */
function corners(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    out.push(new THREE.Vector3(x, y, z).multiplyScalar(SIZE / 2));
  }
  return out;
}

const EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 4],
  [1, 3], [1, 5],
  [2, 3], [2, 6],
  [3, 7],
  [4, 5], [4, 6],
  [5, 7],
  [6, 7],
];

/** 指定した角（±1 の符号）に接する 3 面を作る。「どちらが手前か」の 2 解釈を示す */
function cornerFaces(sign: number, color: number): THREE.Mesh[] {
  const half = SIZE / 2;
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  material.toneMapped = false;
  const meshes: THREE.Mesh[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE);
    if (axis === 'x') geometry.rotateY(Math.PI / 2);
    if (axis === 'y') geometry.rotateX(Math.PI / 2);
    geometry.translate(
      axis === 'x' ? sign * half : 0,
      axis === 'y' ? sign * half : 0,
      axis === 'z' ? sign * half : 0,
    );
    meshes.push(new THREE.Mesh(geometry, material));
  }
  return meshes;
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const cube = new THREE.Group();
  // 古典的な「二つのずれた正方形」の見え方になる傾き
  cube.rotation.set(0.42, 0.62, 0);
  root.add(cube);

  const verts = corners();
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f6fa });
  edgeMaterial.toneMapped = false;
  const edgeGeometries: THREE.BufferGeometry[] = [];
  for (const [a, b] of EDGES) {
    const from = verts[a]!;
    const to = verts[b]!;
    const length = from.distanceTo(to);
    const geometry = new THREE.CylinderGeometry(EDGE, EDGE, length, 8);
    const mesh = new THREE.Mesh(geometry, edgeMaterial);
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    edgeGeometries.push(geometry);
    cube.add(mesh);
  }
  // 角が丸くつながって見えるよう、頂点に小球を置く
  const jointGeometry = new THREE.SphereGeometry(EDGE, 10, 8);
  for (const v of verts) {
    const joint = new THREE.Mesh(jointGeometry, edgeMaterial);
    joint.position.copy(v);
    cube.add(joint);
  }

  const readingA = cornerFaces(1, 0x6fd2b0);
  const readingB = cornerFaces(-1, 0xff8a5c);
  for (const mesh of [...readingA, ...readingB]) cube.add(mesh);

  // 立方体の最下点（半対角 0.8m）に触れないよう、台の高さを抑える
  const plinthHeight = CENTER_HEIGHT - 0.95;
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, plinthHeight, 24),
    new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.8 }),
  );
  plinth.position.y = -CENTER_HEIGHT + plinthHeight / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  const origin = ctx.definition.position;
  const removeSpot = ctx.lighting.addSpot({
    position: new THREE.Vector3(origin.x + 1.2, 4.0, origin.z + 1.6),
    target: new THREE.Vector3(origin.x, origin.y, origin.z),
    color: 0xffffff,
    intensity: 22,
    angle: 0.4,
    penumbra: 0.5,
    distance: 12,
  });

  let elapsed = 0;
  let revealProgress = 0;
  return {
    root,
    update(dt) {
      elapsed += dt;
      if (revealProgress <= 0.001) return;
      // 2 通りの解釈を交互に提示する。同時に出すと「両方が正しい」ことが伝わらない
      const cycle = (Math.sin((elapsed * Math.PI * 2) / 3.2) + 1) / 2;
      const a = revealProgress * (1 - cycle) * 0.34;
      const b = revealProgress * cycle * 0.34;
      (readingA[0]!.material as THREE.MeshBasicMaterial).opacity = a;
      (readingB[0]!.material as THREE.MeshBasicMaterial).opacity = b;
    },
    setRevealed(_revealed, progress) {
      revealProgress = progress;
      if (progress <= 0.001) {
        (readingA[0]!.material as THREE.MeshBasicMaterial).opacity = 0;
        (readingB[0]!.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    },
    dispose() {
      removeSpot();
      for (const g of edgeGeometries) g.dispose();
      jointGeometry.dispose();
      edgeMaterial.dispose();
      for (const mesh of [...readingA, ...readingB]) mesh.geometry.dispose();
      (readingA[0]!.material as THREE.Material).dispose();
      (readingB[0]!.material as THREE.Material).dispose();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
    },
  };
}

export const neckerCube: ExhibitDefinition = {
  id: 'neckerCube',
  textKey: 'neckerCube',
  room: 'impossible',
  kind: 'object',
  order: 9,
  reveal: 'fadeContext',
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: CENTER_HEIGHT,
    halfX: SIZE / 2 + 0.16,
    fov: 19,
    radius: 1.1,
    eyeHeight: CENTER_HEIGHT,
    projection: 'orthographic',
    orthoHeight: 2.6,
  }),
  position: POSITION,
  build,
};
