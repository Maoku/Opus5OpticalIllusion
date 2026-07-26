/**
 * ミュージアムの寸法データ。単位はメートル、Y が上。
 *
 *                 [entrance]
 *                     │  corridorMain
 *      ┌──────────────┼──────────────┐
 *   [roomA]─linkAB─[roomB]─linkBC─[roomC]
 *      └──────────────┼──────────────┘
 *                     │  corridorD
 *                  [roomD]  ← Opus 棟（扉なし。初回から開放）
 *
 * 壁は矩形エリアの4辺から自動生成し、`DOORWAYS` の AABB と重なる部分を刳り抜く。
 * こうすると隣接エリアの共有壁が両側から同時に開くので、通路の端に壁が残らない。
 */

export type AreaId =
  | 'entrance'
  | 'corridorMain'
  | 'roomA'
  | 'roomB'
  | 'roomC'
  | 'linkAB'
  | 'linkBC'
  | 'corridorD'
  | 'roomD'
  | 'roomDNorth'
  | 'roomDAlcove';

/** 展示が属する「部屋」。通路はどれかの部屋に含める。 */
export type RoomId = 'entrance' | 'plane' | 'impossible' | 'space' | 'opus';

export interface AreaDefinition {
  id: AreaId;
  room: RoomId;
  /** XZ 平面の矩形 [minX, minZ] */
  min: readonly [number, number];
  /** XZ 平面の矩形 [maxX, maxZ] */
  max: readonly [number, number];
  height: number;
  /** 天井を張るか（大広間だけ高い天井を見せたい等の調整用） */
  ceiling?: boolean;
  palette: PaletteId;
}

export type PaletteId = 'hall' | 'gallery' | 'corridor' | 'opus' | 'opusBright';

export interface Palette {
  floor: number;
  wall: number;
  ceiling: number;
  baseboard: number;
}

export const PALETTES: Record<PaletteId, Palette> = {
  hall: { floor: 0x2a2d34, wall: 0xd9d6cf, ceiling: 0xf0eee9, baseboard: 0x3a3d44 },
  // ギャラリーの壁は「白すぎない」中間明度。明度系の錯視の背景として重要。
  gallery: { floor: 0x3b3a37, wall: 0xc9c6bf, ceiling: 0xe6e4df, baseboard: 0x4a4844 },
  corridor: { floor: 0x33353b, wall: 0xb4b2ac, ceiling: 0xd8d6d1, baseboard: 0x42444a },
  // Opus 棟のアルコーブ。暗さが成立条件の展示（D6）だけをここに集める。
  opus: { floor: 0x14151a, wall: 0x24252c, ceiling: 0x101116, baseboard: 0x1a1b21 },
  /*
   * Opus 棟の本体（§12c）。歩ける明るさを確保する。
   * 以前は棟ぜんぶが opus の暗さで、視認性が低く歩けたものではなかった。
   *
   * 床の反射率がいちばん効く。照明を上げるだけでは壁ばかりが明るくなるので、
   * 床・幅木の側も持ち上げてある。ギャラリーよりは十分暗いまま。
   */
  opusBright: { floor: 0x33353d, wall: 0x44464f, ceiling: 0x22242a, baseboard: 0x2f313a },
};

/** 通路の高さ。ドア開口の高さもこれに揃えると、通路側に無駄な壁が残らない。 */
export const DOOR_HEIGHT = 3.2;
export const WALL_THICKNESS = 0.3;
export const BASEBOARD_HEIGHT = 0.14;
export const BASEBOARD_OVERHANG = 0.04;

