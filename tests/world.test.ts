import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildDoorPieces,
  buildWallPieces,
  subtractIntervals,
  type WallPiece,
} from '../src/world/wallGeometry';
import { Collision } from '../src/world/Collision';
import { AREAS, DOORWAYS, DOOR_HEIGHT, areaAt, areaById } from '../src/data/layout';

describe('subtractIntervals', () => {
  it('returns the whole range when there are no cuts', () => {
    expect(subtractIntervals(0, 10, [])).toEqual([{ from: 0, to: 10 }]);
  });

  it('splits around a middle cut', () => {
    expect(subtractIntervals(-10, 10, [{ from: -3, to: 3 }])).toEqual([
      { from: -10, to: -3 },
      { from: 3, to: 10 },
    ]);
  });

  it('returns nothing when fully covered', () => {
    expect(subtractIntervals(-3, 3, [{ from: -5, to: 5 }])).toEqual([]);
  });

  it('merges overlapping cuts', () => {
    expect(
      subtractIntervals(0, 10, [
        { from: 2, to: 5 },
        { from: 4, to: 7 },
      ]),
    ).toEqual([
      { from: 0, to: 2 },
      { from: 7, to: 10 },
    ]);
  });

  it('handles reversed cut endpoints', () => {
    expect(subtractIntervals(0, 10, [{ from: 7, to: 3 }])).toEqual([
      { from: 0, to: 3 },
      { from: 7, to: 10 },
    ]);
  });
});

describe('buildWallPieces', () => {
  const roomB = areaById('roomB');

  it('cuts an opening and leaves a lintel above it', () => {
    const pieces = buildWallPieces(roomB, DOORWAYS);
    // roomB の北壁（z = 3）は corridorMain の開口で3分割される
    const north = pieces.filter((p) => p.axis === 'z' && Math.abs(p.at - 3) < 1e-6);
    const solid = north.filter((p) => p.blocking);
    const lintel = north.filter((p) => !p.blocking);
    expect(solid).toHaveLength(2);
    expect(lintel).toHaveLength(1);
    expect(lintel[0]!.y0).toBeCloseTo(DOOR_HEIGHT);
    expect(lintel[0]!.y1).toBeCloseTo(roomB.height);
    expect(lintel[0]!.from).toBeCloseTo(-3);
    expect(lintel[0]!.to).toBeCloseTo(3);
  });

  it('removes a corridor end wall entirely (door height == corridor height)', () => {
    const corridor = areaById('corridorMain');
    const pieces = buildWallPieces(corridor, DOORWAYS);
    const ends = pieces.filter((p) => p.axis === 'z');
    expect(ends).toHaveLength(0);
    // 長辺の壁は残る
    const sides = pieces.filter((p) => p.axis === 'x' && p.blocking);
    expect(sides).toHaveLength(2);
  });

  it('never emits a zero-length piece', () => {
    for (const area of AREAS) {
      for (const p of buildWallPieces(area, DOORWAYS)) {
        expect(Math.abs(p.to - p.from)).toBeGreaterThan(1e-6);
        expect(p.y1 - p.y0).toBeGreaterThan(1e-6);
      }
    }
  });
});

describe('buildDoorPieces', () => {
  it('emits exactly one slab per locked doorway', () => {
    const doors = buildDoorPieces(DOORWAYS);
    const locked = DOORWAYS.filter((d) => d.locked);
    expect(doors).toHaveLength(locked.length);
    expect(doors.every((d) => d.door && d.blocking)).toBe(true);
  });

  it('orients the slab across the thin axis of the opening', () => {
    const doors = buildDoorPieces([
      { min: [-3, -13.5], max: [3, -12.5], height: 3.2, locked: true },
    ]);
    expect(doors[0]!.axis).toBe('z');
    expect(doors[0]!.at).toBeCloseTo(-13);
    expect(doors[0]!.from).toBeCloseTo(-3);
    expect(doors[0]!.to).toBeCloseTo(3);
  });
});

