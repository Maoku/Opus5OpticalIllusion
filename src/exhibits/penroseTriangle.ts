import * as THREE from 'three';
import {
  alignDiagonalTo,
  alignedFace,
  apparentHalfSize,
  bestOrder,
  prismFromFaces,
  squareFace,
  type Face,
} from './common/impossible';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * ペンローズの三角形。
 *
 * 構成:
 *   互いに直交する3本の角柱を「開いた鎖」としてつなぐ。
 *     A →(+X)→ B →(+Y)→ C →(+Z)→ D
 *   立方体の対角線 (1,1,1) 方向から見ると、3 本が 120° ずつに投影され、
 *   D が A に重なって閉じた三角形になる。実際には D と A は L√3 だけ離れている。
 *
 * 成立のための 2 つの細工:
 *   1. 断面を視点距離に比例させ、見かけの太さを揃える
 *   2. 手前の桁の端面を、奥の桁の端面の「見かけの輪郭」へ合わせる（alignedFace）
 */

const BAR_LENGTH = 1.15;
const BAR_SIZE = 0.3;
const CENTER_HEIGHT = 1.5;
const VIEW_DISTANCE = 6.2;
/**
 * Room B の左奥（§10b）。
 *
 * 以前は (−5, −9) で、立ち位置 (−5, −2.8) がペンローズの階段の台座の
 * 内部だった。左右に振り分け、視線が互いを横切らない配置に組み直している。
 */
const POSITION = { x: -6.5, y: CENTER_HEIGHT, z: -10.0 };

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const eye = ctx.eyes[0]?.clone() ?? origin.clone().add(new THREE.Vector3(0, 0, VIEW_DISTANCE));

  const toEye = eye.clone().sub(origin).normalize();
  const quaternion = alignDiagonalTo(toEye);
  const group = new THREE.Group();
  group.quaternion.copy(quaternion);
  root.add(group);

  const L = BAR_LENGTH;
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(L, 0, 0),
    new THREE.Vector3(L, L, 0),
    new THREE.Vector3(L, L, L),
  ];
  // 4 点の重心を原点へ寄せて、視野の中心に来るようにする
  const centroid = points
    .reduce((acc, p) => acc.add(p), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  for (const p of points) p.sub(centroid);

  // 視点をグループのローカル座標へ写す
  const eyeLocal = eye.clone().sub(origin).applyQuaternion(quaternion.clone().invert());

  const reference = points[0]!.distanceTo(eyeLocal);
  const halfSizeAt = (p: THREE.Vector3): number =>
    apparentHalfSize(p, eyeLocal, BAR_SIZE, reference);

  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

  // 角柱の端面。継ぎ目 (B, C) は隣の桁と重なるよう半サイズぶん延長する
  const faces: Face[][] = [];
  for (let i = 0; i < 3; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const axis = axes[i]!;
    const hFrom = halfSizeAt(from);
    const hTo = halfSizeAt(to);
    const start = i === 0 ? from.clone() : from.clone().addScaledVector(axis, -hFrom);
    const end = i === 2 ? to.clone() : to.clone().addScaledVector(axis, hTo);
    faces.push([
      squareFace(start, axis, halfSizeAt(start)),
      squareFace(end, axis, halfSizeAt(end)),
    ]);
  }

  // 破綻する継ぎ目: 手前の桁 (bar3) の端面を、奥の桁 (bar1) の始端の見かけへ重ねる。
  // 断面の向きが 90° 違うため、そのままつなぐと角柱全体がねじれて折り目が出る。
  // 最後の 0.22m だけを「留め切り」の遷移区間にして、ねじれをそこへ閉じ込める。
  const farFace = faces[0]![0]!;
  const nearDepth = points[3]!.distanceTo(eyeLocal);
  const aligned = bestOrder(alignedFace(farFace, eyeLocal, nearDepth), faces[2]![1]!);
  const mitreLength = 0.22;
  const mitreStart = points[3]!.clone().addScaledVector(axes[2]!, -mitreLength);
  const mitreFace = squareFace(mitreStart, axes[2]!, halfSizeAt(mitreStart));
  faces[2]![1] = mitreFace;
  faces.push([mitreFace, aligned]);

  const material = new THREE.MeshStandardMaterial({
    color: 0xc9c4b8,
    roughness: 0.5,
    metalness: 0.18,
  });
  const bars: THREE.Mesh[] = [];
  for (const [a, b] of faces) {
    const mesh = new THREE.Mesh(prismFromFaces(a!, b!), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bars.push(mesh);
    group.add(mesh);
  }

  const plinthHeight = CENTER_HEIGHT - 0.72;
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.5, plinthHeight, 28),
    new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.8 }),
  );
  plinth.position.y = -CENTER_HEIGHT + plinthHeight / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  const removeSpot = ctx.lighting.addSpot({
    position: new THREE.Vector3(origin.x - 1.8, 4.2, origin.z + 1.2),
    target: origin.clone(),
    color: 0xfff2e4,
    intensity: 30,
    angle: 0.44,
    penumbra: 0.45,
    distance: 14,
    shadow: true,
  });

  return {
    root,
    setRevealed(_revealed, progress) {
      // カメラのオービットは ExhibitManager が担当する（reveal: 'orbit'）。
      // ここでは回り込んだ先で切れ目が読みやすいよう、桁を淡く発光させる。
      material.emissive.setHex(0x2f6f5c);
      material.emissiveIntensity = progress * 0.45;
    },
    dispose() {
      removeSpot();
      for (const bar of bars) bar.geometry.dispose();
      material.dispose();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
    },
  };
}

export const penroseTriangle: ExhibitDefinition = {
  id: 'penroseTriangle',
  textKey: 'penroseTriangle',
  room: 'impossible',
  kind: 'object',
  order: 7,
  reveal: 'orbit',
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: CENTER_HEIGHT,
    // 角柱の鎖（BAR_LENGTH）＋台座
    halfX: BAR_LENGTH / 2 + BAR_SIZE,
    fov: 26,
    radius: 1.1,
    eyeHeight: CENTER_HEIGHT,
  }),
  position: POSITION,
  build,
};
