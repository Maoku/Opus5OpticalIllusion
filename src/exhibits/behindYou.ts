import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAU, damp, shortestAngleDelta } from '../utils/math';
import { createTextPlate, type TextPlate } from '../world/TextPlate';
import { VisibilityTracker, type VisibilityTarget } from './common/VisibilityTracker';
import { footprintAround } from './common/placement';
import { assembleFigure, createFigureGeometry, type FigureGeometry } from './common/statueFigure';
import type { BuildContext, ExhibitDefinition, ExhibitInstance, HintContent } from './types';

/**
 * D3「後ろの正面」/ Behind You（ROOM_D §1）。
 *
 * ★ 成立条件: **観測者の視線そのもの**。
 *   回廊に 12 体の小さな彫像が並ぶ。ひとつずつ見ながら歩く。何も起きない。
 *   しかし彫像は、**あなたの視界に入っていない間だけ**姿勢を変え、向きを変え、
 *   隣と入れ替わる。振り返っても、そこにあるのは「ずっとそうだった顔」をした
 *   彫像だけ。一周し終えると、何体が変わっていたかを突きつけられる。
 *
 * ★ 変化は必ず 1 フレームで完了させること（ROOM_D §5 のリスク表）。
 *   補間すると視界へ戻った瞬間に動きが見え、錯視ではなく **バグに見える**。
 *   だから姿勢も位置も代入で切り替える。ここは絶対に緩めない。
 *
 * 中庭（中央の塊）は遮蔽物として本質的な役割を持つ。これが無いと、
 * 回廊の反対側が視錐台に入ったままになり、変えられる個体がほとんど無くなる。
 */

const COUNT = 12;
const POSITION = { x: 7.5, y: 0, z: -33.5 };
/**
 * 中庭（遮蔽物）の半径と高さ。
 * 高く太いほど反対側を隠せるが、回廊の内側に立ったとき視界を黒い壁で塞ぐ。
 * 彫像（1.3m）より頭ひとつ高い程度に留める。
 */
const CORE_RADIUS = 1.6;
const CORE_HEIGHT = 2.4;
/** 彫像を並べる半径 */
const RING_RADIUS = 3.1;
const PLINTH_HEIGHT = 0.55;
const PLINTH_RADIUS = 0.24;
/** ゾーン（回廊）の半径 */
const ZONE_HALF = 5.0;

/**
 * 誘導矢印の輪。彫像（3.1）の外、ゾーンの縁（5.0）の内側に敷く。
 * 台座を避けて歩ける線でもある。
 */
const GUIDE_RADIUS = 4.15;
/**
 * 矢印の枚数。円周は約 26m あるので、12 枚では 2m 間隔になり
 * 「点々と落ちている印」にしか見えない。1m 強の間隔まで詰めて初めて道になる。
 */
const GUIDE_COUNT = 24;

/** 変化を試みる間隔（秒）。速すぎると「見ていない隙」に間に合わない */
const CHANGE_INTERVAL = 2.4;
/** 直近これだけの秒数に注視された個体は触らない */
const GAZE_MEMORY = 2.0;

interface Pose {
  /** 腕を横へ開く角（ラジアン、正で外向き） */
  arms: [number, number];
  /** 腕を前後へ振る角（正で前） */
  swing: [number, number];
  /** 頭の傾き */
  head: number;
  /** 頭の振り向き（正で +X 側へ） */
  turn: number;
  /** 上体の前後の傾き */
  lean: number;
  /** 上体のひねり */
  twist: number;
}

/** 姿勢の候補。差は大きすぎない。「別の像に置き換わった」ではなく「そうだったはず」に見せる */
const POSES: readonly Pose[] = [
  { arms: [0.12, 0.12], swing: [0, 0], head: 0, turn: 0, lean: 0, twist: 0 },
  { arms: [0.62, 0.14], swing: [0.35, -0.05], head: 0.16, turn: -0.32, lean: 0.05, twist: 0.12 },
  { arms: [0.18, 0.8], swing: [-0.1, 0.5], head: -0.12, turn: 0.3, lean: -0.04, twist: -0.14 },
  { arms: [1.05, 1.05], swing: [0.12, 0.12], head: 0.26, turn: 0, lean: 0.08, twist: 0 },
  { arms: [0.3, 0.5], swing: [-0.22, 0.3], head: -0.2, turn: 0.16, lean: 0.06, twist: 0.08 },
];

