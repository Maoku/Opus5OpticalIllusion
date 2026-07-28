import { amesRoom } from './amesRoom';
import { audibleCollision } from './audibleCollision';
import { anamorphosis } from './anamorphosis';
import { behindYou } from './behindYou';
import { beuchetChair } from './beuchetChair';
import { cafeWall } from './cafeWall';
import { checkerShadow } from './checkerShadow';
import { ebbinghaus } from './ebbinghaus';
import { hering } from './hering';
import { hollowMask } from './hollowMask';
import { lyingShadow } from './lyingShadow';
import { muellerLyer } from './muellerLyer';
import { neckerCube } from './neckerCube';
import { penroseStairs } from './penroseStairs';
import { penroseTriangle } from './penroseTriangle';
import { peripheralDrift } from './peripheralDrift';
import { ponzoCorridor } from './ponzoCorridor';
import { shrinkingRoom } from './shrinkingRoom';
import { twoTruths } from './twoTruths';
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
  /*
   * Room D — Opus 棟。順路は D6（色）→ D4（音）→ D3（記憶）→ D5（影）→
   * D2（身体）→ D1（大広間・看板作品）。疑われる対象が
   * 「展示物 → 自分の知覚 → 自分の身体」へ移っていく（ROOM_D §4）。
   */
  underTheStripes,
  audibleCollision,
  behindYou,
  lyingShadow,
  shrinkingRoom,
  twoTruths,
];
