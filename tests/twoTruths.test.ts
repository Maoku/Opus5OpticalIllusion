import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  sampleGlyph,
  sampleGlyphs,
  filledArea,
  type GlyphMask,
} from '../src/exhibits/common/GlyphSampler';
import { reprojectFragment, solveDualView } from '../src/exhibits/common/dualView';
import { TWO_TRUTHS_LAYOUT } from '../src/exhibits/twoTruths';

/**
 * D1「二つの真実」の中身（ROOM_D §1）。
 *
 * この展示が失敗する形は 1 つしかない: **字が読めないこと**。
 * 断片が理想の点からどれだけずれるかを実測して押さえる。
 * ラスタライズだけは Canvas 2D が要るので、ここは合成マスクで検証する。
 */

/** 中央に矩形を置いたマスク */
function rectangleMask(size: number, halfWidth: number, halfHeight: number): GlyphMask {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside =
        Math.abs(x - size / 2) < halfWidth * size && Math.abs(y - size / 2) < halfHeight * size;
      if (inside) data[y * size + x] = 255;
    }
  }
  return { width: size, height: size, data };
}

describe('GlyphSampler', () => {
  it('keeps every sample inside the glyph', () => {
    const mask = rectangleMask(128, 0.2, 0.3);
    // セルの平均カバレッジで採否を決めるので、半セルぶんは外へ出うる
    const slack = 8 / 128 / 2;
    for (const point of sampleGlyph(mask, { spacing: 8 })) {
      expect(Math.abs(point.x)).toBeLessThan(0.2 + slack);
      expect(Math.abs(point.y)).toBeLessThan(0.3 + slack);
    }
  });

  it('produces roughly the requested number of points', () => {
    const mask = rectangleMask(256, 0.3, 0.3);
    const [points] = sampleGlyphs([mask], 300);
    expect(points!.length).toBeGreaterThan(200);
    expect(points!.length).toBeLessThan(420);
  });

  /**
   * ★ ここが D1 の要。2 つの字の点が同じ高さに並んでいないと、
   * 視点 A のレイと視点 B のレイが交わらず、断片が字からずれる。
   */
  it('lines up the rows of different glyphs', () => {
    const [a, b] = sampleGlyphs(
      [rectangleMask(128, 0.3, 0.35), rectangleMask(128, 0.2, 0.35)],
      200,
    );
    const rowsA = new Set(a!.map((p) => p.y.toFixed(5)));
    const rowsB = new Set(b!.map((p) => p.y.toFixed(5)));
    for (const row of rowsB) expect(rowsA.has(row), `row ${row}`).toBe(true);
  });

  it('returns nothing for an empty glyph', () => {
    const empty: GlyphMask = { width: 32, height: 32, data: new Uint8Array(32 * 32) };
    expect(filledArea(empty)).toBe(0);
    expect(sampleGlyph(empty, { spacing: 4 })).toEqual([]);
  });
});

describe('solveDualView', () => {
  const centre = new THREE.Vector3(
    TWO_TRUTHS_LAYOUT.centre.x,
    TWO_TRUTHS_LAYOUT.centre.y,
    TWO_TRUTHS_LAYOUT.centre.z,
  );
  const eyes = TWO_TRUTHS_LAYOUT.spots.map(
    (spot) => new THREE.Vector3(spot.x, TWO_TRUTHS_LAYOUT.eyeHeight, spot.z),
  );
  const [eyeA, eyeB] = eyes as [THREE.Vector3, THREE.Vector3];
  const glyphSize = TWO_TRUTHS_LAYOUT.glyphSize;

  const pointsA = sampleGlyph(rectangleMask(128, 0.32, 0.36), { spacing: 7 });
  const pointsB = sampleGlyph(rectangleMask(128, 0.28, 0.36), { spacing: 7 });
  const solved = solveDualView({
    eyeA,
    eyeB,
    centre,
    glyphSize,
    pointsA,
    pointsB,
    maxError: 0.06,
    angularSize: 0.021,
    minSeparation: 0.019,
  });

  /**
   * 断片は 1 つで 2 つの点を消費するので、上限は少ないほうの点数。
   * 取りこぼしが多いと字が虫食いになる。
   */
  it('places a fragment for most of the sampled points', () => {
    const ceiling = Math.min(pointsA.length, pointsB.length);
    expect(solved.length).toBeGreaterThan(ceiling * 0.85);
  });

  /**
   * 再投影誤差。点の間隔（正規化で 7/128 ≒ 0.055）を超えると隣の画へ滲み、
   * 字が潰れる。最大でもその半分に収まっていること。
   */
  it('lands every fragment on the stroke it belongs to, from both viewpoints', () => {
    const spacing = 7 / 128;
    let sum = 0;
    let worst = 0;
    for (const fragment of solved) {
      const a = reprojectFragment(fragment, eyeA, centre, glyphSize);
      const b = reprojectFragment(fragment, eyeB, centre, glyphSize);
      for (const error of [
        Math.hypot(a.x - fragment.source.a.x, a.y - fragment.source.a.y),
        Math.hypot(b.x - fragment.source.b.x, b.y - fragment.source.b.y),
      ]) {
        sum += error;
        worst = Math.max(worst, error);
      }
    }
    expect(worst).toBeLessThan(spacing / 2);
    expect(sum / (solved.length * 2)).toBeLessThan(spacing / 6);
  });

  it('turns every fragment so that both viewpoints see its face', () => {
    for (const fragment of solved) {
      expect(fragment.normal.dot(eyeA.clone().sub(fragment.position).normalize())).toBeGreaterThan(
        0.5,
      );
      expect(fragment.normal.dot(eyeB.clone().sub(fragment.position).normalize())).toBeGreaterThan(
        0.5,
      );
    }
  });

  it('uses each sampled point at most once', () => {
    const usedA = new Set(solved.map((f) => `${f.source.a.x},${f.source.a.y}`));
    const usedB = new Set(solved.map((f) => `${f.source.b.x},${f.source.b.y}`));
    expect(usedA.size).toBe(solved.length);
    expect(usedB.size).toBe(solved.length);
  });

  // 相互遮蔽の防止（ROOM_D §1 の制約チェック）
  it('keeps fragments angularly apart as seen from either viewpoint', () => {
    const limit = Math.cos(0.019);
    for (const eye of [eyeA, eyeB]) {
      const directions = solved.map((f) => f.position.clone().sub(eye).normalize());
      for (let i = 0; i < directions.length; i++) {
        for (let j = i + 1; j < directions.length; j++) {
          expect(directions[i]!.dot(directions[j]!)).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it('keeps the cloud inside the exhibit footprint', () => {
    for (const fragment of solved) {
      expect(Math.abs(fragment.position.x - centre.x)).toBeLessThan(1.9);
      expect(Math.abs(fragment.position.z - centre.z)).toBeLessThan(1.9);
    }
  });
});
