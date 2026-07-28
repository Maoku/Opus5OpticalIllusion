// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { stubCanvas2D } from './helpers/canvas';
import { Assets } from '../src/core/Assets';
import { AudioBus } from '../src/core/AudioBus';
import { Quality } from '../src/core/Quality';
import type { SceneHost } from '../src/core/SceneHost';
import { emptyInputState } from '../src/core/input/types';
import { ExhibitManager } from '../src/exhibits/ExhibitManager';
import { shrinkingRoom } from '../src/exhibits/shrinkingRoom';
import { DEFAULT_EYE_HEIGHT, PlayerController } from '../src/player/PlayerController';
import { ViewpointController } from '../src/viewpoint/ViewpointController';
import { Collision } from '../src/world/Collision';
import { Lighting } from '../src/world/Lighting';

/** 廊下の内側 / 外側の座標 */
const INSIDE = { x: 0, z: -33 };
/** 廊下の入口ぎわ。ここから奥へ歩かせる */
const MOUTH = { x: 0, z: -28 };
const OUTSIDE = { x: 0, z: -22 };

interface Harness {
  player: PlayerController;
  exhibits: ExhibitManager;
  collision: Collision;
  /** 立ち止まったまま時間を送る */
  step(seconds: number): void;
  /** 前へ歩きながら時間を送る。1.0 はダッシュ判定になるので 0.8 で歩く */
  walk(seconds: number, magnitude?: number): void;
}

async function makeHarness(): Promise<Harness> {
  stubCanvas2D();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.05, 200);
  const quality = new Quality('high');
  const host: SceneHost = {
    scene,
    camera,
    assets: new Assets('/'),
    quality,
    elapsed: 0,
    renderCamera: camera,
  };
  const collision = new Collision();
  const player = new PlayerController(camera, collision);
  const viewpoint = new ViewpointController(host, player);
  const lighting = new Lighting(scene, quality);
  const exhibits = new ExhibitManager(host, lighting, player, viewpoint, collision, new AudioBus());
  await exhibits.add(shrinkingRoom);
  return {
    player,
    exhibits,
    collision,
    step(seconds) {
      const dt = 1 / 60;
      const input = emptyInputState();
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        player.update(dt, input);
        exhibits.update(dt, i * dt);
      }
    },
    walk(seconds, magnitude = 0.8) {
      const dt = 1 / 60;
      const input = emptyInputState();
      // yaw 0 のとき move.y が前（-z）。廊下は -z 方向へ伸びている
      input.move = { x: 0, y: magnitude };
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        player.update(dt, input);
        exhibits.update(dt, i * dt);
      }
    },
  };
}

