import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  TOTAL_STEPS,
  fitStairs,
  penroseStairs,
  planStairs,
  stairCorners,
} from '../src/exhibits/penroseStairs';
import { DEFAULT_EYE_HEIGHT } from '../src/player/PlayerController';

/**
 * §10a: ペンローズの階段が繋がっていなかった件の回帰。
 *
 * 4 本目の飛びの終点 `fake` は「視点 → 1 段目の足元」のレイ上に取る。
 * 視点が低いと `fake` が視点側へ寄り、最後の飛びが +Z（手前）へ逆走して
 * 環が閉じない。実際に 2026.07 時点の寸法がそうなっていた。
 */

/** 定義から実際に build() が使う視点（展示ローカル）を組み立てる */
function eyeLocal(): THREE.Vector3 {
  const spot = penroseStairs.viewSpots![0]!;
  return new THREE.Vector3(
    spot.eye.x - penroseStairs.position.x,
    spot.eye.y - penroseStairs.position.y,
    spot.eye.z - penroseStairs.position.z,
  );
}

describe('planStairs', () => {
  // 修正前の寸法。これが「閉じない」と言えないなら、下の検査は意味がない
  it('reports the old dimensions as not closing', () => {
    const oldEye = new THREE.Vector3(0, DEFAULT_EYE_HEIGHT - 0.62, 3.0);
    const plan = planStairs(oldEye, 0.028);
    expect(plan.ratio).toBeGreaterThan(0.4);
    expect(plan.closing).toBeLessThan(0);
    // 4 本目が corners[3] (z=+0.5) から +Z 側へ進んでいた
    expect(plan.fake.z).toBeGreaterThan(plan.corners[3]!.z);
  });

  it('always puts fake on the eye-to-first-step ray', () => {
    for (const rise of [0.006, 0.0175, 0.02, 0.028]) {
      const plan = planStairs(eyeLocal(), rise);
      expect(plan.projectionError, `rise=${rise}`).toBeLessThan(1e-3);
    }
  });

  it('lifts fake to exactly the total rise', () => {
    const plan = planStairs(eyeLocal(), 0.0175);
    expect(plan.fake.y).toBeCloseTo(plan.height, 9);
  });
});

describe('fitStairs', () => {
  it('shrinks the rise until the loop closes', () => {
    // わざと成立しない高すぎる段を渡す
    const fitted = fitStairs(eyeLocal(), 0.06);
    expect(fitted.rise).toBeLessThan(0.06);
    expect(fitted.closing).toBeGreaterThan(0);
    expect(fitted.flightRatio).toBeGreaterThanOrEqual(0.35);
  });

  it('leaves a workable rise untouched', () => {
    const fitted = fitStairs(eyeLocal(), 0.0175);
    expect(fitted.rise).toBeCloseTo(0.0175, 9);
  });
});

describe('the shipped penroseStairs dimensions', () => {
  const plan = fitStairs(eyeLocal(), 0.0175);

  it('closes the loop: the last flight travels toward the first corner', () => {
    expect(plan.closing).toBeGreaterThan(0);
    // corners[3] は z=+0.5。閉じるには −Z 側へ進まなければならない
    expect(plan.fake.z).toBeLessThan(plan.corners[3]!.z);
  });

  /** H < E · 2a / (D + a)。planStairs のコメントにある成立条件そのもの */
  it('satisfies the exact closing inequality with room to spare', () => {
    const eye = eyeLocal();
    const a = 0.5;
    const distance = eye.z;
    const limit = (eye.y * 2 * a) / (distance + a);
    expect(plan.height).toBeLessThan(limit);
    // 余裕。数値誤差や将来の微調整で反転しない程度に空けておく
    expect(plan.height).toBeLessThan(limit * 0.8);
  });

  it('leaves the last flight long enough to read as four steps', () => {
    expect(plan.flightRatio).toBeGreaterThanOrEqual(0.35);
  });

  it('projects fake onto the first step from the correct viewpoint', () => {
    expect(plan.projectionError).toBeLessThan(1e-3);
  });

  it('rises monotonically across all 16 steps', () => {
    const corners = stairCorners();
    const stepBase = (index: number): THREE.Vector3 => {
      const perFlight = TOTAL_STEPS / 4;
      const flight = Math.min(3, Math.floor(index / perFlight));
      const local = (index - flight * perFlight) / perFlight;
      const from = corners[flight]!;
      const to = flight === 3 ? plan.fake : corners[flight + 1]!;
      const p = from.clone().lerp(to, local);
      p.y = index * plan.rise;
      return p;
    };
    for (let i = 0; i < TOTAL_STEPS; i++) {
      expect(stepBase(i + 1).y, `step ${i}`).toBeGreaterThan(stepBase(i).y);
    }
    expect(stepBase(TOTAL_STEPS).y).toBeCloseTo(plan.height, 9);
  });

  it('is viewed from above the model', () => {
    // 見下ろす構図であることが成立条件。目線が模型の天面より十分上にある
    expect(eyeLocal().y).toBeGreaterThan(plan.height * 4);
  });
});
