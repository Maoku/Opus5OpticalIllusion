import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  angleFromEye,
  apparentSizeScale,
  placeOnEyeRay,
  projectToPlaneFromEye,
} from '../src/exhibits/common/eyeProjection';

const EPS = 1e-6;

describe('placeOnEyeRay', () => {
  it('places the point at the requested depth along the eye ray', () => {
    const eye = new THREE.Vector3(0, 1.6, 5);
    const apparent = new THREE.Vector3(0, 1.6, 0);
    const p = placeOnEyeRay(eye, apparent, 10);
    expect(p.distanceTo(eye)).toBeCloseTo(10, 6);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(-5, 6);
  });

  it('keeps the placed point collinear with eye and apparent point', () => {
    const eye = new THREE.Vector3(-2, 1.7, 3.5);
    const apparent = new THREE.Vector3(1.25, 2.4, -4);
    for (const depth of [0.5, 3, 12.75]) {
      const p = placeOnEyeRay(eye, apparent, depth);
      const a = apparent.clone().sub(eye).normalize();
      const b = p.clone().sub(eye).normalize();
      expect(a.distanceTo(b)).toBeLessThan(EPS);
      expect(p.distanceTo(eye)).toBeCloseTo(depth, 6);
    }
  });

  it('is stable when the apparent point coincides with the eye', () => {
    const eye = new THREE.Vector3(1, 1, 1);
    const p = placeOnEyeRay(eye, eye.clone(), 4);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(p.distanceTo(eye)).toBeCloseTo(4, 6);
  });

  it('round-trips: a placed point projects back onto the apparent point', () => {
    const eye = new THREE.Vector3(0, 1.6, 6);
    // 「理想形状」を z = 0 の平面上に置く
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const apparent = new THREE.Vector3(0.8, 2.1, 0);
    const real = placeOnEyeRay(eye, apparent, 14);
    const back = projectToPlaneFromEye(eye, real, plane);
    expect(back).not.toBeNull();
    expect(back!.distanceTo(apparent)).toBeLessThan(1e-5);
  });
});

describe('apparentSizeScale', () => {
  it('is 1 at the reference distance and grows linearly with depth', () => {
    expect(apparentSizeScale(5, 5)).toBeCloseTo(1, 9);
    expect(apparentSizeScale(10, 5)).toBeCloseTo(2, 9);
    expect(apparentSizeScale(2.5, 5)).toBeCloseTo(0.5, 9);
  });
});

describe('angleFromEye', () => {
  it('returns 0 straight ahead and PI/2 to the side', () => {
    const eye = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(0, 0, -1);
    expect(angleFromEye(eye, forward, new THREE.Vector3(0, 0, -3))).toBeCloseTo(0, 9);
    expect(angleFromEye(eye, forward, new THREE.Vector3(3, 0, 0))).toBeCloseTo(Math.PI / 2, 9);
  });
});