interface Statue {
  group: THREE.Group;
  /** 腰から上。ここで前後に曲がり、ひねる */
  upperBody: THREE.Group;
  head: THREE.Object3D;
  /** 回すのは肩。腕はその子として付いてくる */
  arms: [THREE.Object3D, THREE.Object3D];
  /** 現在の立ち位置（0..COUNT-1） */
  slot: number;
  pose: number;
  yaw: number;
  /** 初期状態。タネあかしのゴーストと「変わったか」の判定に使う */
  initial: { slot: number; pose: number; yaw: number };
}

/** 立ち位置。中庭の各面の正面に 1 体ずつ置く */
function slotPosition(slot: number): THREE.Vector3 {
  const angle = slotFacing(slot);
  return new THREE.Vector3(Math.sin(angle) * RING_RADIUS, 0, Math.cos(angle) * RING_RADIUS);
}

/** 台座の中心から外側を向く角度 */
function slotFacing(slot: number): number {
  return (slot / COUNT) * TAU;
}

/**
 * 中庭（12 角柱）の角。当たり判定の多角形に使う。
 * 面の中心を各 slot の正面に合わせたいので、角は半目盛ぶんずらす。
 */
function coreCorner(index: number): THREE.Vector3 {
  const angle = ((index + 0.5) / COUNT) * TAU;
  return new THREE.Vector3(Math.sin(angle) * CORE_RADIUS, 0, Math.cos(angle) * CORE_RADIUS);
}

/** 中庭の面までの距離（角ではなく面の中心まで） */
const CORE_FACE_DISTANCE = CORE_RADIUS * Math.cos(Math.PI / COUNT);

interface StatueParts extends FigureGeometry {
  plinth: THREE.BufferGeometry;
}

function createParts(): StatueParts {
  return {
    plinth: new THREE.CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS + 0.04, PLINTH_HEIGHT, 16),
    ...createFigureGeometry(),
  };
}

/** 1 体ぶんの彫像を組む。ジオメトリとマテリアルは全体で共有する */
function createStatue(
  parts: StatueParts,
  material: THREE.Material,
  plinthMaterial: THREE.Material,
): Omit<Statue, 'slot' | 'pose' | 'yaw' | 'initial'> {
  const group = new THREE.Group();

  const plinth = new THREE.Mesh(parts.plinth, plinthMaterial);
  plinth.position.y = PLINTH_HEIGHT / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const figure = assembleFigure(parts, material);
  figure.root.position.y = PLINTH_HEIGHT;
  group.add(figure.root);

  return { group, upperBody: figure.upperBody, head: figure.head, arms: figure.arms };
}

/*
 * --- 床の誘導矢印 -----------------------------------------------------------
 *
 * この展示は「一周する」ことが成立条件になっている（回り込まないと
 * 反対側が視錐台から出ず、変えられる個体が生まれない）。だが回廊に入った
 * 来館者には、まわりを歩けとはどこにも書いていない。矢印はその導線だけを
 * 伝える。ネタは一切明かさない（ROOM_D §5: 予告した時点で錯視は死ぬ）。
 *
 * 光は矢印の向きへ流れる。12 枚を 1 メッシュに焼き、点灯の位相は
 * 頂点属性 aPhase で配る（12 個のマテリアルを持たないため）。
 */
const GUIDE_VERT = /* glsl */ `
attribute float aPhase;
varying float vPhase;
void main() {
  vPhase = aPhase;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/*
 * head: 進行方向へ流れる光。位相をずらしてあるので矢印が指す順に灯る。
 * 0.14 の下駄は消灯時の下限。光が来るまで真っ暗だと、線が道に見えない。
 */
const GUIDE_FRAG = /* glsl */ `
precision highp float;
varying float vPhase;
uniform float uTime;
uniform float uFade;
uniform vec3 uColor;

