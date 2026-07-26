import { describe, expect, it } from 'vitest';
import {
  ORBIT_ANGLES,
  clampToBounds,
  pickOrbitViewpoint,
} from '../src/exhibits/common/revealCamera';
import { EXHIBITS } from '../src/exhibits/registry';
import { cameraKindOf } from '../src/exhibits/ExhibitManager';
import { areaAt, areaById } from '../src/data/layout';
import type { Footprint } from '../src/exhibits/types';

const roomC = areaById('roomC');
const ROOM_C: Footprint = {
  minX: roomC.min[0],
  maxX: roomC.max[0],
  minZ: roomC.min[1],
  maxZ: roomC.max[1],
};

describe('pickOrbitViewpoint', () => {
  it('keeps the default +72° when nothing is in the way', () => {
    const pick = pickOrbitViewpoint({
      centre: { x: 24, z: -6 },
      radius: 3,
      baseAngle: 0,
      bounds: ROOM_C,
    });
    expect(pick.degrees).toBe(ORBIT_ANGLES[0]);
    expect(pick.clamped).toBe(false);
  });

  /**
   * ブーシェの椅子の実測値。中心 (31, −6.2)、正解視点 (31, 0.4) から
   * 半径 6.67m。+72° は x ≈ 37.3 で Room C（x ≤ 34）の外だった。
   */
  it('rejects the chair angle that left Room C through the wall', () => {
    const pick = pickOrbitViewpoint({
      centre: { x: 31, z: -6.2 },
      radius: 6.67,
      baseAngle: 0,
      bounds: ROOM_C,
    });
    expect(pick.degrees).not.toBe(72);
    expect(pick.x).toBeLessThanOrEqual(ROOM_C.maxX - 0.6);
    expect(pick.x).toBeGreaterThanOrEqual(ROOM_C.minX + 0.6);
  });

  it('avoids landing inside another exhibit', () => {
    const ponzo: Footprint = { minX: 22.7, maxX: 25.3, minZ: -10, maxZ: -2.2 };
    const pick = pickOrbitViewpoint({
      centre: { x: 31, z: -6.2 },
      radius: 6.67,
      baseAngle: 0,
      bounds: ROOM_C,
      blockers: [ponzo],
    });
    const insidePonzo =
      pick.x >= ponzo.minX && pick.x <= ponzo.maxX && pick.z >= ponzo.minZ && pick.z <= ponzo.maxZ;
    expect(insidePonzo).toBe(false);
  });

  // 角度を振るほうが先。半径を縮めるのは全角度が駄目だったときだけ
  it('tries other angles before shrinking the radius', () => {
    const tight: Footprint = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
    const pick = pickOrbitViewpoint({
      centre: { x: 0, z: 0 },
      radius: 3,
      baseAngle: 0,
      bounds: tight,
    });
    expect(pick.radius).toBe(3);
    expect(Math.abs(pick.degrees)).toBeLessThan(72);
    expect(pick.clamped).toBe(false);
  });

  it('shrinks the radius when no angle fits', () => {
    const tighter: Footprint = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    const pick = pickOrbitViewpoint({
      centre: { x: 0, z: 0 },
      radius: 3,
      baseAngle: 0,
      bounds: tighter,
    });
    expect(pick.radius).toBeLessThan(3);
    expect(pick.clamped).toBe(false);
    expect(Math.abs(pick.x)).toBeLessThanOrEqual(1.4);
    expect(Math.abs(pick.z)).toBeLessThanOrEqual(1.4);
  });

  it('clamps into the room when every candidate fails', () => {
    const tiny: Footprint = { minX: -1.4, maxX: 1.4, minZ: -1.4, maxZ: 1.4 };
    const pick = pickOrbitViewpoint({
      centre: { x: 0, z: 0 },
      radius: 8,
      baseAngle: 0,
      bounds: tiny,
    });
    expect(pick.clamped).toBe(true);
    expect(Math.abs(pick.x)).toBeLessThanOrEqual(0.8);
    expect(Math.abs(pick.z)).toBeLessThanOrEqual(0.8);
  });
});

