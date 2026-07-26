import * as THREE from 'three';
import { placeOnEyeRay } from './common/eyeProjection';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * ブーシェの椅子。
 *
 * 構成:
 *   背もたれと 4 本の脚は「大きな実物」として床に立っている（6.4m 先）。
 *   座面だけが小さな別部品で、細い支柱に載って手前に浮いている（2.5m 先）。
 *   この 1 点から見たときだけ、2 つが 1 脚の椅子として重なる。
 *
 * 注意した点:
 *   奥の塊も視線に沿って押し出すと、脚が床下へ潜ってしまう
 *   （視点が床より上にあるので、レイを伸ばせば必ず床を割る）。
 *   実物のブーシェの椅子と同じく「奥は床に立て、手前だけ宙に浮かせる」構成にした。
 *   浮いている座面は高さが自由なので、こちらを視線に合わせる。
 *
 * 「これは 1 脚の椅子だ」と決まった瞬間、椅子の大きさが空間の物差しになり、
 * 奥に立つ等身大の人がその物差しで測られて小人に見える。
 */

const EYE_HEIGHT = 1.6;
const VIEW_DISTANCE = 3.4;
const POSITION = { x: 31, y: 0, z: -3.0 };
/** 奥の塊を置く距離と、その拡大率 */
const FAR_DEPTH = 6.4;
const FAR_SCALE = 1.9;
/** 手前の座面を置く距離 */
const NEAR_DEPTH = 2.5;

const SEAT = { width: 0.46, depth: 0.46, thickness: 0.05, height: 0.45 };
const BACK = { width: 0.46, height: 0.52, thickness: 0.05 };
const LEG = 0.05;

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const eye = (ctx.eyes[0] ?? origin.clone().add(new THREE.Vector3(0, EYE_HEIGHT, VIEW_DISTANCE)))
    .clone()
    .sub(origin);

  const material = new THREE.MeshStandardMaterial({ color: 0xb4643c, roughness: 0.65 });

  // --- 奥の塊: 背もたれ + 4 本の脚。床に立っている -------------------------
  const far = new THREE.Group();
  far.scale.setScalar(FAR_SCALE);
  far.position.set(eye.x, 0, eye.z - FAR_DEPTH);
  root.add(far);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(BACK.width, BACK.height, BACK.thickness),
    material,
  );
  back.position.set(0, SEAT.height + BACK.height / 2, -SEAT.depth / 2);
  back.castShadow = true;
  back.receiveShadow = true;
  far.add(back);

  const legs: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(LEG, SEAT.height, LEG), material);
      leg.position.set(
        (sx * (SEAT.width - LEG)) / 2,
        SEAT.height / 2,
        (sz * (SEAT.depth - LEG)) / 2,
      );
      leg.castShadow = true;
      leg.receiveShadow = true;
      legs.push(leg);
      far.add(leg);
    }
  }

  // --- 手前の座面。奥の塊の「座面が来るべき位置」を視線に沿って引き寄せる ---
  const seatAnchor = new THREE.Vector3(0, SEAT.height * FAR_SCALE, 0).add(far.position);
  const seatDistance = eye.distanceTo(seatAnchor);
  const seatScale = (NEAR_DEPTH / seatDistance) * FAR_SCALE;
  const seatPosition = placeOnEyeRay(eye, seatAnchor, NEAR_DEPTH);

  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(
      SEAT.width * seatScale,
      SEAT.thickness * seatScale,
      SEAT.depth * seatScale,
    ),
    material,
  );
  seat.position.copy(seatPosition);
  seat.castShadow = true;
  seat.receiveShadow = true;
  root.add(seat);

  // 座面を支える細い支柱。実物の展示でも座面は台に載っている
  const postHeight = Math.max(0.05, seatPosition.y - (SEAT.thickness * seatScale) / 2);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.022, postHeight, 12),
    new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.7 }),
  );
  // 座面の裏側へ寄せて、正解視点からは座面にほぼ隠れるようにする
  post.position.set(seatPosition.x, postHeight / 2, seatPosition.z - SEAT.depth * seatScale * 0.34);
  post.castShadow = true;
  root.add(post);

  // --- 奥に立つ等身大（1.7m）の人形 ---------------------------------------
  const dollMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7fd4, roughness: 0.7 });
  const doll = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.95, 6, 12), dollMaterial);
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), dollMaterial);
  head.position.y = 1.42;
  doll.add(body, head);
  doll.position.set(far.position.x + 1.15, 0, far.position.z + 0.3);
  for (const mesh of [body, head]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  root.add(doll);

  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(-1.6, 3.8, 1.2)),
    target: origin.clone().add(new THREE.Vector3(0, 0.6, -3.0)),
    color: 0xfff2e0,
    intensity: 40,
    angle: 0.6,
    penumbra: 0.6,
    distance: 18,
    shadow: true,
  });

  const seatHome = seatPosition.clone();
  return {
    root,
    setRevealed(_revealed, progress) {
      // 手前の座面を持ち上げて、2 つが別物であることを示す
      seat.position.set(seatHome.x, seatHome.y + progress * 0.45, seatHome.z);
    },
    dispose() {
      removeSpot();
      back.geometry.dispose();
      for (const leg of legs) leg.geometry.dispose();
      seat.geometry.dispose();
      material.dispose();
      post.geometry.dispose();
      (post.material as THREE.Material).dispose();
      body.geometry.dispose();
      head.geometry.dispose();
      dollMaterial.dispose();
    },
  };
}

export const beuchetChair: ExhibitDefinition = {
  id: 'beuchetChair',
  textKey: 'beuchetChair',
  room: 'space',
  kind: 'object',
  order: 12,
  reveal: 'orbit',
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: 0.9,
    fov: 46,
    radius: 1.0,
  }),
  position: POSITION,
  revealFocus: { x: 0, y: 0.6, z: -3.2 },
  build,
};
