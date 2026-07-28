/**
 * Visual hull（ROOM_D §1 の D5「嘘つきの影」）。
 *
 * 「2 つの影を同時に満たす立体」を作る。手順は設計書のとおり:
 *
 *   1. シルエットを 2 枚のマスクとして用意する
 *   2. ボクセルグリッドを全 ON で初期化する
 *   3. 各ボクセルを光源 L1 からシルエット平面へ投影 → 外なら OFF
 *   4. L2 でも同様
 *   5. 残ったボクセル集合が visual hull
 *   6. Marching Cubes でメッシュ化する
 *
 * 数学は単純で失敗しないが、**シルエットの組み合わせは失敗する**。
 * 矛盾しすぎる 2 枚だと hull が痩せて影が欠ける。そこを機械で測れるよう、
 * 生成（`carveVisualHull`）と検証（`shadowCoverage`）を対で用意し、
 * どちらも DOM も WebGL も要らない純粋な計算にしてある。
 * `tools/buildShadowHull.ts` と Vitest の両方から同じ関数を呼ぶ。
 */

export type Vec3 = readonly [number, number, number];
export type Point2 = readonly [number, number];
/** 閉じた多角形。頂点は [-1, 1]² の座標で、y は上が正 */
export type Polygon = readonly Point2[];

export interface Mask {
  /** 正方マスクの一辺（画素） */
  size: number;
  /** 0 か 1。data[y * size + x]、y は下向き */
  data: Uint8Array;
}

/** 多角形の集合を塗り潰してマスクにする（偶奇規則のスキャンライン） */
export function rasterisePolygons(polygons: readonly Polygon[], size: number): Mask {
  const data = new Uint8Array(size * size);
  const crossings: number[] = [];
  for (let py = 0; py < size; py++) {
    // 画素中心の高さを [-1, 1] へ。マスクは上が +1
    const y = 1 - ((py + 0.5) / size) * 2;
    crossings.length = 0;
    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!;
        const b = polygon[(i + 1) % polygon.length]!;
        if (a[1] === b[1]) continue;
        const lower = Math.min(a[1], b[1]);
        const upper = Math.max(a[1], b[1]);
        if (y < lower || y >= upper) continue;
        crossings.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const x0 = Math.ceil(((crossings[i]! + 1) / 2) * size - 0.5);
      const x1 = Math.floor(((crossings[i + 1]! + 1) / 2) * size - 0.5);
      for (let px = Math.max(0, x0); px <= Math.min(size - 1, x1); px++) {
        data[py * size + px] = 1;
      }
    }
  }
  return { size, data };
}

/**
 * 影を落とす 1 系統ぶんの光学系。
 *
 * スクリーンは軸に平行な平面に限っている。任意平面まで一般化しても
 * 使うのは軸平行の 2 枚だけで、読みづらくなるぶんが損になる。
 */
export interface ShadowView {
  /** 点光源の位置（展示ローカル座標） */
  light: Vec3;
  /** スクリーンの法線軸。'z' なら平面 z = plane */
  axis: 'x' | 'z';
  plane: number;
  /** 平面上の像の中心 [u, v]。u は axis === 'z' なら x、'x' なら z */
  centre: Point2;
  /** 像の半辺（m）。マスクの ±1 がこの幅に対応する */
  half: number;
  /** u 軸の向き。左右が反転するときに -1 を渡す */
  uSign?: 1 | -1;
  mask: Mask;
}

export interface Grid {
  resolution: number;
  min: Vec3;
  max: Vec3;
}

/** グリッドのボクセル中心座標 */
export function voxelCentre(grid: Grid, ix: number, iy: number, iz: number): Vec3 {
  const n = grid.resolution;
  return [
    grid.min[0] + ((ix + 0.5) / n) * (grid.max[0] - grid.min[0]),
    grid.min[1] + ((iy + 0.5) / n) * (grid.max[1] - grid.min[1]),
    grid.min[2] + ((iz + 0.5) / n) * (grid.max[2] - grid.min[2]),
  ];
}

