import * as THREE from 'three';
import { DEFAULT_EYE_HEIGHT } from '../player/PlayerController';
import { damp, saturate } from '../utils/math';
import { createTextPlate, type TextPlate } from '../world/TextPlate';
import { glyphSpacing, rasteriseGlyph, sampleGlyphs } from './common/GlyphSampler';
import { solveDualView, type Fragment } from './common/dualView';
import { footprintAround } from './common/placement';
import type { BuildContext, ExhibitDefinition, ExhibitInstance, HintContent } from './types';

/**
 * D1「二つの真実」/ Two Truths（ROOM_D §1・看板作品）。
 *
 * ★ 成立条件: **観測者が自分の足で歩くこと**。
 *   大広間の中空に、数百の小さな板片が浮かんでいる。ただの塵の雲にしか見えない。
 *   視点マーカー A に立つと断片が一斉に整列して「真」を結び、
 *   反対側の B に立つと、**まったく同じ断片が**「偽」を結ぶ。
 *   2 枚の写真を並べれば「別の彫刻だ」と思われて終わる。同じ物体の周りを歩き、
 *   **途中の無意味な状態を見て初めて**「1 つの物体だった」という驚きが成立する。
 *
 * ★ 文字は日本語のまま固定する（§5.4 の確定方針）。
 *   TRUE / FALSE には置き換えない。作品の主題は言語ではなく形であり、
 *   読めない人にとっては「無意味な塵から形が立ち上がる」というより純粋な体験になる。
 *   ただし **reveal の山場と意味の到達がズレる**問題があるので、字が結ばれた
 *   0.4 秒後に、字の脇へグロスラベルを出す（`glyphGloss`。ja では出さない）。
 *
 * 断片の配置は初期化時に解く（`common/dualView.ts`）。ビルド時に焼かないのは、
 * 字を差し替えて画数と点数の釣り合いを試せる余地を残すため。
 */

/*
 * この 2 文字だけは辞書へ出さない。文言ではなく **彫刻の形そのもの**であり、
 * §5.4 の確定方針で locale 非依存に固定してある（英語版でも字形は変えない）。
 * 意味のほうは辞書の `glyphGloss` が担う。
 */
/* eslint-disable no-restricted-syntax -- 展示物の形状であって翻訳対象の文言ではない */
const GLYPH_A = '真';
const GLYPH_B = '偽';
/* eslint-enable no-restricted-syntax */
/** 字の実寸（m） */
const GLYPH_SIZE = 1.9;
/** 字の中心の高さ */
const GLYPH_CENTRE_Y = 1.85;
/** 断片の目標数。10 画と 11 画なら、この密度で両方を賄える */
const TARGET_POINTS = 300;
/** 立ち位置と字の距離 */
const VIEW_DISTANCE = 4.0;
/**
 * 断片の見かけの大きさ。隣の断片との間隔に対する比で決める。
 * 1.0 を超えると板どうしが重なって字が塗り潰しになる。
 */
const SIZE_RATIO = 0.72;
/**
 * 間引きの閾値。これも間隔に対する比。
 * 格子で並べた点は必ず 1 間隔ぶん離れているので、正規の隣を落とさずに
 * 「たまたま同じ方向へ重なった別の断片」だけを落とせる。
 */
const SEPARATION_RATIO = 0.55;

/**
 * 大広間の南西。2 つの視線がどちらも「暗い壁」を背負う位置に置いてある。
 * 視点 A（南 → 北）の奥は D5 の裏側と北の壁、視点 B（東 → 西）の奥は西の壁。
 * 明るい面が背景に入ると、断片の雲がそこに溶けて字が読めない。
 */
const POSITION = { x: -9.5, y: 0, z: -36 };
/** A は南（棟の最奥）、B は東。90° 離すと両視点から板の面が見える */
const SPOT_A = { x: POSITION.x, z: POSITION.z - VIEW_DISTANCE };
const SPOT_B = { x: POSITION.x + VIEW_DISTANCE, z: POSITION.z };

/** グロスラベルが出るまでの間（秒）。字が結ばれる前に出すと reveal を台無しにする */
const GLOSS_DELAY = 0.4;
/** この距離まで近づいたら「その視点に立っている」とみなす */
const SPOT_RANGE = 1.3;

