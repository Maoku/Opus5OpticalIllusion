import * as THREE from 'three';
import { DEFAULT_EYE_HEIGHT } from '../player/PlayerController';
import { damp } from '../utils/math';
import {
  DEFAULT_PAIR,
  HULL_MODEL_PATH,
  LIGHT_DISTANCE,
  LUMP_CENTRE_Y,
  RUNTIME_RESOLUTION,
  SCREEN_CENTRE_Y,
  SCREEN_DISTANCE,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  buildHullField,
  lightPosition,
} from './common/shadowHullSpec';
import { fieldToMesh } from './common/visualHull';
import { footprintAround } from './common/placement';
import { createSpotFixture } from './common/spotFixture';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';
import type { SpotRequest } from '../world/Lighting';

/**
 * D5「嘘つきの影」/ The Lying Shadow（ROOM_D §1）。
 *
 * ★ 成立条件: **光源を自分で動かせること**。
 *   台座の上の、意味をなさない金属の塊。一方のスポットが落とす影は鳥、
 *   もう一方が落とす影は魚。同じ塊が、同時に、2 つの嘘をついている。
 *   静止画にすると「2 つの影絵が並んでいる」だけの絵になる。ダイヤルを回して
 *   **意味が生成され、崩壊し、また生成される連続**を見ることが体験の本体。
 *
 * 形状は visual hull（`common/visualHull.ts`）。ビルド時に
 * `tools/buildShadowHull.ts` が glTF を書き出し、ここではそれを読むだけなので
 * 実行時コストはゼロ。読めなかったときだけ、同じ定義から粗く彫り直す。
 */

/** 台座の天面。塊の底がここに乗る */
const PEDESTAL_TOP = 1.14;
const POSITION = { x: -10, y: 0, z: -32.2 };
/**
 * 開いている側（ローカル +X +Z）＝スクリーンの表が、棟の入口側（北東）を向く。
 *
 * ★ 向きは D1 との関係で決まっている。スクリーンはこの棟でいちばん明るい面なので、
 *   D1「二つの真実」の視点 A（南から北を見る）の背景に**表**が入ると、
 *   断片の雲がその白地に溶けて字が読めなくなる。表を北東へ向け、
 *   南からは裏（暗い面）しか見えないようにしてある。
 */
const ROTATION_Y = 0;
const VIEW_DISTANCE = 3.6;

/**
 * 2 灯の色と広がり。SpotLight・灯体のレンズ・ビームで同じ値を使う。
 * 見えている機材と実際の光がずれると、機材のほうが嘘に見える。
 */
const LIGHT_COLOR = 0xfff4e4;
/**
 * 影の輪郭を立たせる角度。スクリーンの内側で切れる広さにする。
 * 板の外へ出たぶんは、部屋の壁に **2 つ目の影**を落として作品を汚す
 */
const BEAM_ANGLE = 0.42;

/** ダイヤルの振れ幅。これ以上回すと影がスクリーンから外れてしまう */
const MAX_DIAL = THREE.MathUtils.degToRad(42);
/** ダイヤルの刻み数。一周すると「意味のある角度」を 2 回通る */
const DETENTS = 12;

function firstGeometry(gltf: { scene: THREE.Object3D } | null): THREE.BufferGeometry | null {
  if (!gltf) return null;
  let found: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((child) => {
    if (!found && child instanceof THREE.Mesh) found = child.geometry as THREE.BufferGeometry;
  });
  return found;
}

