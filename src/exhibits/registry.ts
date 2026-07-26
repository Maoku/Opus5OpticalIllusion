import { cafeWall } from './cafeWall';
import { checkerShadow } from './checkerShadow';
import { muellerLyer } from './muellerLyer';
import { neckerCube } from './neckerCube';
import { penroseTriangle } from './penroseTriangle';
import type { ExhibitDefinition } from './types';

/**
 * 全展示の登録テーブル。順路の並びは order で決まる。
 *
 * Room A: 平面のだまし絵 / Room B: あり得ない立体 /
 * Room C: 空間と身体 / Room D: Opus 棟
 */
export const EXHIBITS: readonly ExhibitDefinition[] = [
  cafeWall,
  muellerLyer,
  checkerShadow,
  penroseTriangle,
  neckerCube,
];
