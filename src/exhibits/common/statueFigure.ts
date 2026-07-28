import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 小さな人体彫像のジオメトリと骨組み。
 *
 * D3「後ろの正面」の彫像に使う。円柱と球の組み合わせでは
 * 「向きが変わった」ことが読めない（正面と背面が同じ形だった）ので、
 * 顔・肩・脚を持った人体像にしてある。向きの手掛かりは
 * 鼻・つま先・肩幅の 3 つ。
 *
 * ★ 描画コストの都合で、部位は 4 つのジオメトリに焼き込んである。
 *   可動部（腰・首・肩）だけを Object3D の入れ子で残し、
 *   それ以外（脚・胴・頭・腕）は mergeGeometries で 1 メッシュに潰す。
 *   彫像 12 体＋タネあかしのゴースト 12 体ぶんが同じジオメトリを共有する。
 *
 * 座標系: 原点は足の裏。正面は +Z。
 */

/** 各部位の基準高さ（足の裏から）。ポーズ側もこの値を前提にしている */
export const FIGURE = {
  /** 頭頂までのおよその高さ */
  height: 0.74,
  /** 上体が曲がる位置（腰） */
  waistY: 0.4,
  /** 肩の関節 */
  shoulderY: 0.575,
  /** 首が回る位置（頭の付け根） */
  neckY: 0.645,
  /** 肩の関節の左右の振り幅 */
  shoulderX: 0.066,
} as const;

export interface FigureGeometry {
  /** 骨盤から下（動かない） */
  legs: THREE.BufferGeometry;
  /** 腰から上。原点は腰 */
  torso: THREE.BufferGeometry;
  /** 頭。原点は首の付け根 */
  head: THREE.BufferGeometry;
  /** 片腕。原点は肩の関節。左右で共用する */
  arm: THREE.BufferGeometry;
}

export interface FigureRig {
  /** 足の裏が原点のルート */
  root: THREE.Group;
  /** 腰で曲がる上体。rotation.x = 前後、rotation.y = ひねり */
  upperBody: THREE.Group;
  /** 頭。rotation.z = 傾け、rotation.y = 振り向き */
  head: THREE.Object3D;
  /** 肩。[0] が -X 側、[1] が +X 側 */
  arms: [THREE.Object3D, THREE.Object3D];
}

/** 回転体。profile は [半径, 高さ]。depth で前後を潰して楕円断面にする */
function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
  depth: number,
): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
  geometry.scale(1, 1, depth);
  return geometry;
}

interface Placement {
  pos: [number, number, number];
  /** 回転（ラジアン）。順に X → Y → Z */
  rot?: [number, number, number];
  scale?: [number, number, number];
}

function place(geometry: THREE.BufferGeometry, at: Placement): THREE.BufferGeometry {
  if (at.scale) geometry.scale(at.scale[0], at.scale[1], at.scale[2]);
  if (at.rot) {
    geometry.rotateX(at.rot[0]);
    geometry.rotateY(at.rot[1]);
    geometry.rotateZ(at.rot[2]);
  }
  geometry.translate(at.pos[0], at.pos[1], at.pos[2]);
  return geometry;
}

/** 部位をひとつのジオメトリに潰す。元のジオメトリは捨てる */
function fuse(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('statueFigure: failed to merge geometry');
  merged.computeBoundingSphere();
  return merged;
}

/** 骨盤・太もも・すね・足。腰から下は動かないので丸ごと 1 枚にする */
function createLegs(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [
    // 骨盤。上端は胴より細くして中に隠す。太いままだと腰に段差が出て、
    // 人体ではなく「下着を履いた人形」に見える
    lathe(
      [
        [0, 0.292],
        [0.055, 0.297],
        [0.074, 0.316],
        [0.077, 0.345],
        [0.068, 0.382],
        [0.05, 0.416],
        [0, 0.42],
      ],
      12,
      0.76,
    ),
  ];
  for (const side of [-1, 1]) {
    const x = side * 0.038;
    pieces.push(
      place(new THREE.CylinderGeometry(0.048, 0.032, 0.175, 10), {
        pos: [x, 0.245, 0],
        rot: [0, 0, side * -0.02],
      }),
      place(new THREE.SphereGeometry(0.03, 10, 6), { pos: [x, 0.165, 0] }),
      place(new THREE.CylinderGeometry(0.031, 0.019, 0.16, 10), { pos: [x, 0.088, 0.004] }),
      // くるぶし。すねと足の継ぎ目を隠す
      place(new THREE.SphereGeometry(0.02, 8, 6), { pos: [x, 0.022, 0] }),
      // つま先を少し外へ開くと、正面がどちらか読める
      place(new THREE.BoxGeometry(0.05, 0.026, 0.115), {
        pos: [side * 0.041, 0.013, 0.022],
        rot: [0, side * 0.11, 0],
      }),
    );
  }
  return fuse(pieces);
}

