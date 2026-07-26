import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Assets } from '../src/core/Assets';
import { AudioBus } from '../src/core/AudioBus';
import { Quality } from '../src/core/Quality';
import type { SceneHost } from '../src/core/SceneHost';
import { emptyInputState, type InputState } from '../src/core/input/types';
import { CULL_DISTANCE, ExhibitManager } from '../src/exhibits/ExhibitManager';
import type { ExhibitDefinition, ExhibitInstance } from '../src/exhibits/types';
import { DEFAULT_EYE_HEIGHT, PlayerController } from '../src/player/PlayerController';
import { ViewpointController } from '../src/viewpoint/ViewpointController';
import { Collision } from '../src/world/Collision';
import { Lighting } from '../src/world/Lighting';

interface Harness {
  host: SceneHost;
  player: PlayerController;
  viewpoint: ViewpointController;
  exhibits: ExhibitManager;
  step(seconds: number, input?: InputState): void;
}

function makeHarness(): Harness {
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
  const audio = new AudioBus();
  const exhibits = new ExhibitManager(host, lighting, player, viewpoint, collision, audio);
  return {
    host,
    player,
    viewpoint,
    exhibits,
    step(seconds, input = emptyInputState()) {
      const dt = 1 / 60;
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        player.update(dt, input);
        viewpoint.update(dt, input);
        exhibits.update(dt, i * dt);
      }
    },
  };
}

/** D2「縮んでいく部屋」を模したゾーン型展示 */
function shrinkingZone(overrides: Partial<ExhibitDefinition> = {}): ExhibitDefinition {
  return {
    id: 'shrink',
    textKey: 'shrinkingRoom',
    room: 'opus',
    kind: 'zone',
    position: { x: 0, y: 0, z: -10 },
    rotationY: 0,
    reveal: 'none',
    zone: { min: { x: -3, y: -1, z: -14 }, max: { x: 3, y: 3, z: -6 } },
    build(ctx) {
      const root = new THREE.Group();
      const instance: ExhibitInstance = {
        root,
        setRevealed() {},
        onZoneEnter() {
          ctx.playerOverride.setEyeHeight(1.15);
          ctx.playerOverride.setMoveSpeedScale(0.6);
        },
        onZoneExit() {
          ctx.playerOverride.setEyeHeight(null);
          ctx.playerOverride.setMoveSpeedScale(null);
        },
        dispose() {},
      };
      return instance;
    },
    ...overrides,
  };
}

function simpleObject(id: string, x: number, z: number): ExhibitDefinition {
  return {
    id,
    textKey: 'neckerCube',
    room: 'impossible',
    kind: 'object',
    position: { x, y: 0, z },
    rotationY: 0,
    reveal: 'none',
    viewSpots: [
      {
        standAt: { x, y: 0, z: z + 3 },
        eye: { x, y: 1.6, z: z + 3 },
        lookAt: { x, y: 1.2, z },
        fov: 55,
        radius: 1.1,
      },
    ],
    build() {
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
      return { root, setRevealed() {}, dispose() {} };
    },
  };
}

describe('ExhibitManager zones and player overrides', () => {
  let h: Harness;
  beforeEach(async () => {
    h = makeHarness();
    await h.exhibits.add(shrinkingZone());
  });

  it('applies the override on zone entry', () => {
    h.player.spawn(0, -10, 0);
    h.step(1.5);
    expect(h.exhibits.records.get('shrink')!.inZone).toBe(true);
    expect(h.player.eyeHeight).toBeLessThan(1.3);
    expect(h.player.moveSpeedScale).toBeCloseTo(0.6, 6);
  });

  // ROOM_D §5: 縮んだまま他の部屋へ行けると、他展示の錯視が全部壊れる
  it('rolls back on zone exit', () => {
    h.player.spawn(0, -10, 0);
    h.step(1.5);
    h.player.spawn(0, 0, 0);
    h.step(1.5);
    expect(h.exhibits.records.get('shrink')!.inZone).toBe(false);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 6);
  });

  it('rolls back on dispose', () => {
    h.player.spawn(0, -10, 0);
    h.step(1.5);
    h.exhibits.dispose();
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 9);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 9);
    expect(h.player.activeOverrideCount).toBe(0);
  });

  it('rolls back on remove()', () => {
    h.player.spawn(0, -10, 0);
    h.step(1.5);
    h.exhibits.remove('shrink');
    h.step(1);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 9);
  });

  // ワープ経路: 展示一覧から別の部屋へ飛んでもゾーンを抜けたことになる
  it('rolls back when warping out of the zone', () => {
    h.player.spawn(0, -10, 0);
    h.step(1.5);
    h.player.warpTo(0, 20, 0);
    h.step(1.5);
    expect(h.player.eyeHeight).toBeCloseTo(DEFAULT_EYE_HEIGHT, 4);
    expect(h.player.moveSpeedScale).toBeCloseTo(1, 6);
  });

  it('emits zone events exactly once per transition', () => {
    const entered = vi.fn();
    const exited = vi.fn();
    h.exhibits.events.on('zoneEntered', entered);
    h.exhibits.events.on('zoneExited', exited);
    h.player.spawn(0, -10, 0);
    h.step(1);
    h.player.spawn(0, 0, 0);
    h.step(1);
    expect(entered).toHaveBeenCalledTimes(1);
    expect(exited).toHaveBeenCalledTimes(1);
  });
});