async function build(ctx: BuildContext): Promise<ExhibitInstance> {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const axis = new THREE.Vector3(0, 1, 0);
  /** 展示ローカル → ワールド。Lighting はワールド座標で受け取る */
  const toWorld = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z).applyAxisAngle(axis, ROTATION_Y).add(origin);

  // --- スクリーン 2 枚（L 字に突き合わせる）--------------------------------
  // 影を映す表だけを白くし、裏と側面は暗いままにする。
  // 大きな白い板の裏は、この暗い棟では遠くからでも目立ち、
  // 隣（D1）の背景として明るすぎる
  const screenFront = new THREE.MeshStandardMaterial({ color: 0xcfccc4, roughness: 0.96 });
  const screenBack = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.95 });
  // BoxGeometry の面の並びは +X, -X, +Y, -Y, +Z, -Z。表は +Z
  const screenMaterials = [screenBack, screenBack, screenBack, screenBack, screenFront, screenBack];
  const screenGeometry = new THREE.BoxGeometry(SCREEN_WIDTH, SCREEN_HEIGHT, 0.08);
  /** 板の中心。内側の端がもう一方の平面に接するようにずらす */
  const screenOffset = SCREEN_WIDTH / 2 - SCREEN_DISTANCE;
  for (const side of [0, 1] as const) {
    const screen = new THREE.Mesh(screenGeometry, screenMaterials);
    if (side === 0) {
      screen.position.set(screenOffset, SCREEN_CENTRE_Y, -SCREEN_DISTANCE);
    } else {
      screen.position.set(-SCREEN_DISTANCE, SCREEN_CENTRE_Y, screenOffset);
      screen.rotation.y = Math.PI / 2;
    }
    screen.receiveShadow = true;
    root.add(screen);
  }

  // 板を通り抜けられると「裏に影が無い」ことが見えて興ざめする
  const id = ctx.definition.id;
  const far = SCREEN_WIDTH - SCREEN_DISTANCE;
  for (const [ax, az, bx, bz] of [
    [-SCREEN_DISTANCE, -SCREEN_DISTANCE, far, -SCREEN_DISTANCE],
    [-SCREEN_DISTANCE, -SCREEN_DISTANCE, -SCREEN_DISTANCE, far],
  ] as const) {
    const a = toWorld(ax, 0, az);
    const b = toWorld(bx, 0, bz);
    ctx.collision.addSegment(a.x, a.z, b.x, b.z, 0.1, id);
  }

  // --- 台座 -----------------------------------------------------------------
  const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d23, roughness: 0.85 });
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.32, PEDESTAL_TOP, 28),
    plinthMaterial,
  );
  plinth.position.y = PEDESTAL_TOP / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  // --- ダイヤル -------------------------------------------------------------
  const dialMount = new THREE.Group();
  // 台座の、来館者が立つ側の斜面に付ける
  dialMount.position.set(0.19, PEDESTAL_TOP - 0.22, 0.19);
  dialMount.rotation.set(-Math.PI / 7, Math.PI / 4, 0);
  root.add(dialMount);

  const dialMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f7581,
    roughness: 0.4,
    metalness: 0.7,
  });
  const plateGeometry = new THREE.BoxGeometry(0.2, 0.16, 0.025);
  const plate = new THREE.Mesh(plateGeometry, dialMaterial);
  dialMount.add(plate);

  const knob = new THREE.Group();
  knob.position.z = 0.03;
  dialMount.add(knob);
  const knobGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20);
  const knobBody = new THREE.Mesh(knobGeometry, dialMaterial);
  knobBody.rotation.x = Math.PI / 2;
  knob.add(knobBody);
  const pointerGeometry = new THREE.BoxGeometry(0.012, 0.05, 0.032);
  const pointer = new THREE.Mesh(
    pointerGeometry,
    new THREE.MeshBasicMaterial({ color: 0xffb27a, toneMapped: false }),
  );
  pointer.position.set(0, 0.028, 0.012);
  knob.add(pointer);

  // --- 塊（visual hull）----------------------------------------------------
  const gltf = await ctx.assets.tryLoadModel(HULL_MODEL_PATH);
  let geometry = firstGeometry(gltf);
  let ownsGeometry = false;
  if (!geometry) {
    // 成果物が無い環境（スクリプト未実行）でも展示を落とさない。
    // 同じ定義から粗く彫り直すので、影の意味は保たれる
    const { field, grid } = buildHullField(RUNTIME_RESOLUTION, DEFAULT_PAIR);
    const mesh = await fieldToMesh(field, grid, 0.5, 120000);
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    ownsGeometry = true;
  }

  const lumpMaterial = new THREE.MeshStandardMaterial({
    color: 0x9298a2,
    roughness: 0.42,
    metalness: 0.55,
    // タネあかしで薄くする。透明度を切り替えるとシェーダが再コンパイルされ、
    // その 1 フレームだけカクつくので、最初から透明扱いにしておく
    transparent: true,
  });
  const lump = new THREE.Mesh(geometry, lumpMaterial);
  lump.castShadow = true;
  lump.receiveShadow = true;
  root.add(lump);

  // タネあかしで重ねるワイヤーフレーム。voxel hull の実体を見せる
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd2b0,
    wireframe: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  wireMaterial.toneMapped = false;
  const wire = new THREE.Mesh(geometry, wireMaterial);
  wire.visible = false;
  root.add(wire);

  // --- 光源 2 灯 -------------------------------------------------------------
  const target = toWorld(0, LUMP_CENTRE_Y, 0);
  const requests: SpotRequest[] = ([0, 1] as const).map((index) => {
    const local = lightPosition(index);
    return {
      position: toWorld(local[0], local[1], local[2]),
      target: target.clone(),
      color: LIGHT_COLOR,
      intensity: 9.5,
      // 影の輪郭を立たせる。penumbra を上げると鳥にも魚にも見えなくなる
      angle: BEAM_ANGLE,
      // 距離減衰は切る（スクリーンを均一に照らすため）が、打ち切りは要る。
      // decay 0 のスポットは減衰しないので、放っておくと棟の反対側まで届く
      distance: 6,
      penumbra: 0.06,
      decay: 0,
      critical: true,
      shadow: true,
    };
  });
  const removeSpots = requests.map((request) => ctx.lighting.addSpot(request));

  // --- 灯体 2 台 -------------------------------------------------------------
  // 光源が宙に浮いていると「実際の光」に見えず、ダイヤルが何を動かしているのか
  // 読めない。機材を置き、口から先の空気を光らせて光路そのものを見せる
  const fixtures = ([0, 1] as const).map(() =>
    createSpotFixture({
      height: LUMP_CENTRE_Y,
      angle: BEAM_ANGLE,
      // スクリーンに届く手前で消えきる長さ。板の上で切ると、
      // 光の柱ではなく「白い板に貼った半透明の円」に見えてしまう
      throwDistance: LIGHT_DISTANCE + SCREEN_DISTANCE - 0.45,
      color: LIGHT_COLOR,
      // 影の濃さが成立条件（brightnessCritical）。濃いビームは
      // スクリーンの黒を持ち上げて鳥と魚の輪郭を鈍らせる
      beamStrength: ctx.quality === 'low' ? 0 : 0.35,
    }),
  );
  for (const fixture of fixtures) root.add(fixture.group);

  let detent = 0;
  let dial = 0;
  /** ビームの近接フェード用。毎フレーム作らない */
  const cameraWorld = new THREE.Vector3();
  let revealed = false;
  let revealProgress = 0;
  let revealTime = 0;

  /** 現在のダイヤル角を 2 灯と灯体へ反映する */
  const applyDial = (): void => {
    for (const index of [0, 1] as const) {
      const local = lightPosition(index, dial);
      requests[index]!.position.copy(toWorld(local[0], local[1], local[2]));
      const rig = fixtures[index]!.group;
      rig.position.set(local[0], 0, local[2]);
      // 灯体の −Z が塊を向く。原点から見た方位そのもの
      rig.rotation.y = Math.atan2(local[0], local[2]);
    }
  };
  applyDial();

  return {
    root,
    onInteract() {
      detent = (detent + 1) % DETENTS;
    },
    update(dt) {
      // つまみは一方向へ回り続け、光源は左右に振れる。
      // 一周させると「意味のある角度」を 2 回通ることが手で分かる
      knob.rotation.z = -(detent / DETENTS) * Math.PI * 2;
      let wanted = Math.sin((detent / DETENTS) * Math.PI * 2) * MAX_DIAL;
      if (revealed) {
        // タネあかし中は自動で振る。progress の 1.1 秒では
        //「意味 → 無意味 → 意味」の往復が体験にならない
        revealTime += dt;
        wanted = Math.sin(revealTime * 0.7) * MAX_DIAL;
      } else {
        revealTime = 0;
      }
      dial = THREE.MathUtils.lerp(dial, wanted, damp(5, dt));
      applyDial();
      ctx.camera.getWorldPosition(cameraWorld);
      for (const fixture of fixtures) fixture.update(dt, cameraWorld);

      wire.visible = revealProgress > 0.01;
      wireMaterial.opacity = revealProgress * 0.85;
      lumpMaterial.opacity = 1 - revealProgress * 0.55;
    },
    setRevealed(isRevealed, progress) {
      revealed = isRevealed;
      revealProgress = progress;
    },
    dispose() {
      for (const remove of removeSpots) remove();
      if (ownsGeometry) geometry.dispose();
      lumpMaterial.dispose();
      wireMaterial.dispose();
      screenGeometry.dispose();
      screenFront.dispose();
      screenBack.dispose();
      plinth.geometry.dispose();
      plinthMaterial.dispose();
      plateGeometry.dispose();
      knobGeometry.dispose();
      pointerGeometry.dispose();
      (pointer.material as THREE.Material).dispose();
      dialMaterial.dispose();
      for (const fixture of fixtures) fixture.dispose();
    },
  };
}

