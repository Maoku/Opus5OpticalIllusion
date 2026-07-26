import { Collision } from '../../src/world/Collision';
import { buildWallPieces, type WallPiece } from '../../src/world/wallGeometry';
import { AREAS, DOORWAYS, WALL_THICKNESS } from '../../src/data/layout';

/** 実レイアウトから壁の当たり判定を組み立てる（RoomBuilder と同じ手順） */
export function museumCollision(): Collision {
  const collision = new Collision();
  const pieces: WallPiece[] = [];
  for (const area of AREAS) pieces.push(...buildWallPieces(area, DOORWAYS));
  for (const p of pieces) {
    if (!p.blocking) continue;
    if (p.axis === 'z') collision.addSegment(p.from, p.at, p.to, p.at, WALL_THICKNESS);
    else collision.addSegment(p.at, p.from, p.at, p.to, WALL_THICKNESS);
  }
  return collision;
}
