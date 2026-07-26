import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  AREAS,
  BASEBOARD_HEIGHT,
  BASEBOARD_OVERHANG,
  DOORWAYS,
  PALETTES,
  WALL_THICKNESS,
  type AreaDefinition,
  type PaletteId,
} from '../data/layout';
import { createCanvasTexture, drawNoise } from '../exhibits/common/CanvasTexture';
import type { Collision } from './Collision';
import { buildWallPieces, type WallPiece } from './wallGeometry';

export interface BuiltMuseum {
  group: THREE.Group;
  dispose(): void;
}

/**
 * 矩形エリアの配列から、床・壁・天井・幅木のメッシュと衝突線分を生成する。
 *
 * 描画コールを抑えるため、エリアごとに壁と幅木をそれぞれ 1 つに結合する。
 */
export class RoomBuilder {
  readonly #materials = new Map<string, THREE.Material>();
  readonly #textures: THREE.Texture[] = [];

  constructor(private readonly collision: Collision) {}

  build(): BuiltMuseum {
    const group = new THREE.Group();
    group.name = 'museum';

    for (const area of AREAS) {
      group.add(this.#buildArea(area));
    }

    return {
      group,
      dispose: () => {
        for (const t of this.#textures) t.dispose();
        for (const m of this.#materials.values()) m.dispose();
        this.#textures.length = 0;
        this.#materials.clear();
      },
    };
  }

  // ------------------------------------------------------------- internals

  #buildArea(area: AreaDefinition): THREE.Group {
    const g = new THREE.Group();
    g.name = area.id;
    const [x0, z0] = area.min;
    const [x1, z1] = area.max;
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;

    // 床
    const floorGeo = new THREE.PlaneGeometry(w, d);
    floorGeo.rotateX(-Math.PI / 2);
    scaleUv(floorGeo, w / 4, d / 4);
    floorGeo.translate(cx, 0, cz);
    const floor = new THREE.Mesh(floorGeo, this.#floorMaterial(area.palette));
    floor.receiveShadow = true;
    floor.name = `${area.id}-floor`;
    g.add(floor);

    // 天井
    if (area.ceiling !== false) {
      const ceilGeo = new THREE.PlaneGeometry(w, d);
      ceilGeo.rotateX(Math.PI / 2);
      ceilGeo.translate(cx, area.height, cz);
      const ceil = new THREE.Mesh(ceilGeo, this.#ceilingMaterial(area.palette));
      ceil.name = `${area.id}-ceiling`;
      g.add(ceil);
    }

    // 壁 + 幅木
    const pieces = buildWallPieces(area, DOORWAYS);
    const wallGeos: THREE.BufferGeometry[] = [];
    const baseGeos: THREE.BufferGeometry[] = [];
    for (const piece of pieces) {
      wallGeos.push(pieceGeometry(piece, WALL_THICKNESS));
      if (piece.blocking) {
        this.#addCollider(piece, WALL_THICKNESS);
        baseGeos.push(
          pieceGeometry(
            { ...piece, y0: 0, y1: BASEBOARD_HEIGHT },
            WALL_THICKNESS + BASEBOARD_OVERHANG * 2,
          ),
        );
      }
    }

    if (wallGeos.length > 0) {
      const merged = mergeGeometries(wallGeos, false);
      if (merged) {
        const walls = new THREE.Mesh(merged, this.#wallMaterial(area.palette));
        walls.castShadow = true;
        walls.receiveShadow = true;
        walls.name = `${area.id}-walls`;
        g.add(walls);
      }
      for (const geo of wallGeos) geo.dispose();
    }

    if (baseGeos.length > 0) {
      const merged = mergeGeometries(baseGeos, false);
      if (merged) {
        const base = new THREE.Mesh(merged, this.#baseboardMaterial(area.palette));
        base.receiveShadow = true;
        base.name = `${area.id}-baseboard`;
        g.add(base);
      }
      for (const geo of baseGeos) geo.dispose();
    }

    return g;
  }

  #addCollider(piece: WallPiece, thickness: number): void {
    if (!piece.blocking) return;
    if (piece.axis === 'z') {
      this.collision.addSegment(piece.from, piece.at, piece.to, piece.at, thickness);
    } else {
      this.collision.addSegment(piece.at, piece.from, piece.at, piece.to, thickness);
    }
  }

  // --------------------------------------------------------- materials

  #material<T extends THREE.Material>(key: string, create: () => T): T {
    const cached = this.#materials.get(key);
    if (cached) return cached as T;
    const created = create();
    this.#materials.set(key, created);
    return created;
  }

  #floorMaterial(palette: PaletteId): THREE.Material {
    return this.#material(`floor:${palette}`, () => {
      const color = PALETTES[palette].floor;
      const tex = createCanvasTexture({ width: 512, repeat: [1, 1] }, (ctx, w, h) => {
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(0, 0, w, h);
        // 磨いたコンクリートのごく淡いまだら。強くすると床が主張して展示を邪魔する
        ctx.globalAlpha = 0.02;
        for (let i = 0; i < 40; i++) {
          const r = 20 + ((i * 37) % 60);
          ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
          ctx.beginPath();
          ctx.arc((i * 71) % w, (i * 113) % h, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        drawNoise(ctx, w, h, 0.02, 7);
      });
      this.#textures.push(tex);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.02 });
    });
  }

  #wallMaterial(palette: PaletteId): THREE.Material {
    return this.#material(
      `wall:${palette}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: PALETTES[palette].wall,
          roughness: 0.95,
          metalness: 0,
        }),
    );
  }

  #ceilingMaterial(palette: PaletteId): THREE.Material {
    return this.#material(
      `ceiling:${palette}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: PALETTES[palette].ceiling,
          roughness: 1,
          metalness: 0,
        }),
    );
  }

  #baseboardMaterial(palette: PaletteId): THREE.Material {
    return this.#material(
      `baseboard:${palette}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: PALETTES[palette].baseboard,
          roughness: 0.7,
          metalness: 0.05,
        }),
    );
  }
}

function pieceGeometry(piece: WallPiece, thickness: number): THREE.BufferGeometry {
  const length = Math.abs(piece.to - piece.from);
  const height = piece.y1 - piece.y0;
  const center = (piece.from + piece.to) / 2;
  const geo =
    piece.axis === 'z'
      ? new THREE.BoxGeometry(length, height, thickness)
      : new THREE.BoxGeometry(thickness, height, length);
  if (piece.axis === 'z') {
    geo.translate(center, piece.y0 + height / 2, piece.at);
  } else {
    geo.translate(piece.at, piece.y0 + height / 2, center);
  }
  return geo;
}

function scaleUv(geometry: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}
