import * as THREE from 'three';
import { pedestal } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * D4「聞こえる衝突」/ Audible Collision（ROOM_D §1）。
 *
 * ★ 成立条件: **時間**と**音**。
 *   2 つの球が斜めの軌道で近づき、重なり、離れていく。
 *   無音では「すれ違い」にしか見えない。重なる瞬間にクリック音が鳴ると、
 *   同じ映像のまま「衝突して跳ね返った」ように見える。
 *
 * 音の有無を来館者自身が握れることが構成の要点なので、
 * 台の上の物理ボタンで切り替える（interactTextKey で決定キー／タッチボタンに出る）。
 */

const TABLE_HEIGHT = 0.8;
const TRACK = 0.62;
const PERIOD = 2.6;
const BALL_RADIUS = 0.075;
const VIEW_DISTANCE = 2.0;
const POSITION = { x: 7, y: 0, z: -24 };

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, TABLE_HEIGHT, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x191b21, roughness: 0.9 }),
  );
  table.position.y = TABLE_HEIGHT / 2;
  table.castShadow = true;
  table.receiveShadow = true;
  root.add(table);

  // 軌道の背景。動きが読みやすいよう、盤面をわずかに明るくする
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.02, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.95 }),
  );
  board.position.y = TABLE_HEIGHT + 0.01;
  board.receiveShadow = true;
  root.add(board);

  const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 24, 18);
  const balls: THREE.Mesh[] = [];
  for (const color of [0xe4e0d6, 0xe4e0d6]) {
    const mesh = new THREE.Mesh(
      ballGeometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 }),
    );
    mesh.castShadow = true;
    balls.push(mesh);
    root.add(mesh);
  }

  // タネあかし用の軌跡。片方だけに出すと「常にすれ違っている」ことが一目で分かる
  const trail = new THREE.Mesh(
    new THREE.BoxGeometry(TRACK * 2, 0.012, 0.012),
    new THREE.MeshBasicMaterial({ color: 0x6fd2b0, transparent: true, opacity: 0 }),
  );
  trail.material.toneMapped = false;
  trail.position.set(0, TABLE_HEIGHT + 0.03, 0);
  trail.rotation.y = Math.atan2(TRACK, TRACK);
  trail.visible = false;
  root.add(trail);

  // --- 物理ボタン ---------------------------------------------------------
  const buttonBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.095, 0.03, 20),
    new THREE.MeshStandardMaterial({ color: 0x24272f, roughness: 0.8 }),
  );
  buttonBase.position.set(0.6, TABLE_HEIGHT + 0.015, 0.26);
  root.add(buttonBase);

  const buttonMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a3b2c,
    roughness: 0.5,
    emissive: 0x000000,
  });
  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.045, 20),
    buttonMaterial,
  );
  const buttonHome = new THREE.Vector3(0.6, TABLE_HEIGHT + 0.05, 0.26);
  button.position.copy(buttonHome);
  button.castShadow = true;
  root.add(button);

  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(0, 2.6, 0.5)),
    target: origin.clone().add(new THREE.Vector3(0, TABLE_HEIGHT, 0)),
    color: 0xfff2e0,
    intensity: 18,
    angle: 0.5,
    penumbra: 0.5,
    distance: 8,
    shadow: true,
  });

  let soundOn = false;
  let press = 0;
  let phase = 0;
  /** 直前フレームの位相。重なりの瞬間をまたいだかを見る */
  let previousPhase = 0;
  let revealProgress = 0;

  return {
    root,
    onInteract() {
      soundOn = !soundOn;
      press = 1;
      // autoplay ポリシー: ユーザー操作のこの瞬間に解禁する
      if (soundOn) void ctx.audio.resume();
    },
    update(dt) {
      phase = (phase + dt / PERIOD) % 1;
      // 0 → 1 で左上→右下、もう一方は右上→左下。中央（0.5）で重なる
      const t = phase * 2 - 1;
      balls[0]!.position.set(t * TRACK, TABLE_HEIGHT + BALL_RADIUS + 0.02, t * TRACK * 0.42);
      balls[1]!.position.set(-t * TRACK, TABLE_HEIGHT + BALL_RADIUS + 0.02, t * TRACK * 0.42);

      // 重なる瞬間をまたいだらクリックを鳴らす
      if (soundOn && previousPhase < 0.5 && phase >= 0.5) ctx.audio.click(0.35);
      previousPhase = phase;

      press = Math.max(0, press - dt * 4);
      button.position.y = buttonHome.y - press * 0.02;
      buttonMaterial.emissive.setHex(soundOn ? 0x4a1108 : 0x000000);
      buttonMaterial.emissiveIntensity = soundOn ? 1 : 0;

      if (revealProgress > 0.001) {
        trail.position.set(0, TABLE_HEIGHT + 0.03, 0);
      }
    },
    setRevealed(_revealed, progress) {
      revealProgress = progress;
      trail.visible = progress > 0.001;
      (trail.material as THREE.MeshBasicMaterial).opacity = progress * 0.9;
      // 片方だけ色を変え、どちらの球がどちらへ抜けたかを追えるようにする
      (balls[0]!.material as THREE.MeshStandardMaterial).color.setHex(
        progress > 0.4 ? 0x6fd2b0 : 0xe4e0d6,
      );
    },
    dispose() {
      removeSpot();
      ballGeometry.dispose();
      for (const ball of balls) (ball.material as THREE.Material).dispose();
      table.geometry.dispose();
      (table.material as THREE.Material).dispose();
      board.geometry.dispose();
      (board.material as THREE.Material).dispose();
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
      buttonBase.geometry.dispose();
      (buttonBase.material as THREE.Material).dispose();
      button.geometry.dispose();
      buttonMaterial.dispose();
    },
  };
}

export const audibleCollision: ExhibitDefinition = {
  id: 'audibleCollision',
  textKey: 'audibleCollision',
  room: 'opus',
  kind: 'object',
  order: 21,
  reveal: 'measure',
  interactTextKey: 'audioEnable',
  ...pedestal({
    x: POSITION.x,
    z: POSITION.z,
    dirY: 0,
    viewDistance: VIEW_DISTANCE,
    targetHeight: TABLE_HEIGHT + 0.1,
    // 1.7 × 0.9m の机
    halfX: 0.85,
    halfZ: 0.45,
    fov: 44,
    radius: 1.1,
  }),
  position: POSITION,
  build,
};
