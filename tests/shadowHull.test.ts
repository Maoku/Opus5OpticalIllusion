import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  carveVisualHull,
  projectsInside,
  rasterisePolygons,
  shadowCoverage,
  type Grid,
  type Polygon,
} from '../src/exhibits/common/visualHull';
import {
  BUILD_RESOLUTION,
  DEFAULT_PAIR,
  LIGHT_DISTANCE,
  LUMP_CENTRE_Y,
  RUNTIME_RESOLUTION,
  SILHOUETTE_PAIRS,
  buildHullField,
  hullGrid,
  lightPosition,
  shadowViews,
} from '../src/exhibits/common/shadowHullSpec';
import { LYING_SHADOW_LAYOUT } from '../src/exhibits/lyingShadow';

/**
 * D5「嘘つきの影」（ROOM_D §1 / §5）。
 *
 * リスク表が挙げる失敗は 1 つ、**「visual hull が痩せて影が読めない」**である。
 * それは coverage で測れるので、ここで下限を固定する。
 */

const SQUARE: Polygon = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

describe('rasterisePolygons', () => {
  it('fills the inside of a polygon and nothing else', () => {
    const mask = rasterisePolygons([SQUARE], 64);
    const at = (x: number, y: number): number => mask.data[y * 64 + x]!;
    expect(at(32, 32)).toBe(1); // 中央
    expect(at(2, 2)).toBe(0); // 隅
    let filled = 0;
    for (const value of mask.data) filled += value;
    // 一辺 1.0 の正方形 ÷ 一辺 2.0 の枠 = 面積比 1/4
    expect(filled / mask.data.length).toBeCloseTo(0.25, 2);
  });

  it('handles concave outlines', () => {
    // コの字。凹んだ部分が塗られないこと
    const c: Polygon = [
      [-0.8, -0.8],
      [0.8, -0.8],
      [0.8, -0.4],
      [-0.4, -0.4],
      [-0.4, 0.4],
      [0.8, 0.4],
      [0.8, 0.8],
      [-0.8, 0.8],
    ];
    const mask = rasterisePolygons([c], 64);
    const at = (u: number, v: number): number => {
      const x = Math.floor(((u + 1) / 2) * 64);
      const y = Math.floor(((1 - v) / 2) * 64);
      return mask.data[y * 64 + x]!;
    };
    expect(at(-0.6, 0)).toBe(1);
    expect(at(0.4, 0)).toBe(0);
    expect(at(0.4, 0.6)).toBe(1);
  });
});

describe('carveVisualHull', () => {
  const grid: Grid = { resolution: 24, min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
  const views = [
    {
      light: [0, 0, 4] as const,
      axis: 'z' as const,
      plane: -2,
      centre: [0, 0] as const,
      half: 1.5,
      mask: rasterisePolygons([SQUARE], 128),
    },
    {
      light: [4, 0, 0] as const,
      axis: 'x' as const,
      plane: -2,
      centre: [0, 0] as const,
      half: 1.5,
      mask: rasterisePolygons([SQUARE], 128),
    },
  ];

  it('keeps only the voxels that both silhouettes agree on', () => {
    const field = carveVisualHull(views, grid);
    let inside = 0;
    for (const value of field) inside += value;
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(field.length);
  });

  it('rejects points that fall outside a silhouette', () => {
    // シルエットの外（画面の隅へ抜ける方向）
    expect(projectsInside(views[0]!, 0, 0, 0)).toBe(true);
    expect(projectsInside(views[0]!, 0.9, 0.9, 0)).toBe(false);
  });

  it('never keeps a voxel behind the light', () => {
    expect(projectsInside(views[0]!, 0, 0, 6)).toBe(false);
  });
});

describe('the shipped silhouette pair', () => {
  const { field, grid, views } = buildHullField(RUNTIME_RESOLUTION, DEFAULT_PAIR);

  /**
   * 実行時に彫り直す経路（glTF が読めなかったとき）でも影が読めること。
   * ビルド時の 80³ はこれより高い数値が出る（tools/buildShadowHull.ts の報告）。
   */
  it('casts both shadows almost completely, even at the runtime resolution', () => {
    for (const [index, view] of views.entries()) {
      const report = shadowCoverage(view, field, grid);
      expect(report.ratio, `view ${index}`).toBeGreaterThan(0.9);
    }
  });

  it('stays clear of the grid border, so marching cubes can close the surface', () => {
    const n = grid.resolution;
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const edge = x < 2 || y < 2 || z < 2 || x >= n - 2 || y >= n - 2 || z >= n - 2;
          if (edge) expect(field[(z * n + y) * n + x]).toBe(0);
        }
      }
    }
  });

  it('offers more than one pair to try, as §5 asks', () => {
    expect(SILHOUETTE_PAIRS.length).toBeGreaterThan(1);
  });

  it('puts both lights at the height of the lump, so the two shadows share their rows', () => {
    for (const index of [0, 1] as const) {
      expect(lightPosition(index)[1]).toBe(LUMP_CENTRE_Y);
      expect(Math.hypot(lightPosition(index)[0], lightPosition(index)[2])).toBeCloseTo(
        LIGHT_DISTANCE,
        6,
      );
    }
  });

  it('separates the two lights by 90°', () => {
    const a = lightPosition(0);
    const b = lightPosition(1);
    const dot = a[0] * b[0] + a[2] * b[2];
    expect(dot).toBeCloseTo(0, 6);
  });
});

