import * as THREE from 'three';
import { resolveCircleSegment, segmentIntersectionT } from '../utils/math';

export interface WallCollider {
  a: THREE.Vector2;
  b: THREE.Vector2;
  /** 壁の厚みの半分。プレイヤー半径に加算して判定する */
  halfThickness: number;
  /** AABB による早期棄却用 */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 後からまとめて外すための印（施錠扉など） */
  tag?: string;
}

/** めり込み解消の反復回数。角で2枚の壁に同時に当たるケースを解くのに 3 回あれば足りる。 */
const PASSES = 4;

/**
 * XZ 平面の壁線分に対する円（プレイヤー）の衝突解決。
 *
 * 「押し出し」を反復適用するだけの素朴な実装だが、
 * 壁が軸平行かつ本数が3桁に収まる本作ではこれで十分に安定する。
 * 角で引っかからずスライドすること（Phase 3 DoD）がこの反復に懸かっている。
 */
export class Collision {
  readonly walls: WallCollider[] = [];

  addSegment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    thickness: number,
    tag?: string,
  ): void {
    const a = new THREE.Vector2(ax, az);
    const b = new THREE.Vector2(bx, bz);
    const half = thickness / 2;
    this.walls.push({
      a,
      b,
      halfThickness: half,
      minX: Math.min(ax, bx) - half,
      maxX: Math.max(ax, bx) + half,
      minZ: Math.min(az, bz) - half,
      maxZ: Math.max(az, bz) + half,
      ...(tag !== undefined ? { tag } : {}),
    });
  }

  removeByTag(tag: string): void {
    for (let i = this.walls.length - 1; i >= 0; i--) {
      if (this.walls[i]!.tag === tag) this.walls.splice(i, 1);
    }
  }

  clear(): void {
    this.walls.length = 0;
  }

  /**
   * position（XZ）を半径 radius の円としてすべての壁から押し出す。
   * 引数を破壊的に更新し、補正が入ったかどうかを返す。
   */
  resolve(position: THREE.Vector2, radius: number): boolean {
    let touched = false;
    for (let pass = 0; pass < PASSES; pass++) {
      let moved = false;
      for (const wall of this.walls) {
        const r = radius + wall.halfThickness;
        if (
          position.x + r < wall.minX ||
          position.x - r > wall.maxX ||
          position.y + r < wall.minZ ||
          position.y - r > wall.maxZ
        ) {
          continue;
        }
        const push = resolveCircleSegment(position, r, wall.a, wall.b);
        if (push) {
          position.add(push);
          moved = true;
          touched = true;
        }
      }
      if (!moved) break;
    }
    return touched;
  }

  /**
   * from から to へ移動しようとした結果の位置を返す（スライド解決込み）。引数は変更しない。
   *
   * まず経路が壁の中心線を横切らないか調べ（高速移動やワープでの壁抜け対策）、
   * 横切るならその手前で止めてから押し出しを掛ける。
   */
  move(from: THREE.Vector2, to: THREE.Vector2, radius: number): THREE.Vector2 {
    const next = to.clone();
    let earliest = 1;
    for (const wall of this.walls) {
      const t = segmentIntersectionT(from, to, wall.a, wall.b);
      if (t !== null && t < earliest) earliest = t;
    }
    if (earliest < 1) {
      // 中心線の手前 1mm で止める。この後の押し出しで正しい距離まで戻される
      const back = Math.max(0, earliest - 1e-3);
      next.set(from.x + (to.x - from.x) * back, from.y + (to.y - from.y) * back);
    }
    this.resolve(next, radius);
    return next;
  }

  /** 指定位置が壁にめり込んでいるか（ワープ先の妥当性検査に使う） */
  isBlocked(position: THREE.Vector2, radius: number): boolean {
    const probe = position.clone();
    return this.resolve(probe, radius);
  }
}
