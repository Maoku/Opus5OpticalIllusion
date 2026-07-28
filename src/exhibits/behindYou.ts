import * as THREE from 'three';
import { TAU, shortestAngleDelta } from '../utils/math';
import { createTextPlate, type TextPlate } from '../world/TextPlate';
import { VisibilityTracker, type VisibilityTarget } from './common/VisibilityTracker';
import { footprintAround } from './common/placement';
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

/** 変化を試みる間隔（秒）。速すぎると「見ていない隙」に間に合わない */
const CHANGE_INTERVAL = 2.4;
/** 直近これだけの秒数に注視された個体は触らない */
const GAZE_MEMORY = 2.0;

interface Pose {
  /** 腕の開き（ラジアン） */
  arms: [number, number];
  /** 頭の傾き */
  head: number;
  /** 上体の傾き */
  lean: number;
}

/** 姿勢の候補。差は大きすぎない。「別の像に置き換わった」ではなく「そうだったはず」に見せる */
const POSES: readonly Pose[] = [
  { arms: [0.15, 0.15], head: 0, lean: 0 },
  { arms: [0.9, 0.12], head: 0.18, lean: 0.06 },
  { arms: [0.2, 1.15], head: -0.14, lean: -0.05 },
  { arms: [1.35, 1.35], head: 0.3, lean: 0.1 },
  { arms: [0.45, 0.7], head: -0.25, lean: 0.03 },
];

interface Statue {
  group: THREE.Group;
  torso: THREE.Group;
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

interface StatueParts {
  plinth: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
}

function createParts(): StatueParts {
  return {
    plinth: new THREE.CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS + 0.04, PLINTH_HEIGHT, 16),
    torso: new THREE.CylinderGeometry(0.1, 0.15, 0.52, 14),
    head: new THREE.SphereGeometry(0.085, 16, 12),
    arm: new THREE.BoxGeometry(0.045, 0.3, 0.045),
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

  const torso = new THREE.Group();
  torso.position.y = PLINTH_HEIGHT;
  group.add(torso);

  const body = new THREE.Mesh(parts.torso, material);
  body.position.y = 0.26;
  body.castShadow = true;
  torso.add(body);

  const head = new THREE.Mesh(parts.head, material);
  head.position.y = 0.61;
  head.castShadow = true;
  torso.add(head);

  // 肩を回転の中心にしたいので、腕は下端が肩に来る入れ子にする
  const shoulders: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.12, 0.46, 0);
    const arm = new THREE.Mesh(parts.arm, material);
    arm.position.y = -0.15;
    arm.castShadow = true;
    shoulder.add(arm);
    torso.add(shoulder);
    shoulders.push(shoulder);
  }

  return { group, torso, head, arms: [shoulders[0]!, shoulders[1]!] };
}

function applyPose(statue: Statue): void {
  const pose = POSES[statue.pose]!;
  statue.group.position.copy(slotPosition(statue.slot));
  statue.group.rotation.y = statue.yaw;
  statue.torso.rotation.x = pose.lean;
  statue.head.rotation.z = pose.head;
  statue.arms[0].rotation.z = pose.arms[0];
  statue.arms[1].rotation.z = -pose.arms[1];
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
    update(dt) {
      // 入れ替えで立ち位置が変わるので、判定用の球も追従させる
      for (let i = 0; i < statues.length; i++) {
        targets[i]!.position.copy(slotPosition(statues[i]!.slot))
          .add(origin)
          .setY(PLINTH_HEIGHT + 0.4);
      }
      tracker.update(dt);
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
