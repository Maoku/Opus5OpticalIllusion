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
import { buildWallPieces, pieceSlab, type WallPiece } from './wallGeometry';

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

    const slits = this.#buildCeilingSlits(area);
    if (slits) g.add(slits);
    const rail = this.#buildPictureRail(area, pieces);
    if (rail) g.add(rail);
    if (area.id === 'entrance') {
      for (const mesh of this.#buildEntranceFixtures(area)) g.add(mesh);
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

  // --------------------------------------------------------------- 内装
  //
  // §13 の制約:
  //   1. ライトを増やさない。Lighting はプール本数を起動時に固定しており、
  //      実行中に本数を変えると three がシェーダを再コンパイルしてカクつく。
  //      内装の「光」は全て発光マテリアルで表現する。
  //   2. 明度系錯視の背景を変えない。gallery のパレットは据え置き。
  //   3. ドローコールは部屋あたり +2 まで。だからエリアごとに 1 メッシュへ結合する。

  /** 天井のスリット照明の下端 */
  private static readonly SLIT_DROP = 0.04;
  /** ピクチャーレール（見切りの帯）の高さ */
  private static readonly RAIL_HEIGHT = 2.6;
  private static readonly RAIL_THICKNESS = 0.045;

  /**
   * 天井の細い発光帯（§13-1）。
   *
   * 近代美術館の記号としていちばん安く効く。実際の照明は増やさず、
   * 見た目だけを担う。エリアごとに 1 メッシュへ結合（制約 3）。
   * 天井の無い／狭いエリア（通路）には入れない。
   */
  #buildCeilingSlits(area: AreaDefinition): THREE.Mesh | null {
    if (area.ceiling === false) return null;
    const [x0, z0] = area.min;
    const [x1, z1] = area.max;
    const w = x1 - x0;
    const d = z1 - z0;
    /*
     * 天井の低いエリアには入れない。
     *   通路（3.2m）: 光る帯が真上に来て眩しいだけになる
     *   Opus 棟のアルコーブ（3.6m）: **暗さが D6 の成立条件**。
     *     発光する帯を天井に並べたら同化が壊れる（§13 制約 2 の趣旨）
     */
    if (Math.min(w, d) < 5 || area.height < 4) return null;

    // 長辺に沿って走らせ、短辺の方向に等間隔で並べる
    const alongX = w >= d;
    const span = alongX ? w : d;
    const across = alongX ? d : w;
    const count = Math.min(4, Math.max(2, Math.round(across / 6)));
    const length = Math.max(1, span - 2.4);
    const y = area.height - RoomBuilder.SLIT_DROP;

    const geometries: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      const geo = alongX
        ? new THREE.BoxGeometry(length, 0.05, 0.18)
        : new THREE.BoxGeometry(0.18, 0.05, length);
      geo.translate(
        alongX ? (x0 + x1) / 2 : x0 + across * t,
        y,
        alongX ? z0 + across * t : (z0 + z1) / 2,
      );
      geometries.push(geo);
    }
    const merged = mergeGeometries(geometries, false);
    for (const geo of geometries) geo.dispose();
    if (!merged) return null;

    const mesh = new THREE.Mesh(merged, this.#slitMaterial());
    mesh.name = `${area.id}-slits`;
    return mesh;
  }

  /**
   * ピクチャーレール（§13-2）。
   *
   * 壁の上端付近に見切りの帯を 1 本走らせる。壁面の巨大な無地を分割して
   * スケール感を与えるのが目的。幅木と同じく buildWallPieces の結果から作る。
   * 天井が低いエリアでは帯が目線に近すぎるので入れない。
   */
  #buildPictureRail(area: AreaDefinition, pieces: readonly WallPiece[]): THREE.Mesh | null {
    if (area.height < RoomBuilder.RAIL_HEIGHT + 0.8) return null;
    const geometries: THREE.BufferGeometry[] = [];
    for (const piece of pieces) {
      if (!piece.blocking) continue;
      geometries.push(
        pieceGeometry(
          {
            ...piece,
            y0: RoomBuilder.RAIL_HEIGHT,
            y1: RoomBuilder.RAIL_HEIGHT + RoomBuilder.RAIL_THICKNESS,
          },
          WALL_THICKNESS + BASEBOARD_OVERHANG * 2,
        ),
      );
    }
    const merged = mergeGeometries(geometries, false);
    for (const geo of geometries) geo.dispose();
    if (!merged) return null;

    const mesh = new THREE.Mesh(merged, this.#railMaterial(area.palette));
    mesh.receiveShadow = true;
    mesh.name = `${area.id}-rail`;
    return mesh;
  }

  /**
   * エントランスの造作（§13-4）。
   *
   * 天井高 6.0m の吹き抜けが空っぽで、規模のわりに何もない部屋だった。
   * 受付カウンター相当の低いボリュームを 1 つと、吹き抜けを活かした
   * 縦長のサイン面を置く。**文字は載せない** —— §12a で 3D 空間から
   * 説明文を撤去した方針を崩さないため、意匠としての面だけにする。
   */
  #buildEntranceFixtures(area: AreaDefinition): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const [, z0] = area.min;
    const [x1, z1] = area.max;

    // --- 受付カウンター（天板と本体を 1 メッシュへ結合） --------------------
    const counterX = -4.6;
    const counterZ = z1 - 4.2;
    const body = new THREE.BoxGeometry(3.4, 0.94, 0.78);
    body.translate(counterX, 0.47, counterZ);
    const top = new THREE.BoxGeometry(3.6, 0.06, 0.92);
    top.translate(counterX, 0.97, counterZ);
    const merged = mergeGeometries([body, top], false);
    body.dispose();
    top.dispose();
    if (merged) {
      const counter = new THREE.Mesh(merged, this.#counterMaterial());
      counter.castShadow = true;
      counter.receiveShadow = true;
      counter.name = 'entrance-counter';
      out.push(counter);
      // 通り抜けられると受付に見えない
      this.collision.addSegment(
        counterX - 1.8,
        counterZ,
        counterX + 1.8,
        counterZ,
        0.92,
        'entrance-counter',
      );
    }

    // --- 吹き抜けの縦長サイン面（意匠のみ・文字なし） ----------------------
    const banner = new THREE.BoxGeometry(0.9, 4.2, 0.06);
    banner.translate(x1 - 3.0, 3.1, z0 + 0.2);
    const sign = new THREE.Mesh(banner, this.#slitMaterial());
    sign.name = 'entrance-banner';
    out.push(sign);

    return out;
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

        /*
         * 床の目地（§13-3）。
         *
         * UV は 4m で 1 周するよう scaleUv() で伸ばしてあるので、
         * テクスチャを 4 分割すると **1m 間隔**の目地になる。改良計画は 1.2m
         * だが、それだと 4m の繰り返しで割り切れず継ぎ目に段差が出る。
         * 展示の真下でも主張しない濃度に抑えること。
         */
        ctx.globalAlpha = 0.14;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(1, w / 512);
        for (let i = 0; i < 4; i++) {
          const p = Math.round((i / 4) * w) + 0.5;
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, p);
          ctx.lineTo(w, p);
          ctx.stroke();
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

  /**
   * スリット照明の面材（§13-1）。
   *
   * MeshBasicMaterial は陰影を受けないので、部屋の明るさに関わらず
   * 一定の輝度で「光っている帯」に見える。実光源は増やさない（制約 1）。
   * toneMapped を切って、暗い Opus 棟でも同じ見え方にする。
   */
  #slitMaterial(): THREE.Material {
    return this.#material('slit', () => {
      const material = new THREE.MeshBasicMaterial({ color: 0xf4f1e8 });
      material.toneMapped = false;
      return material;
    });
  }

  #counterMaterial(): THREE.Material {
    return this.#material(
      'counter',
      () =>
        // 暗すぎると単なる黒い塊に見える。造作として読める明度にする
        new THREE.MeshStandardMaterial({ color: 0x3d414a, roughness: 0.5, metalness: 0.14 }),
    );
  }

  #railMaterial(palette: PaletteId): THREE.Material {
    return this.#material(`rail:${palette}`, () => {
      // 幅木の色をそのまま使うと、明るい壁の上で真っ黒な線になって主張しすぎる。
      // 壁の色を幅木側へ寄せた「影の線」くらいの濃さに留める
      const color = new THREE.Color(PALETTES[palette].wall).lerp(
        new THREE.Color(PALETTES[palette].baseboard),
        0.42,
      );
      return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.08 });
    });
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
  /*
   * 隣のエリアと共有する面では、板を半分に割って自分の側だけを建てる。
   * 両側が面をまたぐと同一平面が二重になってちらつくため（WallPiece.inner）。
   */
  const slab = pieceSlab(piece, thickness);
  const depth = slab.to - slab.from;
  const at = (slab.from + slab.to) / 2;
  const geo =
    piece.axis === 'z'
      ? new THREE.BoxGeometry(length, height, depth)
      : new THREE.BoxGeometry(depth, height, length);
  if (piece.axis === 'z') {
    geo.translate(center, piece.y0 + height / 2, at);
  } else {
    geo.translate(at, piece.y0 + height / 2, center);
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