/** §11a: 見た目の演出とカメラ演出を 2 軸に分けた結果を固定する */
describe('cameraKindOf', () => {
  it('keeps deriving orbit and topDown from the reveal kind', () => {
    for (const e of EXHIBITS) {
      if (e.revealCamera) continue;
      const expected = e.reveal === 'orbit' || e.reveal === 'topDown' ? e.reveal : null;
      expect(cameraKindOf(e), e.id).toBe(expected);
    }
  });

  it('lets revealCamera override the reveal kind', () => {
    // チェッカーシャドウは reveal:'strip' のままカメラだけ見下ろす
    const checker = EXHIBITS.find((e) => e.id === 'checkerShadow')!;
    expect(checker.reveal).toBe('strip');
    expect(cameraKindOf(checker)).toBe('tilt');
  });

  it('gives every tilt exhibit a focus and a tilt spec', () => {
    for (const e of EXHIBITS) {
      if (cameraKindOf(e) !== 'tilt') continue;
      expect(e.revealTilt, e.id).toBeDefined();
      expect(e.revealFocus, e.id).toBeDefined();
      // 真上まで振ると立体どうしの関係が読めなくなる
      expect(e.revealTilt!.elevation, e.id).toBeLessThan(90);
      expect(e.revealTilt!.elevation, e.id).toBeGreaterThan(0);
    }
  });

  it('keeps every tilt viewpoint inside its room and under the ceiling', () => {
    for (const e of EXHIBITS) {
      if (cameraKindOf(e) !== 'tilt') continue;
      const spot = e.viewSpots![0]!;
      const focus = e.revealFocus!;
      const centre = { x: e.position.x + focus.x, y: focus.y, z: e.position.z + focus.z };
      const tilt = e.revealTilt!;
      const dx = spot.eye.x - centre.x;
      const dz = spot.eye.z - centre.z;
      const flatLength = Math.hypot(dx, dz);
      const radians = (tilt.elevation * Math.PI) / 180;
      const reach = (tilt.distance * Math.cos(radians)) / flatLength;
      const x = centre.x + dx * reach;
      const z = centre.z + dz * reach;
      const y = centre.y + tilt.distance * Math.sin(radians);
      const area = areaAt(x, z);
      expect(area?.room, `${e.id} room`).toBe(e.room);
      expect(y, `${e.id} height`).toBeLessThan(area!.height - 0.3);
      expect(y, `${e.id} height`).toBeGreaterThan(0.2);
    }
  });
});

describe('clampToBounds', () => {
  it('pulls a top-down eye back inside the room', () => {
    const p = clampToBounds(ROOM_C, 24, 3.4);
    expect(p.z).toBeCloseTo(ROOM_C.maxZ - 0.6);
    expect(p.x).toBe(24);
  });

  it('passes a point through untouched when it already fits', () => {
    expect(clampToBounds(ROOM_C, 24, -6)).toEqual({ x: 24, z: -6 });
  });
});

/**
 * §11d-1 の完了条件: 全 orbit 展示の種明かし視点がエリア内に収まること。
 * ExhibitManager と同じ計算をここで再現して固定する。
 */
describe('every orbit reveal lands inside its own room', () => {
  const orbits = EXHIBITS.filter((e) => e.reveal === 'orbit');

  it('has orbit exhibits to check', () => {
    expect(orbits.length).toBeGreaterThan(0);
  });

  for (const e of orbits) {
    it(`${e.id} stays in the room`, () => {
      const spot = e.viewSpots![0]!;
      const focus = e.revealFocus;
      // ExhibitManager は revealFocus を rotationY で回してから足す
      const cos = Math.cos(e.rotationY);
      const sin = Math.sin(e.rotationY);
      const centre = {
        x: e.position.x + (focus ? focus.x * cos + focus.z * sin : 0),
        z: e.position.z + (focus ? -focus.x * sin + focus.z * cos : 0),
      };
      const area = areaAt(centre.x, centre.z);
      expect(area, `${e.id} centre is outside every area`).not.toBeNull();
      const bounds: Footprint = {
        minX: area!.min[0],
        maxX: area!.max[0],
        minZ: area!.min[1],
        maxZ: area!.max[1],
      };
      const dx = spot.eye.x - centre.x;
      const dz = spot.eye.z - centre.z;
      const pick = pickOrbitViewpoint({
        centre,
        radius: Math.hypot(dx, dz),
        baseAngle: Math.atan2(dx, dz),
        bounds,
        blockers: EXHIBITS.filter((o) => o.id !== e.id && o.footprint).map((o) => o.footprint!),
      });
      expect(pick.x, `${e.id} x`).toBeGreaterThanOrEqual(bounds.minX);
      expect(pick.x, `${e.id} x`).toBeLessThanOrEqual(bounds.maxX);
      expect(pick.z, `${e.id} z`).toBeGreaterThanOrEqual(bounds.minZ);
      expect(pick.z, `${e.id} z`).toBeLessThanOrEqual(bounds.maxZ);
      expect(areaAt(pick.x, pick.z)?.room, `${e.id} room`).toBe(e.room);
    });
  }
});
