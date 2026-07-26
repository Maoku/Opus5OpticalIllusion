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

/** 奥の塊（1.9 倍）の半幅。人形をその脇へ寄せるのに使う */
const FAR_HALF_WIDTH = (SEAT.width * FAR_SCALE) / 2;
/** 等身大の人形。目盛りと数値が食い違わないよう、寸法はここから引く */
const DOLL_BODY_R = 0.19;
const DOLL_HEAD_R = 0.21;
const DOLL_HEAD_Y = 1.42;
const DOLL_HEIGHT = DOLL_HEAD_Y + DOLL_HEAD_R;

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

  // --- 奥に立つ等身大の人形 -----------------------------------------------
  // 奥の椅子の脚元へ寄せる（§11d-3）。1.15m 離れていた頃は椅子との比較に
  // なっておらず、「小人に見える」ことが読み取れなかった。
  const dollMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7fd4, roughness: 0.7 });
  const doll = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(DOLL_BODY_R, 0.95, 6, 12), dollMaterial);
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(DOLL_HEAD_R, 16, 12), dollMaterial);
  head.position.y = DOLL_HEAD_Y;
  doll.add(body, head);
  const dollX = far.position.x + FAR_HALF_WIDTH + DOLL_BODY_R + 0.09;
  doll.position.set(dollX, 0, far.position.z + 0.15);
  for (const mesh of [body, head]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  root.add(doll);

  // --- 実寸の目盛り（§11d-3） ---------------------------------------------
  // 「椅子が巨大なのか、人が小さいのか」が切り替わる瞬間を見せる。
  // 奥の椅子の座面は 0.855m —— 等身大の人の腰より上にある。
  // 普通の椅子なら膝の高さなので、これだけで椅子の異常さが分かる。
  const measureMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd2b0,
    transparent: true,
    opacity: 0,
  });
  measureMaterial.toneMapped = false;
  const measure = new THREE.Group();
  measure.visible = false;
  const RULE_X = dollX + DOLL_BODY_R + 0.08;
  const SEAT_LEVEL = SEAT.height * FAR_SCALE;
  const rulePieces: THREE.BufferGeometry[] = [];
  const addRule = (w: number, h: number, x: number, y: number): void => {
    const geometry = new THREE.BoxGeometry(w, h, 0.02);
    rulePieces.push(geometry);
    const mesh = new THREE.Mesh(geometry, measureMaterial);
    mesh.position.set(x, y, doll.position.z);
    mesh.renderOrder = 4;
    measure.add(mesh);
  };
  // 人の背丈をとる縦の物差し
  addRule(0.02, DOLL_HEIGHT, RULE_X, DOLL_HEIGHT / 2);
  // 頭頂
  addRule(0.16, 0.02, RULE_X, DOLL_HEIGHT);
  // 座面の高さを人の体に当てる横線。椅子の脚元から物差しまで引く
  addRule(RULE_X - far.position.x, 0.02, (RULE_X + far.position.x) / 2, SEAT_LEVEL);
  root.add(measure);

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
      // 同時に実寸の目盛りを出す。座面が人の腰より上にあることが読める
      measure.visible = progress > 0.001;
      measureMaterial.opacity = progress * 0.9;
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
      for (const geometry of rulePieces) geometry.dispose();
      measureMaterial.dispose();
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
  /**
   * 奥の塊（z 局所 −3.0 に 1.9 倍で立つ）から、手前に浮かぶ座面
   * （z 局所 +0.9）まで。右手 1.15m には等身大の人形が立つので非対称（§10b）。
   */
  footprint: {
    minX: POSITION.x - 0.7,
    maxX: POSITION.x + 1.2,
    minZ: POSITION.z - 3.6,
    maxZ: POSITION.z + 1.1,
  },
  revealFocus: { x: 0, y: 0.6, z: -3.2 },
  build,
};
