import { DEFAULT_EYE_HEIGHT } from '../../player/PlayerController';
import type { Footprint, Vec3Like, ViewSpotDefinition } from '../types';
import { PANEL_CENTER_HEIGHT } from './PanelExhibit';

export interface WallPlacement {
  position: Vec3Like;
  rotationY: number;
  viewSpots: ViewSpotDefinition[];
  /** 床の占有範囲（§10b）。ここで一緒に作るので、寸法とずれない */
  footprint: Footprint;
}

export interface WallPanelOptions {
  /** パネル中心の床上の位置 */
  x: number;
  z: number;
  /** パネルの正面方向。0 で +Z を向く */
  rotationY: number;
  /** 視点マーカーまでの距離 (m) */
  viewDistance: number;
  /** パネルの横幅。占有範囲の算出に使う */
  width: number;
  fov?: number;
  radius?: number;
  /** 注視点の高さ。既定はパネル中心 */
  targetHeight?: number;
}

/** rotationY からパネルの法線（正面方向）を返す */
export function facing(rotationY: number): { x: number; z: number } {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

/** 中心と半径から占有範囲を作る */
export function footprintAround(x: number, z: number, halfX: number, halfZ = halfX): Footprint {
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

/** 点が占有範囲の中にあるか。margin を足すと外側に余白を取れる */
export function footprintContains(f: Footprint, x: number, z: number, margin = 0): boolean {
  return (
    x >= f.minX - margin && x <= f.maxX + margin && z >= f.minZ - margin && z <= f.maxZ + margin
  );
}

/**
 * 壁掛けパネルの配置と ViewSpot をまとめて作る。
 * 「パネルの正面 viewDistance メートルに立ち、パネル中心を見る」が正解視点。
 */
export function wallPanel(options: WallPanelOptions): WallPlacement {
  const { x, z, rotationY, viewDistance, width } = options;
  const dir = facing(rotationY);
  const stand = { x: x + dir.x * viewDistance, z: z + dir.z * viewDistance };
  const target = options.targetHeight ?? PANEL_CENTER_HEIGHT;
  // パネルは壁に貼りつくので薄い。回転を効かせて世界軸に落とす
  const depth = 0.36;
  const halfX = Math.abs(dir.z) * (width / 2) + Math.abs(dir.x) * (depth / 2);
  const halfZ = Math.abs(dir.x) * (width / 2) + Math.abs(dir.z) * (depth / 2);
  return {
    // パネル中心をそのまま原点にする。展示側は原点にパネルを置けばよい
    position: { x, y: target, z },
    rotationY,
    footprint: footprintAround(x, z, halfX, halfZ),
    viewSpots: [
      {
        standAt: { x: stand.x, y: 0, z: stand.z },
        eye: { x: stand.x, y: DEFAULT_EYE_HEIGHT, z: stand.z },
        lookAt: { x, y: target, z },
        fov: options.fov ?? 52,
        radius: options.radius ?? 1.0,
      },
    ],
  };
}

/**
 * 床置き展示の配置。台の中心を position とし、そこから viewDistance 離れて立つ。
 * dirY は「立つ側」の方向（0 なら +Z 側に立つ）。
 */
export function pedestal(options: {
  x: number;
  z: number;
  /** 立つ側の方向。0 で +Z 側 */
  dirY: number;
  viewDistance: number;
  targetHeight: number;
  /** 台と展示物が床を占める半径。既定 0.6m */
  halfX?: number;
  halfZ?: number;
  fov?: number;
  radius?: number;
  eyeHeight?: number;
  projection?: 'perspective' | 'orthographic';
  orthoHeight?: number;
}): WallPlacement {
  const dir = facing(options.dirY);
  const stand = {
    x: options.x + dir.x * options.viewDistance,
    z: options.z + dir.z * options.viewDistance,
  };
  const eyeHeight = options.eyeHeight ?? DEFAULT_EYE_HEIGHT;
  const halfX = options.halfX ?? 0.6;
  return {
    position: { x: options.x, y: 0, z: options.z },
    // 展示自体は立つ側を向く
    rotationY: options.dirY,
    footprint: footprintAround(options.x, options.z, halfX, options.halfZ ?? halfX),
    viewSpots: [
      {
        standAt: { x: stand.x, y: 0, z: stand.z },
        eye: { x: stand.x, y: eyeHeight, z: stand.z },
        lookAt: { x: options.x, y: options.targetHeight, z: options.z },
        fov: options.fov ?? 50,
        radius: options.radius ?? 1.0,
        ...(options.projection ? { projection: options.projection } : {}),
        ...(options.orthoHeight !== undefined ? { orthoHeight: options.orthoHeight } : {}),
      },
    ],
  };
}