/** 点をスクリーンへ投影し、マスクの中に入っているかを返す */
export function projectsInside(view: ShadowView, x: number, y: number, z: number): boolean {
  const axisIndex = view.axis === 'x' ? 0 : 2;
  const along = axisIndex === 0 ? x : z;
  const denominator = along - view.light[axisIndex];
  if (Math.abs(denominator) < 1e-9) return false;
  const t = (view.plane - view.light[axisIndex]) / denominator;
  // 光源より手前（t <= 0）は影にならない
  if (t <= 0) return false;

  const hitU =
    axisIndex === 0
      ? view.light[2] + (z - view.light[2]) * t
      : view.light[0] + (x - view.light[0]) * t;
  const hitV = view.light[1] + (y - view.light[1]) * t;

  const u = (((hitU - view.centre[0]) * (view.uSign ?? 1)) / view.half) * 0.5 + 0.5;
  const v = 0.5 - ((hitV - view.centre[1]) / view.half) * 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const px = Math.floor(u * view.mask.size);
  const py = Math.floor(v * view.mask.size);
  return view.mask.data[py * view.mask.size + px] === 1;
}

/**
 * ボクセルを彫る。全 ON から始め、どれか 1 つの視点でシルエットの外に出たら OFF。
 * 戻り値は 0 / 1 のスカラー場（Marching Cubes へそのまま渡せる）。
 */
export function carveVisualHull(views: readonly ShadowView[], grid: Grid): Float32Array {
  const n = grid.resolution;
  const field = new Float32Array(n * n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const [x, y, z] = voxelCentre(grid, ix, iy, iz);
        let inside = true;
        for (const view of views) {
          if (!projectsInside(view, x, y, z)) {
            inside = false;
            break;
          }
        }
        if (inside) field[(iz * n + iy) * n + ix] = 1;
      }
    }
  }
  return field;
}

/**
 * 場をならす。二値のままだと Marching Cubes の面が階段になり、
 * 「金属の塊」ではなく「レゴ」に見える。等値面 0.5 で切る前提の平滑化なので、
 * 表面の位置はほとんど動かない。
 */
export function blurField(field: Float32Array, resolution: number, passes = 1): Float32Array {
  const n = resolution;
  let source = field;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float32Array(source.length);
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let sum = 0;
          let count = 0;
          for (let dz = -1; dz <= 1; dz++) {
            const zz = z + dz;
            if (zz < 0 || zz >= n) continue;
            for (let dy = -1; dy <= 1; dy++) {
              const yy = y + dy;
              if (yy < 0 || yy >= n) continue;
              for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx;
                if (xx < 0 || xx >= n) continue;
                sum += source[(zz * n + yy) * n + xx]!;
                count++;
              }
            }
          }
          out[(z * n + y) * n + x] = sum / count;
        }
      }
    }
    source = out;
  }
  return source;
}

/** グリッドの外周 1 層を空ける。Marching Cubes が端の面を閉じられないため */
export function clearBorder(field: Float32Array, resolution: number, layers = 2): void {
  const n = resolution;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const edge =
          x < layers ||
          y < layers ||
          z < layers ||
          x >= n - layers ||
          y >= n - layers ||
          z >= n - layers;
        if (edge) field[(z * n + y) * n + x] = 0;
      }
    }
  }
}

export interface CoverageReport {
  /** シルエットの画素数 */
  total: number;
  /** そのうち実際に影が落ちる画素数 */
  covered: number;
  /** covered / total。1 に近いほど影がシルエットどおりに出る */
  ratio: number;
}

/**
 * 影がシルエットをどれだけ満たすかを測る。
 *
 * シルエットの各画素について、光源からその画素へ向かうレイを飛ばし、
 * 途中で hull を通過するかを調べる。visual hull の定義上 1.0 に近くなるはずだが、
 * 2 枚のシルエットが矛盾しすぎていると露骨に落ちる。**この数値が
 * 「シルエットの組み合わせを試す」ための唯一の客観指標**になる。
 */