// ------------------------------------------------------------------ layout

describe('layout', () => {
  it('has no overlapping areas', () => {
    for (let i = 0; i < AREAS.length; i++) {
      for (let j = i + 1; j < AREAS.length; j++) {
        const a = AREAS[i]!;
        const b = AREAS[j]!;
        const overlapX = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
        const overlapZ = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
        expect(overlapX > 1e-6 && overlapZ > 1e-6).toBe(false);
      }
    }
  });

  it('resolves the spawn point to the entrance', () => {
    expect(areaAt(0, 23)?.id).toBe('entrance');
    expect(areaAt(0, -30)?.id).toBe('roomD');
    expect(areaAt(500, 500)).toBeNull();
  });
});

// --------------------------------------------------------------- collision

function museumCollision(): Collision {
  const collision = new Collision();
  const pieces: WallPiece[] = [];
  for (const area of AREAS) pieces.push(...buildWallPieces(area, DOORWAYS));
  for (const p of pieces) {
    if (!p.blocking) continue;
    if (p.axis === 'z') collision.addSegment(p.from, p.at, p.to, p.at, 0.3);
    else collision.addSegment(p.at, p.from, p.at, p.to, 0.3);
  }
  return collision;
}

describe('Collision against the real layout', () => {
  const radius = 0.35;

  it('keeps the player inside the entrance hall', () => {
    const collision = museumCollision();
    // 東の壁 (x = 8) を突き抜けようとする
    const out = collision.move(new THREE.Vector2(6, 20), new THREE.Vector2(20, 20), radius);
    expect(out.x).toBeLessThan(8);
  });

  it('lets the player walk through a doorway', () => {
    const collision = museumCollision();
    const out = collision.move(new THREE.Vector2(0, 14), new THREE.Vector2(0, 13), radius);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(13, 6);
  });

  it('slides along a wall instead of sticking', () => {
    const collision = museumCollision();
    // entrance の北壁 (z = 27) に斜めに突っ込む
    const out = collision.move(new THREE.Vector2(1.7, 26.4), new THREE.Vector2(2, 26.9), radius);
    expect(out.y).toBeLessThan(26.6);
    // x 方向は保存される = 滑る
    expect(out.x).toBeCloseTo(2, 6);
  });

  it('resolves a corner without tunnelling through either wall', () => {
    const collision = museumCollision();
    const out = collision.move(new THREE.Vector2(7, 26), new THREE.Vector2(8.4, 27.4), radius);
    expect(out.x).toBeLessThan(8);
    expect(out.y).toBeLessThan(27);
  });

  it('does not tunnel through a wall on a long teleport', () => {
    const collision = museumCollision();
    // エントランスから Room A へ斜めに飛ぶと、開口を通らず壁を何枚も跨ぐ
    const out = collision.move(new THREE.Vector2(0, 20), new THREE.Vector2(-25, -5), radius);
    expect(out.x).toBeGreaterThan(-8);
    expect(out.y).toBeGreaterThan(12);
  });

  it('reports the locked opus door as blocking, and clears it on unlock', () => {
    const collision = museumCollision();
    for (const p of buildDoorPieces(DOORWAYS)) {
      collision.addSegment(p.from, p.at, p.to, p.at, 0.3, 'opus-door');
    }
    expect(collision.isBlocked(new THREE.Vector2(0, -13), radius)).toBe(true);
    collision.removeByTag('opus-door');
    expect(collision.isBlocked(new THREE.Vector2(0, -13), radius)).toBe(false);
  });

  it('does not move a player who is already clear of every wall', () => {
    const collision = museumCollision();
    const p = new THREE.Vector2(0, 20);
    const out = collision.move(p, p.clone(), radius);
    expect(out.distanceTo(p)).toBeCloseTo(0, 9);
  });
});