/** 胴と首と三角筋。原点を腰に置く（ここで曲がる） */
function createTorso(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [
    lathe(
      [
        [0, 0.355],
        [0.068, 0.36],
        [0.064, 0.392],
        [0.058, 0.424],
        [0.066, 0.462],
        [0.075, 0.505],
        [0.078, 0.54],
        [0.072, 0.568],
        [0.052, 0.592],
        [0.032, 0.606],
        [0, 0.61],
      ],
      14,
      0.7,
    ),
    // 首。胴とは別に立てる（回転体ごと潰すと首まで扁平になる）
    place(new THREE.CylinderGeometry(0.029, 0.034, 0.078, 8), { pos: [0, 0.604, -0.002] }),
  ];
  for (const side of [-1, 1]) {
    // 三角筋。腕が回っても肩の丸みは残したいので、胴側に付ける。
    // 腕側の上端はここより細くしてあり、球はひとつしか出ない
    pieces.push(
      place(new THREE.SphereGeometry(0.031, 10, 8), {
        pos: [side * FIGURE.shoulderX, FIGURE.shoulderY - 0.004, 0],
        scale: [1, 0.92, 1],
      }),
    );
  }
  const merged = fuse(pieces);
  merged.translate(0, -FIGURE.waistY, 0);
  return merged;
}

/**
 * 頭。原点は首の付け根。
 * 鼻を付けてあるのは造形のためではなく、**向きの手掛かり**として要る。
 */
function createHead(): THREE.BufferGeometry {
  const y = FIGURE.neckY;
  const pieces = [
    // 頭蓋
    place(new THREE.SphereGeometry(0.049, 14, 10), {
      pos: [0, y + 0.045, 0.002],
      scale: [0.88, 1, 0.95],
    }),
    // 顎。頭蓋の下半分を細く見せる
    place(new THREE.SphereGeometry(0.04, 10, 8), {
      pos: [0, y + 0.012, 0.008],
      scale: [0.82, 0.62, 0.88],
    }),
    // 髪。後頭部だけを膨らませる。頭蓋より外へ出すと縁が線に見えて、
    // 髪ではなく被り物になる（前方は 0.98 倍で頭蓋の内側に沈めてある）
    place(new THREE.SphereGeometry(0.049, 12, 8), {
      pos: [0, y + 0.049, -0.008],
      scale: [0.88, 0.86, 0.98],
    }),
    // 鼻
    place(new THREE.ConeGeometry(0.011, 0.03, 6), {
      pos: [0, y + 0.036, 0.041],
      rot: [1.35, 0, 0],
    }),
  ];
  for (const side of [-1, 1]) {
    pieces.push(
      place(new THREE.SphereGeometry(0.013, 6, 4), {
        pos: [side * 0.04, y + 0.036, 0.002],
        scale: [0.5, 1, 0.75],
      }),
    );
  }
  const merged = fuse(pieces);
  merged.translate(0, -FIGURE.neckY, 0);
  return merged;
}

/**
 * 片腕。原点は肩の関節、真下に垂らした状態。
 * 肘は前へ 0.22rad だけ焼き込んである（左右対称なので 1 本を使い回せる）。
 */
function createArm(): THREE.BufferGeometry {
  const elbow = -0.158;
  const bend = 0.22;
  const forearm = 0.145;
  const dirY = -Math.cos(bend);
  const dirZ = Math.sin(bend);
  return fuse([
    // 上端は三角筋（胴側）より細い。ここを太くすると肩に球がふたつ並ぶ
    place(new THREE.CylinderGeometry(0.025, 0.023, 0.165, 8), { pos: [0, -0.076, 0] }),
    place(new THREE.SphereGeometry(0.022, 8, 6), { pos: [0, elbow, 0] }),
    place(new THREE.CylinderGeometry(0.022, 0.016, forearm, 8), {
      pos: [0, elbow + dirY * forearm * 0.5, dirZ * forearm * 0.5],
      rot: [-bend, 0, 0],
    }),
    place(new THREE.SphereGeometry(0.021, 8, 6), {
      pos: [0, elbow + dirY * forearm - 0.006, dirZ * forearm + 0.004],
      rot: [-bend, 0, 0],
      scale: [0.8, 1.15, 0.55],
    }),
  ]);
}

export function createFigureGeometry(): FigureGeometry {
  return {
    legs: createLegs(),
    torso: createTorso(),
    head: createHead(),
    arm: createArm(),
  };
}

/** ジオメトリから 1 体ぶんの骨組みを作る。マテリアルは呼び出し側で共有する */
export function assembleFigure(geometry: FigureGeometry, material: THREE.Material): FigureRig {
  const root = new THREE.Group();

  const legs = new THREE.Mesh(geometry.legs, material);
  legs.castShadow = true;
  legs.receiveShadow = true;
  root.add(legs);

  const upperBody = new THREE.Group();
  upperBody.position.y = FIGURE.waistY;
  root.add(upperBody);

  const torso = new THREE.Mesh(geometry.torso, material);
  torso.castShadow = true;
  torso.receiveShadow = true;
  upperBody.add(torso);

  const head = new THREE.Mesh(geometry.head, material);
  head.position.y = FIGURE.neckY - FIGURE.waistY;
  head.castShadow = true;
  upperBody.add(head);

  const shoulders: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * FIGURE.shoulderX, FIGURE.shoulderY - FIGURE.waistY, 0);
    const arm = new THREE.Mesh(geometry.arm, material);
    arm.castShadow = true;
    shoulder.add(arm);
    upperBody.add(shoulder);
    shoulders.push(shoulder);
  }

  return { root, upperBody, head, arms: [shoulders[0]!, shoulders[1]!] };
}
