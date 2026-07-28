import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildWallPieces, subtractIntervals } from '../src/world/wallGeometry';
import { AREAS, DOORWAYS, DOOR_HEIGHT, areaAt, areaById } from '../src/data/layout';
import { museumCollision } from './helpers/museum';

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

/**
 * §12b: 扉という概念ごと削除した。Opus 棟は初回から素通しで入れる。
 * 施錠を前提にしたテストを、到達可能性の検証に置き換えている。
 */
describe('the Opus wing is open from the start', () => {
  it('walks from Room B to the Opus hall without hitting a wall', () => {
    const collision = museumCollision();
    const radius = 0.35;
    // roomB の南口 → corridorD → roomDNorth → 大広間
    const waypoints: Array<[number, number]> = [
      [0, -11],
      [0, -14],
      [0, -18],
      [0, -21],
      [0, -26],
      [0, -30],
      [0, -34],
    ];
    let at = new THREE.Vector2(waypoints[0]![0], waypoints[0]![1]);
    for (const [x, z] of waypoints.slice(1)) {
      at = collision.move(at, new THREE.Vector2(x, z), radius);
      expect([at.x, at.y], `blocked before (${x}, ${z})`).toEqual([x, z]);
    }
    expect(areaAt(at.x, at.y)?.id).toBe('roomD');
  });

  it('opens the dark alcove at exactly two places', () => {
    const collision = museumCollision();
    const radius = 0.35;
    // roomDNorth から西へ入る（主入口は x = -4, z ∈ [-24, -20]）
    const inside = collision.move(new THREE.Vector2(-2, -22), new THREE.Vector2(-7, -22), radius);
    expect(areaAt(inside.x, inside.y)?.id).toBe('roomDAlcove');
    // 南口（x ∈ [-6.5, -4.5]）から大広間の西へ抜けられる
    const through = collision.move(
      new THREE.Vector2(-5.5, -26),
      new THREE.Vector2(-5.5, -31),
      radius,
    );
    expect(through.y).toBe(-31);
    expect(areaAt(through.x, through.y)?.id).toBe('roomD');
    // 南壁の残りは塞がったまま。D1 の視点 A が背負う北壁に穴を開けてはいけない
    const blocked = collision.move(new THREE.Vector2(-9, -26), new THREE.Vector2(-9, -31), radius);
    expect(blocked.y).toBeGreaterThan(-28);
  });

  /**
   * 西半分が袋小路になっていた回帰（D5 / D1 が壁の裏に隠れる）。
   * D2 の縮む廊下を迂回せずに、アルコーブ経由で D5 の立ち位置まで歩けること。
   */
  it('reaches the west half of the hall without squeezing past the shrinking corridor', () => {
    const collision = museumCollision();
    const radius = 0.35;
    const waypoints: Array<[number, number]> = [
      [-2, -22], // roomDNorth
      [-7, -22], // アルコーブ（D6）
      [-5.5, -26], // 南口の手前
      [-5.5, -30], // 大広間の西へ
      [-7.5, -30], // D5 の立ち位置
      [-9.5, -40], // D1 の視点 A
    ];
    let at = new THREE.Vector2(waypoints[0]![0], waypoints[0]![1]);
    for (const [x, z] of waypoints.slice(1)) {
      at = collision.move(at, new THREE.Vector2(x, z), radius);
      expect([at.x, at.y], `blocked before (${x}, ${z})`).toEqual([x, z]);
    }
  });

  it('has no doorway left marked as a door', () => {
    // Doorway から locked を消したので、型の上でも扉は存在しない
    for (const d of DOORWAYS) {
      expect(Object.keys(d).sort()).toEqual(['height', 'max', 'min']);
    }
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

  // §12b: かつて施錠扉が立っていた場所。いまは素通し
  it('leaves the old Opus door opening clear', () => {
    const collision = museumCollision();
    expect(collision.isBlocked(new THREE.Vector2(0, -13), radius)).toBe(false);
  });

  it('does not move a player who is already clear of every wall', () => {
    const collision = museumCollision();
    const p = new THREE.Vector2(0, 20);
    const out = collision.move(p, p.clone(), radius);
    expect(out.distanceTo(p)).toBeCloseTo(0, 9);
  });
});