describe('D2 縮んでいく部屋', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('drifts the eye height down while the visitor stays in the corridor', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(1);
    const early = h.player.eyeHeight;
    h.step(40);
    const late = h.player.eyeHeight;
    expect(early).toBeGreaterThan(late);
    expect(late).toBeLessThan(DEFAULT_EYE_HEIGHT - 0.1);
    expect(late).toBeGreaterThanOrEqual(1.15);
  });

  /*
   * 分かりにくさの主因はここだった。ドリフトが滞在時間だけで進む設計だと、
   * 11m の廊下を歩いて抜ける数秒では何も起きない。歩いた距離でも進める。
   */
  it('drives the drift with the distance walked, not only with time', async () => {
    h.player.spawn(MOUTH.x, MOUTH.z, 0);
    h.walk(8);
    // 立ち止まって同じ 8 秒を過ごしただけなら、まだほとんど下がっていない
    const standing = await makeHarness();
    standing.player.spawn(MOUTH.x, MOUTH.z, 0);
    standing.step(8);

    expect(h.player.eyeHeight).toBeLessThan(standing.player.eyeHeight - 0.1);
    expect(h.player.eyeHeight).toBeLessThan(DEFAULT_EYE_HEIGHT - 0.2);
  });

  // 突き当たりで折り返して戻れば、必ず下がりきっている
  it('is fully drifted by the time the visitor has walked there and back', () => {
    h.player.spawn(MOUTH.x, MOUTH.z, 0);
    // 突き当たりの壁に着いてからも数秒ぶん余裕を見る
    h.walk(10);
    h.player.yaw = Math.PI;
    h.walk(6);
    // まだ廊下の中（＝退出で巻き戻ってはいない）
    expect(h.player.position.z).toBeLessThan(-27.5);
    expect(h.player.eyeHeight).toBeCloseTo(1.15, 2);
  });

  // ダッシュで距離を稼いでも「沈んでいる」と気づかせない速さに抑える
  it('never drops faster than the imperceptible rate, even when dashing', () => {
    h.player.spawn(MOUTH.x, MOUTH.z, 0);
    const dt = 1 / 60;
    let previous = h.player.eyeHeight;
    let worst = 0;
    for (let i = 0; i < 60 * 6; i++) {
      h.walk(dt, 1);
      worst = Math.max(worst, (previous - h.player.eyeHeight) / dt);
      previous = h.player.eyeHeight;
    }
    // 目線の補間（0.4 秒）が乗るぶんの余裕を見て 1.5 倍まで
    expect(worst).toBeLessThan(0.05 * 1.5);
  });

  it('shortens the stride along with the eye height', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(45);
    // 廊下ぶんの減速（0.5）に、縮んだ歩幅ぶんがさらに掛かる
    expect(h.player.moveSpeedScale).toBeLessThan(0.5);
    expect(h.player.moveSpeedScale).toBeGreaterThan(0.35);
  });

  it('never drifts below the designed floor of 1.15 m', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(150);
    expect(h.player.eyeHeight).toBeGreaterThanOrEqual(1.15 - 1e-6);
  });

  // ROOM_D §5: 縮んだまま他の部屋へ行けると、他展示の錯視が全部壊れる
  it('restores the body on zone exit', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(30);
    h.player.spawn(OUTSIDE.x, OUTSIDE.z, 0);
    h.step(2);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 6);
  });

  it('restores the body on dispose', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(30);
    h.exhibits.dispose();
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 9);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 9);
    expect(h.player.activeOverrideCount).toBe(0);
  });

  it('restores the body when warping straight out of the corridor', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(30);
    h.player.warpTo(0, 20, 0);
    h.step(2);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 6);
  });

  it('starts over after leaving and re-entering', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(40);
    h.player.spawn(OUTSIDE.x, OUTSIDE.z, 0);
    h.step(2);
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(1);
    expect(h.player.eyeHeight).toBeGreaterThan(DEFAULT_EYE_HEIGHT - 0.05);
  });

  // ROOM_D §5: 3D 酔い対策。無効化は「弱める」ではなく「完全に効かせない」
  it('is fully disabled by prefers-reduced-motion', () => {
    h.exhibits.flags.reducedMotion = true;
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(40);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 6);
  });

  it('is fully disabled by the independent settings toggle', () => {
    h.exhibits.flags.shrinkingRoom = false;
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(40);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
  });

  it('rolls back immediately if the toggle is switched off mid-corridor', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(30);
    expect(h.player.eyeHeight).toBeLessThan(DEFAULT_EYE_HEIGHT - 0.05);
    h.exhibits.flags.shrinkingRoom = false;
    h.step(2);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
  });

  it('drifts more slowly on touch devices (§4.5)', async () => {
    const mobile = await makeHarness();
    mobile.exhibits.flags.mobile = true;
    mobile.player.spawn(INSIDE.x, INSIDE.z, 0);
    mobile.step(30);

    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(30);

    expect(mobile.player.eyeHeight).toBeGreaterThan(h.player.eyeHeight);
  });

  // タネあかしの山場は「一気に元の高さへ戻す」瞬間
  it('snaps the body back when the reveal is shown', () => {
    h.player.spawn(INSIDE.x, INSIDE.z, 0);
    h.step(40);
    expect(h.player.eyeHeight).toBeLessThan(DEFAULT_EYE_HEIGHT - 0.1);
    h.exhibits.setRevealed('shrinkingRoom', true);
    h.step(1);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 3);
  });

  it('puts up walls the visitor cannot pass through, and takes them away on dispose', () => {
    const side = new THREE.Vector2(1.4, -33);
    // 突き当たり。行き止まりにすることで身長計の前で必ず立ち止まる
    const end = new THREE.Vector2(0, -38.5);
    expect(h.collision.isBlocked(side, 0.35)).toBe(true);
    expect(h.collision.isBlocked(end, 0.35)).toBe(true);
    h.exhibits.dispose();
    expect(h.collision.isBlocked(side, 0.35)).toBe(false);
    expect(h.collision.isBlocked(end, 0.35)).toBe(false);
  });

  // 身長計の目盛と標識は、辞書から文言を受け取っても壊れない（§5.4）
  it('accepts the gauge labels from the dictionary', () => {
    const record = h.exhibits.records.get('shrinkingRoom')!;
    expect(() =>
      record.instance.setLocale?.({
        title: 'x',
        appearance: 'x',
        explanation: 'x',
        scale: 'entry\nnow',
      }),
    ).not.toThrow();
  });
});
