// 拡張子を明記しているのは `tools/buildShadowHull.ts` のため。
// あちらは node --experimental-strip-types で動かすので、
// 拡張子なしの指定子を解決できない（tools/subsetFont.ts と同じ事情）。
import {
  blurField,
  carveVisualHull,
  clearBorder,
  rasterisePolygons,
  type Grid,
  type Polygon,
  type ShadowView,
} from './visualHull.ts';

/**
 * D5「嘘つきの影」の光学系とシルエット（ROOM_D §1）。
 *
 * ここが **展示コードとビルドスクリプトの唯一の共有点**である。
 * 光源とスクリーンの位置がずれた瞬間に影は意味を失うので、
 * 「実行時に立てるライトの座標」と「hull を彫るときの光源座標」は
 * 同じ定数から出さなければならない。数値を 2 か所に書いた時点で負ける。
 *
 * 座標は展示ローカル（root の原点は台座の足元、+Y が上）。
 * ExhibitManager が position と rotationY をルートに適用する。
 */

/** 塊の中心の高さ。2 つの光源もこの高さに置く */
export const LUMP_CENTRE_Y = 1.35;
/** 塊が占める立方体の半辺 */
export const LUMP_HALF = 0.32;
/** 光源までの距離。塊の中心から見た +Z / +X 方向 */
export const LIGHT_DISTANCE = 2.0;
/** スクリーンまでの距離（塊の中心から −Z / −X 方向） */
export const SCREEN_DISTANCE = 1.6;
/** 影の拡大率。(光源→スクリーン) / (光源→塊) */
export const MAGNIFICATION = (LIGHT_DISTANCE + SCREEN_DISTANCE) / LIGHT_DISTANCE;
/** スクリーン上の像の半辺。シルエットの ±1 がここに対応する */
export const SHADOW_HALF = LUMP_HALF * MAGNIFICATION;

/** スクリーン板の実寸（角で突き合わせるので、内側の端はもう一方の平面まで伸ばす） */
export const SCREEN_WIDTH = SCREEN_DISTANCE + 1.2;
export const SCREEN_HEIGHT = 2.6;
export const SCREEN_CENTRE_Y = LUMP_CENTRE_Y;

/**
 * ビルド時のボクセル解像度。
 *
 * 実測（tools/buildShadowHull.ts の報告）:
 *   64 → 三角形 21k / 490KB / coverage 99.2%
 *   80 → 三角形 33k / 780KB / coverage 99.4%
 *   96 → 三角形 48k / 1.1MB / coverage 95.6%（※ 旧シルエット）
 * 影の読みは 64 でも変わらないので、§9 の総アセット 5MB 以下を優先する。
 */
export const BUILD_RESOLUTION = 64;
/**
 * glTF を読めなかったときに実行時で彫る解像度。
 * 96³ は 100ms 単位の処理になるので、代替経路では粗くする。
 */
export const RUNTIME_RESOLUTION = 56;
/** シルエットマスクの解像度 */
export const MASK_SIZE = 256;

export const HULL_MODEL_PATH = 'models/shadowHull.glb';

/**
 * ★ 2 枚のシルエットは「高さの分布」を揃えること。
 *
 * 光源が 2 つとも同じ高さにあり、スクリーンが 2 枚とも鉛直なので、
 * ある高さ v の断面は「シルエット1 のその行 × シルエット2 のその行」という
 * 直積になる。**片方の行が空なら、もう片方のその行は必ず欠ける。**
 * hull が痩せる原因はほぼこれで、u 方向（横）の食い違いは問題にならない。
 *
 * 鳥の翼端（上）に魚の背びれを、魚の腹びれ（下）に鳥の脚を対応させてあるのは
 * そのため。`--preview` の '.' が欠け、'!' がはみ出しを示す。
 */

/** 鳥（横向き・翼を上げた飛翔形）。[-1, 1]²、y は上が正 */
export const BIRD: Polygon = [
  [0.95, 0.02], // くちばしの先
  [0.74, 0.18], // 頭
  [0.5, 0.26],
  [0.26, 0.62], // 翼の前縁
  [0.05, 0.82], // 翼端
  [-0.16, 0.5], // 翼の後縁
  [-0.3, 0.26],
  [-0.62, 0.3], // 尾の付け根
  [-0.95, 0.16], // 尾の先
  [-0.88, -0.06],
  [-0.6, -0.1],
  [-0.34, -0.22], // 腹
  [-0.16, -0.46], // 脚
  [0.0, -0.24],
  [0.2, -0.44], // 脚
  [0.34, -0.2],
  [0.6, -0.12], // 胸
  [0.8, -0.04],
];