export function shadowCoverage(
  view: ShadowView,
  field: Float32Array,
  grid: Grid,
  isolation = 0.5,
): CoverageReport {
  const n = grid.resolution;
  const size = view.mask.size;
  const axisIndex = view.axis === 'x' ? 0 : 2;
  const step =
    Math.min(grid.max[0] - grid.min[0], grid.max[1] - grid.min[1], grid.max[2] - grid.min[2]) /
    n /
    2;

  let total = 0;
  let covered = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      if (view.mask.data[py * size + px] !== 1) continue;
      total++;

      // 画素の中心に対応するスクリーン上の点
      const u = ((px + 0.5) / size) * 2 - 1;
      const v = 1 - ((py + 0.5) / size) * 2;
      const hitU = view.centre[0] + (u * view.half) / (view.uSign ?? 1);
      const hitV = view.centre[1] + v * view.half;
      const target: [number, number, number] = [0, hitV, 0];
      target[axisIndex] = view.plane;
      target[axisIndex === 0 ? 2 : 0] = hitU;

      if (marchHitsHull(view.light, target, field, grid, isolation, step)) covered++;
    }
  }
  return { total, covered, ratio: total === 0 ? 0 : covered / total };
}

/** 光源から目標点までのレイが hull を通るか。等間隔サンプリングで足りる */
function marchHitsHull(
  from: Vec3,
  to: Vec3,
  field: Float32Array,
  grid: Grid,
  isolation: number,
  step: number,
): boolean {
  const n = grid.resolution;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-9) return false;
  const steps = Math.ceil(length / step);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from[0] + dx * t;
    const y = from[1] + dy * t;
    const z = from[2] + dz * t;
    const ix = Math.floor(((x - grid.min[0]) / (grid.max[0] - grid.min[0])) * n);
    const iy = Math.floor(((y - grid.min[1]) / (grid.max[1] - grid.min[1])) * n);
    const iz = Math.floor(((z - grid.min[2]) / (grid.max[2] - grid.min[2])) * n);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= n || iy >= n || iz >= n) continue;
    if (field[(iz * n + iy) * n + ix]! >= isolation) return true;
  }
  return false;
}

export interface HullMesh {
  /** 3 個ずつで 1 頂点。インデックスなし（Marching Cubes の出力そのまま） */
  positions: Float32Array;
  normals: Float32Array;
  triangles: number;
}

/**
 * スカラー場をメッシュにする。
 *
 * three の `MarchingCubes` を借りる。表を自前で持つより短く、素性も確かで、
 * 法線も場の勾配から出してくれる。実行時には使わない経路なので動的 import で
 * 分割し、ビルド成果物（glTF）が読めたときはこのコードを取りに行かない。
 */
export async function fieldToMesh(
  field: Float32Array,
  grid: Grid,
  isolation = 0.5,
  maxPolyCount = 120000,
): Promise<HullMesh> {
  const { MarchingCubes } = await import('three/addons/objects/MarchingCubes.js');
  const { MeshBasicMaterial } = await import('three');

  const n = grid.resolution;
  const material = new MeshBasicMaterial();
  const marching = new MarchingCubes(n, material, false, false, maxPolyCount);
  marching.isolation = isolation;
  marching.field.set(field);
  marching.update();

  const count = marching.count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  // MarchingCubes のローカル座標は [-1, 1]。グリッドの実寸へ移す
  const halfX = (grid.max[0] - grid.min[0]) / 2;
  const halfY = (grid.max[1] - grid.min[1]) / 2;
  const halfZ = (grid.max[2] - grid.min[2]) / 2;
  const cx = (grid.max[0] + grid.min[0]) / 2;
  const cy = (grid.max[1] + grid.min[1]) / 2;
  const cz = (grid.max[2] + grid.min[2]) / 2;
  for (let i = 0; i < count; i++) {
    positions[i * 3] = cx + marching.positionArray[i * 3]! * halfX;
    positions[i * 3 + 1] = cy + marching.positionArray[i * 3 + 1]! * halfY;
    positions[i * 3 + 2] = cz + marching.positionArray[i * 3 + 2]! * halfZ;
    // MarchingCubes の法線は場の勾配そのままで、長さが揃っていない
    const nx = marching.normalArray[i * 3]!;
    const ny = marching.normalArray[i * 3 + 1]!;
    const nz = marching.normalArray[i * 3 + 2]!;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / length;
    normals[i * 3 + 1] = ny / length;
    normals[i * 3 + 2] = nz / length;
  }
  material.dispose();
  return { positions, normals, triangles: count / 3 };
}