describe('the viewpoint of the lying shadow', () => {
  /** 立ち位置が光路に入ると、来館者自身の影で作品が壊れる */
  it('does not stand in either beam', () => {
    const { position, rotationY, stand } = LYING_SHADOW_LAYOUT;
    const local = {
      x:
        (stand.x - position.x) * Math.cos(rotationY) - (stand.z - position.z) * Math.sin(rotationY),
      z:
        (stand.x - position.x) * Math.sin(rotationY) + (stand.z - position.z) * Math.cos(rotationY),
    };
    for (const index of [0, 1] as const) {
      const light = lightPosition(index);
      // 光源から塊への線分と、立ち位置との距離
      const dx = -light[0];
      const dz = -light[2];
      const length = Math.hypot(dx, dz);
      const distance = Math.abs((local.x - light[0]) * dz - (local.z - light[2]) * dx) / length;
      expect(distance, `beam ${index}`).toBeGreaterThan(1.0);
    }
  });
});

describe('the built artefact', () => {
  /**
   * `tools/buildShadowHull.ts` の成果物。無くても展示は動く（実行時に彫り直す）が、
   * 壊れた GLB をコミットしてしまうと読み込みエラーとして表に出る。
   */
  it('is a valid binary glTF', () => {
    const buffer = readFileSync('public/models/shadowHull.glb');
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    expect(view.getUint32(0, true), 'magic').toBe(0x46546c67);
    expect(view.getUint32(4, true), 'version').toBe(2);
    expect(view.getUint32(8, true), 'declared length').toBe(buffer.byteLength);

    const jsonLength = view.getUint32(12, true);
    expect(view.getUint32(16, true), 'JSON chunk').toBe(0x4e4f534a);
    const json = JSON.parse(new TextDecoder().decode(buffer.subarray(20, 20 + jsonLength)));
    expect(json.meshes[0].primitives[0].attributes).toHaveProperty('POSITION');
    expect(json.meshes[0].primitives[0].attributes).toHaveProperty('NORMAL');

    // 塊はグリッドの中に収まっていること（台座を突き抜けない）
    const grid = hullGrid(BUILD_RESOLUTION);
    const min = json.accessors[0].min as number[];
    const max = json.accessors[0].max as number[];
    for (let axis = 0; axis < 3; axis++) {
      expect(min[axis]!).toBeGreaterThanOrEqual(grid.min[axis]! - 1e-4);
      expect(max[axis]!).toBeLessThanOrEqual(grid.max[axis]! + 1e-4);
    }
  });

  it('stays small enough for the asset budget', () => {
    const buffer = readFileSync('public/models/shadowHull.glb');
    expect(buffer.byteLength).toBeLessThan(1_500_000);
  });
});

/** 素の shadowViews が spec どおりの光学系を返すこと */
describe('shadowViews', () => {
  it('aims both screens at the lump', () => {
    const views = shadowViews();
    expect(views).toHaveLength(2);
    expect(views[0]!.axis).toBe('z');
    expect(views[1]!.axis).toBe('x');
    for (const view of views) {
      expect(view.centre[1]).toBe(LUMP_CENTRE_Y);
      expect(projectsInside(view, 0, LUMP_CENTRE_Y, 0)).toBe(true);
    }
  });
});