/** 魚（横向き・右を向く） */
export const FISH: Polygon = [
  [0.95, 0.0], // 口先
  [0.62, 0.26],
  [0.3, 0.32],
  [0.1, 0.8], // 背びれ
  [-0.12, 0.3],
  [-0.46, 0.24],
  [-0.7, 0.55], // 尾びれ上
  [-0.95, 0.42],
  [-0.84, 0.0],
  [-0.95, -0.42],
  [-0.7, -0.5], // 尾びれ下
  [-0.46, -0.2],
  [-0.2, -0.3],
  [-0.02, -0.48], // 腹びれ
  [0.16, -0.3],
  [0.5, -0.28],
  [0.78, -0.14],
];

export interface SilhouettePair {
  name: string;
  /** 光源 1（ローカル +Z 側）が落とす影 */
  first: Polygon;
  /** 光源 2（ローカル +X 側）が落とす影 */
  second: Polygon;
}

/**
 * 試せる組み合わせ。ROOM_D §5 のリスク表が求める
 * 「スクリーンを先に作って複数の組み合わせを試せるようにする」ための入口。
 */
export const SILHOUETTE_PAIRS: readonly SilhouettePair[] = [
  { name: 'bird-fish', first: BIRD, second: FISH },
  { name: 'fish-bird', first: FISH, second: BIRD },
];

export const DEFAULT_PAIR = SILHOUETTE_PAIRS[0]!;

/** 光源の位置。dial は 2 灯まとめて塊の周りを回す角度（ラジアン） */
export function lightPosition(index: 0 | 1, dial = 0): [number, number, number] {
  // 0 番は +Z、1 番は +X。dial を足すと 2 灯とも同じ向きへ振れる
  const base = index === 0 ? 0 : Math.PI / 2;
  const angle = base + dial;
  return [Math.sin(angle) * LIGHT_DISTANCE, LUMP_CENTRE_Y, Math.cos(angle) * LIGHT_DISTANCE];
}

/**
 * hull を彫るためのグリッド。
 *
 * 塊の外接立方体より 12% 広く取る。Marching Cubes は端の 1 層で面を閉じられず、
 * `clearBorder` で空ける必要があるので、hull がグリッドの縁に触れていると
 * そこだけ切り落とされて影が欠ける。
 */
export function hullGrid(resolution: number): Grid {
  const half = LUMP_HALF * 1.12;
  return {
    resolution,
    min: [-half, LUMP_CENTRE_Y - half, -half],
    max: [half, LUMP_CENTRE_Y + half, half],
  };
}

/** シルエット 2 枚から、彫るための光学系を組み立てる */
export function shadowViews(
  pair: SilhouettePair = DEFAULT_PAIR,
  maskSize = MASK_SIZE,
): ShadowView[] {
  return [
    {
      light: lightPosition(0),
      axis: 'z',
      plane: -SCREEN_DISTANCE,
      centre: [0, LUMP_CENTRE_Y],
      half: SHADOW_HALF,
      mask: rasterisePolygons([pair.first], maskSize),
    },
    {
      light: lightPosition(1),
      axis: 'x',
      plane: -SCREEN_DISTANCE,
      centre: [0, LUMP_CENTRE_Y],
      half: SHADOW_HALF,
      mask: rasterisePolygons([pair.second], maskSize),
    },
  ];
}

/**
 * 彫る → ならす → 外周を空ける、までを一息で。
 * ビルドスクリプトと実行時の代替経路が同じ手順を踏むようにする。
 */
export function buildHullField(
  resolution: number,
  pair: SilhouettePair = DEFAULT_PAIR,
): { field: Float32Array; grid: Grid; views: ShadowView[] } {
  const grid = hullGrid(resolution);
  const views = shadowViews(pair);
  const carved = carveVisualHull(views, grid);
  const field = blurField(carved, resolution, 1);
  clearBorder(field, resolution, 2);
  return { field, grid, views };
}