describe('ExhibitManager culling and focus', () => {
  it('hides and stops updating exhibits beyond the cull distance', async () => {
    const h = makeHarness();
    const update = vi.fn();
    await h.exhibits.add({
      ...simpleObject('far', 0, -40),
      build() {
        return { root: new THREE.Group(), setRevealed() {}, update, dispose() {} };
      },
    });
    h.player.spawn(0, 0, 0);
    h.step(0.2);
    const record = h.exhibits.records.get('far')!;
    expect(record.distance).toBeGreaterThan(CULL_DISTANCE);
    expect(record.visible).toBe(false);
    expect(update).not.toHaveBeenCalled();

    h.player.spawn(0, -35, 0);
    h.step(0.2);
    expect(h.exhibits.records.get('far')!.visible).toBe(true);
    expect(update).toHaveBeenCalled();
  });

  it('focuses the exhibit whose ViewSpot the player is standing on', async () => {
    const h = makeHarness();
    await h.exhibits.add(simpleObject('a', -5, -8));
    await h.exhibits.add(simpleObject('b', 5, -8));
    h.player.spawn(-5, -5, 0);
    h.step(0.2);
    expect(h.exhibits.focused?.definition.id).toBe('a');
    h.player.spawn(5, -5, 0);
    h.step(0.2);
    expect(h.exhibits.focused?.definition.id).toBe('b');
  });

  it('animates reveal progress to 1 and back to 0', async () => {
    const h = makeHarness();
    const setRevealed = vi.fn();
    await h.exhibits.add({
      ...simpleObject('a', 0, -2),
      build() {
        return { root: new THREE.Group(), setRevealed, dispose() {} };
      },
    });
    h.player.spawn(0, 0, 0);
    h.exhibits.setRevealed('a', true);
    h.step(2);
    expect(h.exhibits.records.get('a')!.revealProgress).toBeCloseTo(1, 6);
    h.exhibits.setRevealed('a', false);
    h.step(2);
    expect(h.exhibits.records.get('a')!.revealProgress).toBeCloseTo(0, 6);
    expect(setRevealed).toHaveBeenCalled();
  });
});