function solveFragments(
  eyeA: THREE.Vector3,
  eyeB: THREE.Vector3,
  centre: THREE.Vector3,
): Fragment[] {
  const masks = [rasteriseGlyph(GLYPH_A), rasteriseGlyph(GLYPH_B)];
  const [pointsA, pointsB] = sampleGlyphs(masks, TARGET_POINTS);
  // 隣り合う断片の間隔。大きさも間引きの閾値もここから導く。
  // 数値を独立に持つと、字や点数を変えたときに片方だけ古い前提のまま残る
  const pitch = (glyphSpacing(masks, TARGET_POINTS) / masks[0]!.width) * GLYPH_SIZE;
  const angularPitch = pitch / VIEW_DISTANCE;
  return solveDualView({
    eyeA,
    eyeB,
    centre,
    glyphSize: GLYPH_SIZE,
    pointsA: pointsA ?? [],
    pointsB: pointsB ?? [],
    // 中点に置くので、この値の半分が字からのずれの上限になる。
    // 間隔より十分小さくないと、隣の画へ滲む
    maxError: pitch * 0.9,
    angularSize: angularPitch * SIZE_RATIO,
    minSeparation: angularPitch * SEPARATION_RATIO,
  });
}

/** TextPlate の板そのもの。フェードのために材質を取り出す */
function plateMaterial(plate: TextPlate): THREE.MeshBasicMaterial | null {
  for (const child of plate.root.children) {
    if (child instanceof THREE.Mesh) return child.material as THREE.MeshBasicMaterial;
  }
  return null;
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const centre = new THREE.Vector3(POSITION.x, GLYPH_CENTRE_Y, POSITION.z);
  const eyes = [
    new THREE.Vector3(SPOT_A.x, DEFAULT_EYE_HEIGHT, SPOT_A.z),
    new THREE.Vector3(SPOT_B.x, DEFAULT_EYE_HEIGHT, SPOT_B.z),
  ] as const;

  const fragments = solveFragments(eyes[0], eyes[1], centre);

  // --- 断片の雲 -------------------------------------------------------------
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd9d3c5,
    roughness: 0.58,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const cloud = new THREE.InstancedMesh(geometry, material, Math.max(1, fragments.length));
  cloud.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  cloud.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const forward = new THREE.Vector3(0, 0, 1);
  const scale = new THREE.Vector3();
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!;
    quaternion.setFromUnitVectors(forward, fragment.normal);
    // 面内の向きだけ散らす。四角い板が全部同じ向きだと格子に見える
    spin.setFromAxisAngle(fragment.normal, (((i * 97) % 31) / 31) * Math.PI);
    quaternion.multiply(spin);
    scale.set(fragment.size, fragment.size, 1);
    // ルートは POSITION に置かれるので、断片はローカル座標へ移す
    matrix.compose(fragment.position.clone().sub(origin), quaternion, scale);
    cloud.setMatrixAt(i, matrix);
  }
  cloud.instanceMatrix.needsUpdate = true;
  root.add(cloud);

  // 断片を宙に吊っているように見せるための光。
  // 実際の吊り糸は描かない。糸が字と重なると、結んだ形の輪郭が読めなくなる
  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(0, 5.6, 0.6)),
    target: centre.clone(),
    color: 0xf6efe2,
    intensity: 24,
    angle: 0.52,
    penumbra: 0.6,
    distance: 12,
    critical: true,
  });

  // --- グロスラベル（§5.4）--------------------------------------------------
  // 字が結ばれた後にだけ、字の右下へ小さく出す。ja では出さない
  const labels = eyes.map((eye) => {
    const plate = createTextPlate({
      width: 1.3,
      height: 0.34,
      frame: false,
      align: 'center',
      background: 'rgba(0,0,0,0)',
      // 字の脇に小さく添える。読めるが、字より目立たない大きさ
      scale: 1.25,
    });
    const view = centre.clone().sub(eye).normalize();
    const right = new THREE.Vector3().crossVectors(view, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, view).normalize();
    const at = centre
      .clone()
      .addScaledVector(right, GLYPH_SIZE * 0.62)
      .addScaledVector(up, -GLYPH_SIZE * 0.46);
    plate.root.position.copy(at.sub(origin));
    plate.root.lookAt(eye.clone().sub(origin));
    plate.root.visible = false;
    root.add(plate.root);
    const material = plateMaterial(plate);
    if (material) material.opacity = 0;
    return { plate, material, text: '' };
  });

  let dwell = 0;
  let active = -1;

  const applyLocale = (content: HintContent): void => {
    // 1 行目が視点 A（真）、2 行目が視点 B（偽）
    const lines = (content.glyphGloss ?? '').split('\n');
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]!;
      label.text = (lines[i] ?? '').trim();
      if (label.text) label.plate.setLines([{ text: label.text, weight: 'note' }]);
    }
  };

  return {
    root,
    setLocale(content) {
      applyLocale(content);
    },
    update(dt) {
      // どちらの正解視点に立っているか。ロックしていなくても、
      // 自分の足で歩いて立った人にも同じ体験を返す
      let nearest = -1;
      let best = SPOT_RANGE;
      for (let i = 0; i < eyes.length; i++) {
        const distance = ctx.camera.position.distanceTo(eyes[i]!);
        if (distance < best) {
          best = distance;
          nearest = i;
        }
      }
      if (nearest !== active) {
        active = nearest;
        dwell = 0;
      }
      dwell += dt;

      for (let i = 0; i < labels.length; i++) {
        const label = labels[i]!;
        if (!label.material) continue;
        // 字が結ばれてから GLOSS_DELAY 後にフェードイン
        const wanted = i === active && dwell > GLOSS_DELAY && label.text ? 1 : 0;
        const opacity = THREE.MathUtils.lerp(label.material.opacity, wanted, damp(6, dt));
        label.material.opacity = saturate(opacity);
        label.plate.root.visible = label.material.opacity > 0.01;
      }
    },
    setRevealed() {
      // 種明かしはカメラ（revealCamera: 'traverse'）が担う。
      // 断片は 1 つも動かない。動くのは観測者だけ、というのがこの展示の主題
    },
    dispose() {
      removeSpot();
      cloud.dispose();
      geometry.dispose();
      material.dispose();
      for (const label of labels) label.plate.dispose();
    },
  };
}

