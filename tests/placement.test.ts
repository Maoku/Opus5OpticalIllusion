import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXHIBITS } from '../src/exhibits/registry';
import { footprintAround, footprintContains } from '../src/exhibits/common/placement';
import { areaAt } from '../src/data/layout';
import { PLAYER_RADIUS } from '../src/player/PlayerController';
import { museumCollision } from './helpers/museum';

/**
 * §10b: 配置の再発防止。
 *
 * 「ペンローズの三角形の立ち位置 (−5, −2.8) が、階段の台座
 * （x∈[−5.85,−4.15], z∈[−3.25,−1.55]）の内部だった」という事故は、
 * 配置を人手で決めているかぎり必ず再発する。全展示ぶんを機械的に走査する。
 */

/** 立ち位置と壁のあいだに確保したい余白 */
const WALL_MARGIN = 0.6;

interface Spot {
  exhibitId: string;
  x: number;
  z: number;
  tag: string;
}

const SPOTS: Spot[] = EXHIBITS.flatMap((e) =>
  (e.viewSpots ?? []).map((s, i) => ({
    exhibitId: e.id,
    x: s.standAt.x,
    z: s.standAt.z,
    tag: `${e.id}[${s.tag ?? i}]`,
  })),
);

describe('footprintContains', () => {
  // 2026.07 の実際の値。この組み合わせが「入っている」と言えないなら、
  // 下の走査は何も守れていない
  it('catches the historical stairs-vs-triangle collision', () => {
    const stairsPlinth = footprintAround(-5, -2.4, (1.0 + 0.7) / 2);
    expect(footprintContains(stairsPlinth, -5, -2.8)).toBe(true);
  });

  it('is exclusive outside the rectangle', () => {
    const f = footprintAround(0, 0, 1);
    expect(footprintContains(f, 1.01, 0)).toBe(false);
    expect(footprintContains(f, 1.01, 0, 0.1)).toBe(true);
  });
});

describe('exhibit footprints', () => {
  it('are declared for every exhibit', () => {
    const missing = EXHIBITS.filter((e) => !e.footprint).map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it('are non-degenerate rectangles', () => {
    for (const e of EXHIBITS) {
      const f = e.footprint!;
      expect(f.maxX - f.minX, e.id).toBeGreaterThan(0);
      expect(f.maxZ - f.minZ, e.id).toBeGreaterThan(0);
    }
  });

  it('do not overlap each other', () => {
    for (let i = 0; i < EXHIBITS.length; i++) {
      for (let j = i + 1; j < EXHIBITS.length; j++) {
        const a = EXHIBITS[i]!;
        const b = EXHIBITS[j]!;
        const overlapX = Math.min(a.footprint!.maxX, b.footprint!.maxX) -
          Math.max(a.footprint!.minX, b.footprint!.minX);
        const overlapZ = Math.min(a.footprint!.maxZ, b.footprint!.maxZ) -
          Math.max(a.footprint!.minZ, b.footprint!.minZ);
        expect(overlapX > 0 && overlapZ > 0, `${a.id} × ${b.id}`).toBe(false);
      }
    }
  });
});

describe('view spots', () => {
  it('exist for every exhibit that is not a walk-in zone', () => {
    const missing = EXHIBITS.filter((e) => e.kind !== 'zone' && !e.viewSpots?.length);
    expect(missing.map((e) => e.id)).toEqual([]);
  });

  // 本丸。三角形の立ち位置が階段の台座の中、が二度と通らないようにする
  it('never stand inside another exhibit', () => {
    for (const spot of SPOTS) {
      for (const other of EXHIBITS) {
        if (other.id === spot.exhibitId) continue;
        expect(
          footprintContains(other.footprint!, spot.x, spot.z),
          `${spot.tag} stands inside ${other.id}`,
        ).toBe(false);
      }
    }
  });

  it('never stand inside their own exhibit', () => {
    for (const spot of SPOTS) {
      const own = EXHIBITS.find((e) => e.id === spot.exhibitId)!;
      // ゾーン展示は中を歩くのが目的なので対象外
      if (own.kind === 'zone') continue;
      expect(footprintContains(own.footprint!, spot.x, spot.z), spot.tag).toBe(false);
    }
  });

  it('are clear of every wall collider', () => {
    const collision = museumCollision();
    for (const spot of SPOTS) {
      const p = new THREE.Vector2(spot.x, spot.z);
      expect(collision.isBlocked(p, PLAYER_RADIUS), spot.tag).toBe(false);
    }
  });

  it('sit inside their own area with a margin', () => {
    for (const spot of SPOTS) {
      const area = areaAt(spot.x, spot.z);
      expect(area, spot.tag).not.toBeNull();
      const own = EXHIBITS.find((e) => e.id === spot.exhibitId)!;
      expect(area!.room, spot.tag).toBe(own.room);
      // 壁からの余白。壁に貼りつく立ち位置は視界も操作も窮屈になる
      const slack = Math.min(
        spot.x - area!.min[0],
        area!.max[0] - spot.x,
        spot.z - area!.min[1],
        area!.max[1] - spot.z,
      );
      expect(slack, `${spot.tag} is ${slack.toFixed(2)}m from the area edge`).toBeGreaterThanOrEqual(
        WALL_MARGIN,
      );
    }
  });

  it('keeps every exhibit inside its own area', () => {
    for (const e of EXHIBITS) {
      const f = e.footprint!;
      for (const [x, z] of [
        [f.minX, f.minZ],
        [f.maxX, f.maxZ],
        [f.minX, f.maxZ],
        [f.maxX, f.minZ],
      ] as const) {
        expect(areaAt(x, z)?.room, `${e.id} corner (${x}, ${z})`).toBe(e.room);
      }
    }
  });
});