describe('ViewpointController', () => {
  it('detects a candidate only inside the ViewSpot radius', async () => {
    const h = makeHarness();
    await h.exhibits.add(simpleObject('a', 0, -8));
    h.player.spawn(0, -2, 0);
    h.step(0.1);
    expect(h.viewpoint.candidate).toBeNull();
    h.player.spawn(0, -5, 0);
    h.step(0.1);
    expect(h.viewpoint.candidate?.exhibitId).toBe('a');
  });

  it('snaps to the exact eye pose and freezes the player', async () => {
    const h = makeHarness();
    await h.exhibits.add(simpleObject('a', 0, -8));
    h.player.spawn(0, -5, 0);
    h.step(0.1);
    h.viewpoint.enter(h.viewpoint.candidate!);
    expect(h.player.frozen).toBe(true);
    h.step(0.8);
    expect(h.viewpoint.state).toBe('locked');
    expect(h.host.camera.position.y).toBeCloseTo(1.6, 5);
    expect(h.host.camera.position.z).toBeCloseTo(-5, 5);
    expect(h.host.camera.fov).toBeCloseTo(55, 5);
    // 視線が lookAt を向いていること（Object3D.lookAt の向き規則を取り違えない）
    const forward = new THREE.Vector3();
    h.host.camera.getWorldDirection(forward);
    expect(forward.z).toBeLessThan(-0.9);
  });

  it('returns to the player pose and unfreezes on exit', async () => {
    const h = makeHarness();
    await h.exhibits.add(simpleObject('a', 0, -8));
    h.player.spawn(0, -5, 0.3);
    h.step(0.1);
    h.viewpoint.enter(h.viewpoint.candidate!);
    h.step(0.8);
    h.viewpoint.exit();
    h.step(0.8);
    expect(h.viewpoint.state).toBe('idle');
    expect(h.player.frozen).toBe(false);
    expect(h.host.camera.position.y).toBeCloseTo(h.player.eyeHeight, 5);
  });

  it('releases the lock when the player pushes the stick', async () => {
    const h = makeHarness();
    await h.exhibits.add(simpleObject('a', 0, -8));
    h.player.spawn(0, -5, 0);
    h.step(0.1);
    h.viewpoint.enter(h.viewpoint.candidate!);
    h.step(0.8);
    expect(h.viewpoint.state).toBe('locked');
    h.step(0.05, { ...emptyInputState(), move: { x: 0, y: 1 } });
    expect(h.viewpoint.state).toBe('exiting');
  });

  it('allows only a few degrees of head movement while locked', async () => {
    const h = makeHarness();
    await h.exhibits.add(simpleObject('a', 0, -8));
    h.player.spawn(0, -5, 0);
    h.step(0.1);
    h.viewpoint.enter(h.viewpoint.candidate!);
    h.step(0.8);
    const before = h.host.camera.quaternion.clone();
    // 大きく振っても ±3° までしか動かない
    h.step(0.5, { ...emptyInputState(), look: { yaw: 0.4, pitch: 0.4 } });
    const angle = before.angleTo(h.host.camera.quaternion);
    expect(angle).toBeGreaterThan(0.01);
    expect(angle).toBeLessThan((5 * Math.PI) / 180);
  });

  it('does not move the camera at all while idle', async () => {
    const h = makeHarness();
    await h.exhibits.add(simpleObject('a', 0, -8));
    h.player.spawn(0, 0, 0);
    h.step(0.5);
    expect(h.host.camera.position.z).toBeCloseTo(0, 6);
  });

  it('switches to an orthographic camera for orthographic ViewSpots', async () => {
    const h = makeHarness();
    const def = simpleObject('necker', 0, -8);
    def.viewSpots![0]!.projection = 'orthographic';
    def.viewSpots![0]!.orthoHeight = 3;
    await h.exhibits.add(def);
    h.player.spawn(0, -5, 0);
    h.step(0.1);
    h.viewpoint.enter(h.viewpoint.candidate!);
    h.step(0.8);
    expect(h.host.renderCamera).not.toBe(h.host.camera);
    expect((h.host.renderCamera as THREE.OrthographicCamera).isOrthographicCamera).toBe(true);
    h.viewpoint.exit();
    h.step(0.8);
    expect(h.host.renderCamera).toBe(h.host.camera);
  });
});

// §8c: モーション低減時のふるまい
describe('reduced motion', () => {
  it('steps the orbit reveal instead of sweeping it', async () => {
    const h = makeHarness();
    const def = simpleObject('penrose', 0, -8);
    def.reveal = 'orbit';
    await h.exhibits.add(def);
    h.exhibits.reducedMotion = true;
    h.viewpoint.reducedMotion = true;
    h.player.spawn(0, -5, 0);
    h.step(0.1);
    h.viewpoint.enter(h.viewpoint.candidate!);
    h.step(0.5);

    h.exhibits.setRevealed('penrose', true);
    // 第1段が着地したあと「ため」に入る
    h.step(0.4);
    expect(h.viewpoint.holding).toBe(true);
    const midway = h.host.camera.position.clone();

    // ためが明けたら第2段へ進み、最終ポーズは第1段より大きく回り込む
    h.step(1.6);
    expect(h.viewpoint.holding).toBe(false);
    const final = h.host.camera.position.clone();
    expect(final.distanceTo(midway)).toBeGreaterThan(0.5);
  });

  it('sweeps in one continuous move when motion is not reduced', async () => {
    const h = makeHarness();
    const def = simpleObject('penrose', 0, -8);
    def.reveal = 'orbit';
    await h.exhibits.add(def);
    h.player.spawn(0, -5, 0);
    h.step(0.1);
    h.viewpoint.enter(h.viewpoint.candidate!);
    h.step(0.5);
    h.exhibits.setRevealed('penrose', true);
    h.step(0.5);
    expect(h.viewpoint.holding).toBe(false);
  });
});