export const AREAS: readonly AreaDefinition[] = [
  {
    id: 'entrance',
    room: 'entrance',
    min: [-8, 13],
    max: [8, 27],
    height: 6.0,
    palette: 'hall',
  },
  {
    id: 'corridorMain',
    room: 'entrance',
    min: [-3, 3],
    max: [3, 13],
    height: DOOR_HEIGHT,
    palette: 'corridor',
  },
  { id: 'roomA', room: 'plane', min: [-34, -13], max: [-14, 3], height: 4.5, palette: 'gallery' },
  {
    id: 'roomB',
    room: 'impossible',
    min: [-10, -13],
    max: [10, 3],
    height: 4.5,
    palette: 'gallery',
  },
  { id: 'roomC', room: 'space', min: [14, -13], max: [34, 3], height: 4.5, palette: 'gallery' },
  {
    id: 'linkAB',
    room: 'plane',
    min: [-14, -6],
    max: [-10, -2],
    height: DOOR_HEIGHT,
    palette: 'corridor',
  },
  {
    id: 'linkBC',
    room: 'space',
    min: [10, -6],
    max: [14, -2],
    height: DOOR_HEIGHT,
    palette: 'corridor',
  },
  {
    id: 'corridorD',
    room: 'opus',
    min: [-3, -19],
    max: [3, -13],
    height: DOOR_HEIGHT,
    palette: 'corridor',
  },
  /*
   * Opus 棟（§12c）。「明るい本体 + 暗いアルコーブ」の 3 矩形に分けてある。
   * 以前は棟ぜんぶが opus の暗さで、歩行時の視認性が低かった。
   * 暗さが成立条件の展示（D6「縞の下の嘘」）だけをアルコーブへ集める。
   *
   *        corridorD
   *            │
   *   ┌────────┴──────────┐
   *   │ alcove │ roomDNorth│  z ∈ [-28, -19]
   *   ├────────┴──────────┤
   *   │      roomD        │  z ∈ [-41, -28]（大広間。天井を高く取る）
   *   └───────────────────┘
   */
  {
    id: 'roomD',
    room: 'opus',
    min: [-14, -41],
    max: [14, -28],
    height: 6.5,
    palette: 'opusBright',
  },
  {
    id: 'roomDNorth',
    room: 'opus',
    min: [-4, -28],
    max: [14, -19],
    height: 6.5,
    palette: 'opusBright',
  },
  // 明順応の落差を作るため、天井も低く抑える
  {
    id: 'roomDAlcove',
    room: 'opus',
    min: [-14, -28],
    max: [-4, -19],
    height: 3.6,
    palette: 'opus',
  },
];

export interface Doorway {
  /** XZ の刳り抜き範囲 */
  min: readonly [number, number];
  max: readonly [number, number];
  height: number;
}

export const DOORWAYS: readonly Doorway[] = [
  // entrance <-> corridorMain
  { min: [-3, 12.5], max: [3, 13.5], height: DOOR_HEIGHT },
  // corridorMain <-> roomB
  { min: [-3, 2.5], max: [3, 3.5], height: DOOR_HEIGHT },
  // roomA <-> linkAB <-> roomB
  { min: [-14.5, -6], max: [-13.5, -2], height: DOOR_HEIGHT },
  { min: [-10.5, -6], max: [-9.5, -2], height: DOOR_HEIGHT },
  // roomB <-> linkBC <-> roomC
  { min: [9.5, -6], max: [10.5, -2], height: DOOR_HEIGHT },
  { min: [13.5, -6], max: [14.5, -2], height: DOOR_HEIGHT },
  // roomB <-> corridorD <-> roomDNorth
  // §12b: ここには施錠扉があった。扉という概念ごと削除し、他の 7 箇所と
  // まったく同じ素通しの開口にしてある。Opus 棟は初回から入れる。
  { min: [-3, -13.5], max: [3, -12.5], height: DOOR_HEIGHT },
  { min: [-3, -19.5], max: [3, -18.5], height: DOOR_HEIGHT },
  // roomDNorth <-> roomD（大広間へ。縮んでいく部屋の入口を含む幅を取る）
  { min: [-3, -28.5], max: [5, -27.5], height: DOOR_HEIGHT },
  // roomDNorth <-> roomDAlcove（暗い小部屋への唯一の入口）
  { min: [-4.5, -24], max: [-3.5, -20], height: DOOR_HEIGHT },
];

/** プレイヤーの初期位置（エントランス奥、通路を向いて立つ） */
export const SPAWN = { x: 0, z: 23, yaw: 0 } as const;

export function areaById(id: AreaId): AreaDefinition {
  const area = AREAS.find((a) => a.id === id);
  if (!area) throw new Error(`unknown area: ${id}`);
  return area;
}

/** 与えられた XZ 座標を含むエリアを返す（現在の部屋名表示・照明の切替に使う） */
export function areaAt(x: number, z: number): AreaDefinition | null {
  for (const a of AREAS) {
    if (x >= a.min[0] && x <= a.max[0] && z >= a.min[1] && z <= a.max[1]) return a;
  }
  return null;
}