void main() {
  float t = fract(uTime * 0.3 - vPhase);
  float head = smoothstep(0.0, 0.10, t) * smoothstep(0.42, 0.10, t);
  float alpha = (0.14 + head * 0.5) * uFade;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}`;

/** 矢印 1 枚。先端は +Z（進行方向）を向く */
function createGuideArrow(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // 先端を -Y に描く。rotateX(-90°) で -Y が +Z に移る
  shape.moveTo(-0.18, 0.08);
  shape.lineTo(0, -0.21);
  shape.lineTo(0.18, 0.08);
  shape.lineTo(0.18, 0.23);
  shape.lineTo(0, -0.06);
  shape.lineTo(-0.18, 0.23);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** 矢印を輪に並べて 1 枚のジオメトリにする。並ぶ向きは角度が増える方向 */
function createGuideRing(): THREE.BufferGeometry {
  const arrow = createGuideArrow();
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < GUIDE_COUNT; i++) {
    // 彫像の正面（slot）とはずらす。台座の真ん前に置くと像の足元と重なる
    const angle = ((i + 0.5) / GUIDE_COUNT) * TAU;
    const piece = arrow.clone();
    // 接線方向へ向ける。+Z を (cos a, -sin a) に合わせる回転
    piece.rotateY(angle + Math.PI / 2);
    piece.translate(Math.sin(angle) * GUIDE_RADIUS, 0.014, Math.cos(angle) * GUIDE_RADIUS);
    const phase = new Float32Array(piece.attributes.position!.count).fill(i / GUIDE_COUNT);
    piece.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    pieces.push(piece);
  }
  arrow.dispose();
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('behindYou: failed to merge guide arrows');
  return merged;
}

function applyPose(statue: Statue): void {
  const pose = POSES[statue.pose]!;
  statue.group.position.copy(slotPosition(statue.slot));
  statue.group.rotation.y = statue.yaw;
  statue.upperBody.rotation.set(pose.lean, pose.twist, 0);
  statue.head.rotation.set(0, pose.turn, pose.head);
  // 肩は左右で符号が逆。正の値をどちらも「外へ開く」に揃える
  statue.arms[0].rotation.set(-pose.swing[0], 0, -pose.arms[0]);
  statue.arms[1].rotation.set(-pose.swing[1], 0, pose.arms[1]);
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);

  // --- 中庭（遮蔽物）--------------------------------------------------------
  const coreGeometry = new THREE.CylinderGeometry(CORE_RADIUS, CORE_RADIUS, CORE_HEIGHT, COUNT);
  // 側面はほぼ環境光しか当たらない。棟の壁と同じくらいの明度にしておかないと、
  // 回廊の中央に黒い塊が立っているだけに見える
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4d56, roughness: 0.94 });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.position.y = CORE_HEIGHT / 2;
  // 面の中心を彫像の正面に合わせる（角が正面に来ると板も像も座りが悪い）
  core.rotation.y = Math.PI / COUNT;
  core.castShadow = true;
  core.receiveShadow = true;
  root.add(core);

  // 中庭の当たり判定。12 角形の辺をそのまま線分にする
  const id = ctx.definition.id;
  for (let i = 0; i < COUNT; i++) {
    const a = coreCorner(i).add(origin);
    const b = coreCorner(i + 1).add(origin);
    ctx.collision.addSegment(a.x, a.z, b.x, b.z, 0.2, id);
  }

  // --- 床の誘導矢印 ---------------------------------------------------------
  const guideGeometry = createGuideRing();
  const guideMaterial = new THREE.ShaderMaterial({
    vertexShader: GUIDE_VERT,
    fragmentShader: GUIDE_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 0 },
      // 床のマーカーは館内で色を揃える（ViewSpot と同じ）
      uColor: { value: new THREE.Color(0x6fd2b0) },
    },
  });
  const guide = new THREE.Mesh(guideGeometry, guideMaterial);
  guide.renderOrder = 2;
  // 回廊に入るまでは描かない（uFade=0 でも板は描画に乗る）
  guide.visible = false;
  root.add(guide);

  // --- 彫像 -----------------------------------------------------------------
  const parts = createParts();
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.88 });
  const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.9 });
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd2b0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  ghostMaterial.toneMapped = false;

  const statues: Statue[] = [];
  const ghosts: THREE.Group[] = [];
  const targets: VisibilityTarget[] = [];
  for (let i = 0; i < COUNT; i++) {
    const base = createStatue(parts, stoneMaterial, plinthMaterial);
    const statue: Statue = {
      ...base,
      slot: i,
      // 初期の姿勢は個体ごとにばらしておく。全部同じだと変化が目立ちすぎる
      pose: i % POSES.length,
      yaw: slotFacing(i),
      initial: { slot: i, pose: i % POSES.length, yaw: slotFacing(i) },
    };
    applyPose(statue);
    root.add(statue.group);
    statues.push(statue);

    // タネあかし用のゴースト。初期状態のまま固定して、変化した個体にだけ出す
    const ghostBase = createStatue(parts, ghostMaterial, ghostMaterial);
    const ghost: Statue = {
      ...ghostBase,
      slot: i,
      pose: statue.pose,
      yaw: statue.yaw,
      initial: statue.initial,
    };
    applyPose(ghost);
    ghost.group.visible = false;
    root.add(ghost.group);
    ghosts.push(ghost.group);

    targets.push({
      position: slotPosition(i)
        .add(origin)
        .setY(PLINTH_HEIGHT + 0.4),
      radius: 0.45,
    });
  }

  const tracker = new VisibilityTracker(ctx.camera, targets, {
    gazeAngle: 20,
    gazeSeconds: 0.3,
    memorySeconds: GAZE_MEMORY,
    maxDistance: ZONE_HALF * 2.4,
    occluders: [core],
  });

  // --- 集計プレート ---------------------------------------------------------
  // 回廊を一周し終えた来館者に、初めて数字を見せる。
  // 先に予告すると錯視が成立しない（ROOM_D §5）ので、板は伏せておく
  const plate: TextPlate = createTextPlate({
    width: 1.6,
    height: 0.44,
    frame: true,
    align: 'center',
    scale: 1.15,
  });
  // 中庭の、入口（棟の北側）を向いた面に貼る
  plate.root.position.set(0, 1.75, CORE_FACE_DISTANCE + 0.03);
  plate.root.visible = false;
  root.add(plate.root);

  const removeSpot = ctx.lighting.addSpot({
    // 真上からだと彫像も中庭も陰影が付かず、のっぺりした置物に見える。
    // 入口側（北東）へ振って斜光にし、影の向きも読めるようにする
    position: origin.clone().add(new THREE.Vector3(2.6, 5.0, 2.6)),
    target: origin.clone().add(new THREE.Vector3(0, 1, 0)),
    color: 0xf1e8d8,
    intensity: 14,
    angle: 0.66,
    penumbra: 0.7,
    distance: 14,
    shadow: true,
  });

  let inZone = false;
  let sinceChange = 0;
  let lapAngle = 0;
  let lastAngle: number | null = null;
  let lapDone = false;
  let content: HintContent | null = null;
  let revealProgress = 0;
  let guideFade = 0;

  const changedCount = (): number =>
    statues.filter(
      (s) =>
        s.slot !== s.initial.slot ||
        s.pose !== s.initial.pose ||
        Math.abs(shortestAngleDelta(s.yaw, s.initial.yaw)) > 1e-3,
    ).length;

  const refreshPlate = (): void => {
    if (!content?.counter) {
      plate.root.visible = false;
      return;
    }
    const text = content.counter
      .replace('{total}', String(COUNT))
      .replace('{count}', String(changedCount()));
    plate.setLines([{ text, weight: 'title' }]);
  };

  /** 見られていない個体を 1 体だけ変える。変化は代入のみ（1 フレーム完了） */
  const applyChange = (): boolean => {
    const free: number[] = [];
    for (let i = 0; i < statues.length; i++) {
      if (tracker.isUnobserved(i, GAZE_MEMORY)) free.push(i);
    }
    if (free.length === 0) return false;

    const pick = free[Math.floor(Math.random() * free.length)]!;
    const statue = statues[pick]!;
    // 入れ替えは相手も見られていないときだけ。片方が見えていると瞬間移動になる
    const partner = free.find((i) => i !== pick && isNeighbour(statues[i]!.slot, statue.slot));
    const roll = Math.random();

    if (partner !== undefined && roll < 0.3) {
      const other = statues[partner]!;
      const slot = statue.slot;
      statue.slot = other.slot;
      other.slot = slot;
      applyPose(statue);
      applyPose(other);
      return true;
    }
    if (roll < 0.65) {
      statue.yaw += (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.9);
    } else {
      let next = Math.floor(Math.random() * POSES.length);
      if (next === statue.pose) next = (next + 1) % POSES.length;
      statue.pose = next;
    }
    applyPose(statue);
    return true;
  };

  return {
    root,
    setLocale(next) {
      content = next;
      if (plate.root.visible) refreshPlate();
    },
    onZoneEnter() {
      inZone = true;
      sinceChange = 0;
      lastAngle = null;
    },
    onZoneExit() {
      inZone = false;
    },
    update(dt, elapsed) {
      // 入れ替えで立ち位置が変わるので、判定用の球も追従させる
      for (let i = 0; i < statues.length; i++) {
        targets[i]!.position.copy(slotPosition(statues[i]!.slot))
          .add(origin)
          .setY(PLINTH_HEIGHT + 0.4);
      }
      tracker.update(dt);

      /*
       * 誘導は回廊に入ってから出す。遠くから見えていると
       * 「順路の床サイン」として読み流され、入ってからは目に入らない。
       * 一周し終えた（またはタネが割れた）ら役目は終わり。数字を読む場面で
       * 足元が光っていると、そちらへ目が行く。
       * ゾーンの外でも減衰させたいので、inZone の判定より前に置くこと。
       */
      const guideOn = inZone && !lapDone && revealProgress < 0.01;
      guideFade += (Number(guideOn) - guideFade) * damp(2.5, dt);
      guideMaterial.uniforms.uTime!.value = elapsed;
      guideMaterial.uniforms.uFade!.value = guideFade;
      guide.visible = guideFade > 0.002;

      if (!inZone) return;

      // 一周したか。中庭を軸にした回り込みの角度を積む
      const angle = Math.atan2(ctx.camera.position.x - origin.x, ctx.camera.position.z - origin.z);
      if (lastAngle !== null) lapAngle += shortestAngleDelta(lastAngle, angle);
      lastAngle = angle;
      if (!lapDone && Math.abs(lapAngle) >= TAU * 0.92) {
        lapDone = true;
        plate.root.visible = true;
        refreshPlate();
      }

      sinceChange += dt;
      if (sinceChange >= CHANGE_INTERVAL && applyChange()) {
        sinceChange = 0;
        if (lapDone) refreshPlate();
      }
    },
    setRevealed(revealed, progress) {
      revealProgress = progress;
      ghostMaterial.opacity = progress * 0.42;
      for (let i = 0; i < statues.length; i++) {
        const statue = statues[i]!;
        const changed =
          statue.slot !== statue.initial.slot ||
          statue.pose !== statue.initial.pose ||
          Math.abs(shortestAngleDelta(statue.yaw, statue.initial.yaw)) > 1e-3;
        ghosts[i]!.visible = changed && revealProgress > 0.01;
      }
      if (revealed) {
        plate.root.visible = true;
        refreshPlate();
      }
    },
    dispose() {
      removeSpot();
      plate.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      guideGeometry.dispose();
      guideMaterial.dispose();
      stoneMaterial.dispose();
      plinthMaterial.dispose();
      ghostMaterial.dispose();
      for (const geometry of Object.values(parts)) geometry.dispose();
    },
  };
}

/** 隣り合った立ち位置か（環状なので端どうしも隣） */
function isNeighbour(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff === 1 || diff === COUNT - 1;
}

export const behindYou: ExhibitDefinition = {
  id: 'behindYou',
  textKey: 'behindYou',
  room: 'opus',
  kind: 'zone',
  order: 22,
  // タネあかしは展示側（初期状態のゴースト）。カメラは動かさない
  reveal: 'none',
  position: POSITION,
  rotationY: 0,
  zone: {
    min: { x: POSITION.x - ZONE_HALF, y: -1, z: POSITION.z - ZONE_HALF },
    max: { x: POSITION.x + ZONE_HALF, y: 3, z: POSITION.z + ZONE_HALF },
  },
  // 中庭と彫像の輪。回廊そのものは歩くための場所なので占有には含めない
  footprint: footprintAround(POSITION.x, POSITION.z, RING_RADIUS + PLINTH_RADIUS + 0.35),
  build,
};

export const BEHIND_YOU_LAYOUT = {
  position: POSITION,
  count: COUNT,
  ringRadius: RING_RADIUS,
  coreRadius: CORE_RADIUS,
  zoneHalf: ZONE_HALF,
};