/**
 * 見る位置は 2 枚のスクリーンが開いた側の対角線上。
 * どちらの光源も遮らず、2 つの影を同時に視野へ入れられる唯一の場所になる。
 */
const STAND_LOCAL = VIEW_DISTANCE / Math.SQRT2;
const STAND = {
  x: POSITION.x + STAND_LOCAL * (Math.cos(ROTATION_Y) + Math.sin(ROTATION_Y)),
  z: POSITION.z + STAND_LOCAL * (Math.cos(ROTATION_Y) - Math.sin(ROTATION_Y)),
};

export const lyingShadow: ExhibitDefinition = {
  id: 'lyingShadow',
  textKey: 'lyingShadow',
  room: 'opus',
  kind: 'object',
  order: 23,
  // タネあかしはカメラではなく展示側で行う（ダイヤルの自動掃引 + ワイヤーフレーム）
  reveal: 'none',
  interactTextKey: 'dialTurn',
  // 影の濃さが成立条件。ヴィネットで隅を落とすと影の縁が読めなくなる
  brightnessCritical: true,
  position: POSITION,
  rotationY: ROTATION_Y,
  // スクリーン 2 枚と灯体 2 台を含む範囲。灯体は光源（半径 2.0）より
  // 後ろへ 0.4 ほど出るので、そのぶん光源側へ広げてある
  footprint: footprintAround(POSITION.x + 0.3, POSITION.z + 0.3, 2.1, 2.1),
  viewSpots: [
    {
      standAt: { x: STAND.x, y: 0, z: STAND.z },
      eye: { x: STAND.x, y: DEFAULT_EYE_HEIGHT, z: STAND.z },
      lookAt: { x: POSITION.x, y: LUMP_CENTRE_Y, z: POSITION.z },
      fov: 52,
      radius: 1.1,
    },
  ],
  build,
};

/** 立ち位置が光路を塞いでいないことを検査するための素材（tests/shadowHull.test.ts） */
export const LYING_SHADOW_LAYOUT = {
  position: POSITION,
  rotationY: ROTATION_Y,
  lightDistance: LIGHT_DISTANCE,
  screenDistance: SCREEN_DISTANCE,
  stand: STAND,
  viewDistance: VIEW_DISTANCE,
};
