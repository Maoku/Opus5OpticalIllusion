import { amesRoom } from './amesRoom';
import { audibleCollision } from './audibleCollision';
import { anamorphosis } from './anamorphosis';
import { beuchetChair } from './beuchetChair';
import { cafeWall } from './cafeWall';
import { checkerShadow } from './checkerShadow';
import { ebbinghaus } from './ebbinghaus';
import { hering } from './hering';
import { hollowMask } from './hollowMask';
import { muellerLyer } from './muellerLyer';
import { neckerCube } from './neckerCube';
import { penroseStairs } from './penroseStairs';
import { penroseTriangle } from './penroseTriangle';
import { peripheralDrift } from './peripheralDrift';
import { ponzoCorridor } from './ponzoCorridor';
import { shrinkingRoom } from './shrinkingRoom';
import { underTheStripes } from './underTheStripes';
import type { ExhibitDefinition } from './types';

/**
 * 全展示の登録テーブル。順路の並びは order で決まる。
 *
 * Room A: 平面のだまし絵 / Room B: あり得ない立体 /
 * Room C: 空間と身体 / Room D: Opus 棟
 */
export const EXHIBITS: readonly ExhibitDefinition[] = [
  // Room A — 平面のだまし絵
  cafeWall,
  muellerLyer,
  checkerShadow,
  ebbinghaus,
  hering,
  peripheralDrift,
  // Room B — あり得ない立体
  penroseTriangle,
  penroseStairs,
  neckerCube,
  anamorphosis,
  // Room C — 空間と身体
  amesRoom,
  beuchetChair,
  hollowMask,
  ponzoCorridor,
  // Room D — Opus 棟（Room A〜C を一定数見ると開錠）
  underTheStripes,
  audibleCollision,
  shrinkingRoom,
];