export const twoTruths: ExhibitDefinition = {
  id: 'twoTruths',
  textKey: 'twoTruths',
  room: 'opus',
  kind: 'object',
  // 順路の最後。大広間の最奥に置く（ROOM_D §4）
  order: 25,
  reveal: 'none',
  // ROOM_D §2.1: 2 つの正解視点のあいだを渡る
  revealCamera: 'traverse',
  revealFocus: { x: 0, y: GLYPH_CENTRE_Y, z: 0 },
  position: POSITION,
  rotationY: 0,
  footprint: footprintAround(POSITION.x, POSITION.z, 1.9),
  viewSpots: [
    {
      tag: 'A',
      standAt: { x: SPOT_A.x, y: 0, z: SPOT_A.z },
      eye: { x: SPOT_A.x, y: DEFAULT_EYE_HEIGHT, z: SPOT_A.z },
      lookAt: { x: POSITION.x, y: GLYPH_CENTRE_Y, z: POSITION.z },
      fov: 40,
      radius: 1.1,
    },
    {
      tag: 'B',
      standAt: { x: SPOT_B.x, y: 0, z: SPOT_B.z },
      eye: { x: SPOT_B.x, y: DEFAULT_EYE_HEIGHT, z: SPOT_B.z },
      lookAt: { x: POSITION.x, y: GLYPH_CENTRE_Y, z: POSITION.z },
      fov: 40,
      radius: 1.1,
    },
  ],
  build,
};

/** 断片配置の検査に使う（tests/twoTruths.test.ts） */
export const TWO_TRUTHS_LAYOUT = {
  position: POSITION,
  centre: { x: POSITION.x, y: GLYPH_CENTRE_Y, z: POSITION.z },
  eyeHeight: DEFAULT_EYE_HEIGHT,
  glyphSize: GLYPH_SIZE,
  spots: [SPOT_A, SPOT_B],
  targetPoints: TARGET_POINTS,
};
