import * as THREE from 'three';
import type { Dictionary } from '../i18n';
import { createTextPlate, type TextPlate, type TextPlateLine } from './TextPlate';

/**
 * 出入口の上の部屋名サイン（Phase 7 / §12a）。
 *
 * §12a で 3D 空間から**説明文を全て撤去した**。自立式の案内板と展示ごとの
 * キャプション板は無くなり、ここに残るのは部屋名だけ。
 * 部屋名は説明ではなく順路案内であり、撤去すると順路が読めなくなる（決定事項 A）。
 *
 * 失われた情報の行き先:
 *   展示名・キャプション・注意書き → ヒントパネル（HintPanel）
 *   操作説明 → HUD の常設キーガイド ＋ 設定メニューの「操作方法」
 *   入館時の導入文 → ローディング／入場画面（LoadingScreen）
 *
 * §5.4: 言語切替でワールド内テキストは作り直しになる。setDictionary() が全板を描き直す。
 */
export class Signage {
  readonly group = new THREE.Group();
  readonly #plates: Array<{ plate: TextPlate; render: (t: Dictionary) => TextPlateLine[] }> = [];
  readonly #posts: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene, dictionary: Dictionary) {
    this.group.name = 'signage';
    scene.add(this.group);

    // --- 出入口の上の部屋名サイン -----------------------------------------
    const sign = { width: 2.0, height: 0.36, scale: 2.4 };
    // エントランス → 通路 → Room B
    this.#add(sign, { x: 0, y: 3.55, z: 12.72 }, 0, (t) => [
      { text: t.rooms.impossible, weight: 'title' as const },
    ]);
    // Room B の西口 → Room A
    this.#add(sign, { x: -9.72, y: 3.55, z: -4 }, Math.PI / 2, (t) => [
      { text: t.rooms.plane, weight: 'title' as const },
    ]);
    // Room B の東口 → Room C
    this.#add(sign, { x: 9.72, y: 3.55, z: -4 }, -Math.PI / 2, (t) => [
      { text: t.rooms.space, weight: 'title' as const },
    ]);
    // Room B の南口 → Opus 棟（Room B の側から読めるよう +Z を向ける）
    this.#add(sign, { x: 0, y: 3.55, z: -12.72 }, 0, (t) => [
      { text: t.rooms.opus, weight: 'title' as const },
    ]);

    this.setDictionary(dictionary);
  }

  setDictionary(t: Dictionary): void {
    for (const { plate, render } of this.#plates) plate.setLines(render(t));
  }

  dispose(): void {
    for (const { plate } of this.#plates) plate.dispose();
    this.#plates.length = 0;
    for (const post of this.#posts.splice(0)) {
      post.geometry.dispose();
      (post.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }

  #add(
    size: { width: number; height: number; post?: number; scale?: number },
    position: { x: number; y: number; z: number },
    rotationY: number,
    render: (t: Dictionary) => TextPlateLine[],
  ): void {
    const plate = createTextPlate({
      width: size.width,
      height: size.height,
      align: 'left',
      ...(size.scale !== undefined ? { scale: size.scale } : {}),
    });
    plate.root.position.set(position.x, position.y, position.z);
    plate.root.rotation.y = rotationY;
    this.group.add(plate.root);
    this.#plates.push({ plate, render });

    if (size.post) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.05, size.post, 12),
        new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.75 }),
      );
      post.position.set(position.x, size.post / 2, position.z);
      post.castShadow = true;
      post.receiveShadow = true;
      this.#posts.push(post);
      this.group.add(post);
    }
  }
}
