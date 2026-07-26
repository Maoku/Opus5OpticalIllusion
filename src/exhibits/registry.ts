import { buildDummyBox } from './dummyBox';
import type { ExhibitDefinition } from './types';

/**
 * 全展示の登録テーブル。
 *
 * 現在は Phase 4 のダミー2点。Phase 6a でカフェウォールとネッカーキューブに
 * 差し替えるため、textKey だけ先に本番のものを指している。
 */
export const EXHIBITS: readonly ExhibitDefinition[] = [
  {
    id: 'dummyA',
    textKey: 'cafeWall',
    room: 'impossible',
    kind: 'object',
    position: { x: -5, y: 0, z: -8 },
    rotationY: 0,
    order: 900,
    reveal: 'none',
    viewSpots: [
      {
        standAt: { x: -5, y: 0, z: -5 },
        eye: { x: -5, y: 1.6, z: -5 },
        lookAt: { x: -5, y: 1.2, z: -8 },
        fov: 60,
        radius: 1.1,
      },
    ],
    build: buildDummyBox,
  },
  {
    id: 'dummyB',
    textKey: 'neckerCube',
    room: 'impossible',
    kind: 'object',
    position: { x: 5, y: 0, z: -8 },
    rotationY: 0,
    order: 901,
    reveal: 'none',
    viewSpots: [
      {
        standAt: { x: 5, y: 0, z: -5 },
        eye: { x: 5, y: 1.6, z: -5 },
        lookAt: { x: 5, y: 1.2, z: -8 },
        fov: 55,
        radius: 1.1,
      },
    ],
    build: buildDummyBox,
  },
];
