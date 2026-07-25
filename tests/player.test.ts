import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Collision } from '../src/world/Collision';
import {
  DEFAULT_EYE_HEIGHT,
  PLAYER_RADIUS,
  PlayerController,
} from '../src/player/PlayerController';
import { emptyInputState, type InputState } from '../src/core/input/types';

function makePlayer(): { player: PlayerController; collision: Collision } {
  const collision = new Collision();
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.05, 200);
  const player = new PlayerController(camera, collision);
  return { player, collision };
}

function moveInput(x: number, y: number): InputState {
  return { ...emptyInputState(), move: { x, y } };
}

function step(player: PlayerController, input: InputState, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) player.update(dt, input);
}

describe('PlayerController movement', () => {
  it('walks forward along -Z when yaw is 0', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    step(player, moveInput(0, 0.7), 1);
    expect(player.position.z).toBeLessThan(-1);
    expect(Math.abs(player.position.x)).toBeLessThan(1e-6);
  });

  it('strafes along +X when yaw is 0', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    step(player, moveInput(0.7, 0), 1);
    expect(player.position.x).toBeGreaterThan(1);
  });

  it('dashes faster than it walks', () => {
    const { player: walker } = makePlayer();
    walker.spawn(0, 0, 0);
    step(walker, moveInput(0, 0.7), 2);

    const { player: dasher } = makePlayer();
    dasher.spawn(0, 0, 0);
    step(dasher, moveInput(0, 1), 2);

    expect(Math.abs(dasher.position.z)).toBeGreaterThan(Math.abs(walker.position.z) * 1.3);
  });

  it('comes to rest when input stops', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    step(player, moveInput(0, 1), 1);
    step(player, emptyInputState(), 2);
    expect(player.velocity.length()).toBeLessThan(0.01);
  });

  it('does not walk through a wall', () => {
    const { player, collision } = makePlayer();
    collision.addSegment(-5, -3, 5, -3, 0.3);
    player.spawn(0, 0, 0);
    step(player, moveInput(0, 1), 4);
    expect(player.position.z).toBeGreaterThan(-3 + PLAYER_RADIUS);
  });

  it('slides along a wall hit at an angle', () => {
    const { player, collision } = makePlayer();
    collision.addSegment(-20, -3, 20, -3, 0.3);
    player.spawn(0, 0, 0);
    // 斜め前方へ進み続ける
    step(player, moveInput(0.7, 0.7), 3);
    expect(player.position.z).toBeGreaterThan(-3 + PLAYER_RADIUS);
    expect(player.position.x).toBeGreaterThan(2);
  });

  it('is frozen while locked to a ViewSpot', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    player.frozen = true;
    step(player, moveInput(0, 1), 1);
    expect(player.position.z).toBeCloseTo(0, 9);
  });

  it('keeps camera and player in sync', () => {
    const { player } = makePlayer();
    player.spawn(2, 5, 0.4);
    step(player, moveInput(0, 0.7), 0.5);
    expect(player.camera.position.x).toBeCloseTo(player.position.x, 9);
    expect(player.camera.position.z).toBeCloseTo(player.position.z, 9);
    expect(player.camera.position.y).toBeCloseTo(player.eyeHeight, 6);
  });

  it('warps without ending up inside a wall', () => {
    const { player, collision } = makePlayer();
    collision.addSegment(-5, 10, 5, 10, 0.3);
    player.spawn(0, 0, 0);
    player.warpTo(0, 10, 0);
    const p = new THREE.Vector2(player.position.x, player.position.z);
    expect(collision.isBlocked(p, PLAYER_RADIUS)).toBe(false);
  });
});

// ROOM_D §2.3 / §5: 身体改変が巻き戻らないと他の全展示の錯視が壊れる
describe('PlayerController override rollback', () => {
  it('applies an eye-height override', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    const handle = player.createOverride('d2');
    handle.setEyeHeight(1.15);
    step(player, emptyInputState(), 2);
    expect(player.eyeHeight).toBeCloseTo(1.15, 3);
  });

  it('restores the eye height on release (zone exit)', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    const handle = player.createOverride('d2');
    handle.setEyeHeight(1.15);
    step(player, emptyInputState(), 2);
    handle.release();
    step(player, emptyInputState(), 2);
    expect(player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 6);
    expect(player.activeOverrideCount).toBe(0);
  });

  it('restores the eye height on releaseAllOverrides (dispose / warp)', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    const handle = player.createOverride('d2');
    handle.setEyeHeight(1.15);
    handle.setMoveSpeedScale(0.6);
    step(player, emptyInputState(), 2);
    player.releaseAllOverrides();
    expect(player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 9);
    expect(player.moveSpeedScale).toBeCloseTo(1, 9);
    expect(handle.released).toBe(true);
  });

  it('ignores writes through a released handle', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    const handle = player.createOverride('d2');
    handle.release();
    handle.setEyeHeight(0.5);
    step(player, emptyInputState(), 2);
    expect(player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 9);
  });

  it('release is idempotent', () => {
    const { player } = makePlayer();
    const handle = player.createOverride('d2');
    handle.setEyeHeight(1.2);
    handle.release();
    handle.release();
    expect(player.activeOverrideCount).toBe(0);
  });

  it('slows movement while the override is active and restores it after', () => {
    const { player } = makePlayer();
    player.spawn(0, 0, 0);
    const handle = player.createOverride('d2');
    handle.setMoveSpeedScale(0.5);
    expect(player.moveSpeedScale).toBeCloseTo(0.5, 9);
    step(player, moveInput(0, 0.7), 1);
    const slowDistance = Math.abs(player.position.z);

    handle.release();
    expect(player.moveSpeedScale).toBeCloseTo(1, 9);

    const { player: fast } = makePlayer();
    fast.spawn(0, 0, 0);
    step(fast, moveInput(0, 0.7), 1);
    expect(Math.abs(fast.position.z)).toBeGreaterThan(slowDistance * 1.5);
  });
});
