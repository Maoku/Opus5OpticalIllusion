import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  clamp,
  closestPointsBetweenRays,
  damp,
  easeInOutCubic,
  easeInOutSine,
  easeOutCubic,
  inverseLerp,
  lerp,
  resolveCircleSegment,
  shortestAngleDelta,
} from '../src/utils/math';

describe('scalar helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('lerps and inverse-lerps consistently', () => {
    expect(lerp(2, 10, 0.25)).toBeCloseTo(4);
    expect(inverseLerp(2, 10, 4)).toBeCloseTo(0.25);
    expect(inverseLerp(3, 3, 3)).toBe(0);
  });

  it('damp approaches 1 as dt grows and 0 as dt shrinks', () => {
    expect(damp(10, 0)).toBeCloseTo(0);
    expect(damp(10, 100)).toBeCloseTo(1);
    expect(damp(10, 0.016)).toBeGreaterThan(0);
    expect(damp(10, 0.016)).toBeLessThan(1);
  });

  it('shortestAngleDelta takes the short way round', () => {
    expect(shortestAngleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(shortestAngleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);
  });
});

describe('easing', () => {
  it.each([easeInOutCubic, easeInOutSine, easeOutCubic])('is bounded 0..1', (fn) => {
    expect(fn(0)).toBeCloseTo(0, 9);
    expect(fn(1)).toBeCloseTo(1, 9);
    expect(fn(-3)).toBeCloseTo(0, 9);
    expect(fn(3)).toBeCloseTo(1, 9);
  });

  it('is monotonically increasing', () => {
    for (const fn of [easeInOutCubic, easeInOutSine, easeOutCubic]) {
      let prev = -Infinity;
      for (let i = 0; i <= 50; i++) {
        const v = fn(i / 50);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('easeInOutCubic is symmetric about 0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 9);
  });
});

describe('closestPointsBetweenRays', () => {
  it('finds the intersection when rays actually cross', () => {
    const r = closestPointsBetweenRays(
      new THREE.Vector3(-5, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, -5, 0),
      new THREE.Vector3(0, 1, 0),
    );
    expect(r.distance).toBeCloseTo(0, 9);
    expect(r.p1.distanceTo(new THREE.Vector3(0, 0, 0))).toBeCloseTo(0, 9);
    expect(r.p2.distanceTo(new THREE.Vector3(0, 0, 0))).toBeCloseTo(0, 9);
  });

  it('finds the common perpendicular for skew rays', () => {
    // x 軸に沿う直線と、z=2 で y 軸に沿う直線 → 最近接距離は 2
    const r = closestPointsBetweenRays(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(0, 1, 0),
    );
    expect(r.distance).toBeCloseTo(2, 9);
    expect(r.p1.x).toBeCloseTo(3, 9);
    expect(r.p2.y).toBeCloseTo(0, 9);
  });

  it('normalises direction vectors internally', () => {
    const a = closestPointsBetweenRays(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(7, 0, 0),
      new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(0, 0.01, 0),
    );
    expect(a.distance).toBeCloseTo(2, 9);
    expect(a.p1.x).toBeCloseTo(3, 9);
  });

  it('does not blow up on parallel rays', () => {
    const r = closestPointsBetweenRays(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 3, 0),
      new THREE.Vector3(1, 0, 0),
    );
    expect(Number.isFinite(r.distance)).toBe(true);
    expect(r.distance).toBeCloseTo(3, 9);
  });
});

describe('resolveCircleSegment', () => {
  const a = new THREE.Vector2(-5, 0);
  const b = new THREE.Vector2(5, 0);

  it('returns null when clear of the segment', () => {
    expect(resolveCircleSegment(new THREE.Vector2(0, 2), 0.35, a, b)).toBeNull();
  });

  it('pushes the circle out along the shortest axis', () => {
    const push = resolveCircleSegment(new THREE.Vector2(0, 0.1), 0.35, a, b);
    expect(push).not.toBeNull();
    expect(push!.x).toBeCloseTo(0, 9);
    expect(push!.y).toBeCloseTo(0.25, 9);
  });

  it('resolves against the endpoint when past the segment end', () => {
    const push = resolveCircleSegment(new THREE.Vector2(5.2, 0.1), 0.35, a, b);
    expect(push).not.toBeNull();
    const after = new THREE.Vector2(5.2, 0.1).add(push!);
    expect(after.distanceTo(b)).toBeCloseTo(0.35, 6);
  });

  it('escapes along the normal when exactly on the segment', () => {
    const push = resolveCircleSegment(new THREE.Vector2(0, 0), 0.35, a, b);
    expect(push).not.toBeNull();
    expect(push!.length()).toBeCloseTo(0.35, 9);
    expect(Math.abs(push!.y)).toBeCloseTo(0.35, 9);
  });
});
