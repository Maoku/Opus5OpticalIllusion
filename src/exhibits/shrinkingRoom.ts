import * as THREE from 'three';
import { DEFAULT_EYE_HEIGHT } from '../player/PlayerController';
import { clamp, damp, easeInOutSine, lerp, saturate } from '../utils/math';
import { createTextPlate, type TextPlate } from '../world/TextPlate';
import { createCanvasTexture } from './common/CanvasTexture';
import type { BuildContext, ExhibitDefinition, ExhibitInstance, HintContent } from './types';

/**
 * D2「縮んでいく部屋」/ The Shrinking Room（ROOM_D §1）。
 *
 * ★ 成立条件: **観測者の身体が改変されること**。
 *   何の変哲もない廊下。歩いているうちに、プレイヤーの目線の高さが
 *   1.60m から 1.15m へ気づけない速さで下がる。来館者は自分が縮んでいるとは思わず
 *   「この部屋、だんだん天井が高くなってないか？」と感じる。
 *
 * ★ 「効いているのに伝わらない」への対策（分かりにくさの原因は 3 つあった）:
 *
 *   1. **効果がそもそも起きていなかった**。ドリフトは滞在時間だけで進み、
 *      60 秒かかる設計だったが、廊下は 11m しかなく歩けば 4 秒で抜ける。
 *      抜けた時点の低下量は 5mm。誰も何も体験していなかった。
 *      → 進行度を「滞在時間」と「廊下の中で歩いた距離」の**大きいほう**で決める。
 *        往復ぶん歩けば必ず下がりきる。あわせて廊下では歩調を落とす（{@link CORRIDOR_SPEED}）。
 *        速さの上限（{@link MAX_DRIFT_RATE}）を別に設け、走っても「沈む」と気づかせない。
 *
 *   2. **比較する手がかりが何も無かった**。裸の灰色の壁では、目線が 45cm 下がっても
 *      画面はほとんど変わらない。
 *      → 入室時の目線 1.60m の高さに、**廊下の全長を走る水平の見切り縁**を通す。
 *        眼高と同じ高さの水平線は消失点へ向かって一直線に見える。縮むにつれて
 *        両側の縁が上へ反り返り、「部屋が伸びた」感覚が画として立ち上がる。
 *
 *   3. **答え合わせの場所が無かった**。出口の細い線が頭上を通るだけで、
 *      それが何 cm なのか、そもそも自分が下がったのか天井が上がったのかが読めない。
 *      → 廊下を突き当たりにして、そこへ**身長計**を掛ける。目盛は実寸。
 *        1.60m には「入室時のあなたの目の高さ」の帯。近づくと、**いまの目の高さ**を
 *        指す標識が現れる。2 本の差が、そのまま自分が失った高さになる。
 *
 * ★ 安全側の設計（ROOM_D §5 のリスク表）:
 *   - prefers-reduced-motion か設定トグルで完全に無効化する
 *   - スマホは 3D 酔いのリスクが高いのでドリフトを緩める（§4.5）
 *   - 巻き戻しは ExhibitManager が退出時・dispose 時・ワープ時に保証する
 */

const START_HEIGHT = DEFAULT_EYE_HEIGHT;
const END_HEIGHT = 1.15;

/** 立ち止まったままでも下がりきるまでの時間 */
const DRIFT_SECONDS = 45;
const DRIFT_SECONDS_MOBILE = 70;
/**
 * 歩いて下がりきるまでの距離（m）。廊下は 11m なので、突き当たりまで行って
 * 引き返せば必ず下がりきる。到達時点では 7 割ほど進んでいる。
 */
const DRIFT_METRES = 16;
const DRIFT_METRES_MOBILE = 22;
/**
 * 目線が下がる速さの上限（m/s）。ダッシュで距離を稼いでも、これより速くは下がらない。
 * 気づかれない速さの上限であって、演出の都合ではない。
 */
const MAX_DRIFT_RATE = 0.05;
/**
 * 廊下の中での歩調。ここを素通りの速さで歩かれると、45cm を「沈んだ」と
 * 気づかれずに配れる時間が作れない。狭い廊下で歩を緩めること自体は自然に読める。
 */
const CORRIDOR_SPEED = 0.5;

const HALF_WIDTH = 1.4;
const HEIGHT = 2.6;
const Z_NEAR = -27.5;
const Z_FAR = -38.5;
const POSITION = { x: 0, y: 0, z: (Z_NEAR + Z_FAR) / 2 };
const LENGTH = Z_NEAR - Z_FAR;

/** 壁の内側の面。見切り縁と身長計はここに合わせる */
const WALL_THICKNESS = 0.24;
const INNER_X = HALF_WIDTH - WALL_THICKNESS / 2;
/** 突き当たりの壁（ローカル z）。廊下は行き止まりで、そこが答え合わせの場になる */
const END_Z = Z_FAR - POSITION.z;

/** 身長計の実寸と、目盛が受け持つ高さの範囲 */
const GAUGE_WIDTH = 2.4;
const GAUGE_BOTTOM = 0.1;
const GAUGE_TOP = 2.5;
const GAUGE_HEIGHT = GAUGE_TOP - GAUGE_BOTTOM;
const GAUGE_Z = END_Z + 0.02;
const GAUGE_WORLD_Z = POSITION.z + GAUGE_Z;
/** 標識が完全に見える距離 / 消える距離 */
const MARKER_NEAR = 3.0;
const MARKER_FAR = 5.5;
/** 標識の見出しを、標識そのものから下へ逃がす量 */
const MARKER_LABEL_DROP = 0.14;

const FONT_STACK = 'system-ui, "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif';

/** 目盛の世界座標の高さ → テクスチャの y 画素 */
function gaugePixel(metres: number, texHeight: number): number {
  return ((GAUGE_TOP - metres) / GAUGE_HEIGHT) * texHeight;
}

/**
 * 身長計を描く。目盛は実寸で、板の上下端がそのまま {@link GAUGE_TOP} /
 * {@link GAUGE_BOTTOM} に対応する。標識のメッシュと目盛が必ず一致する。
 */
function drawGauge(ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  ctx.fillStyle = '#191c22';
  ctx.fillRect(0, 0, w, h);

  for (let cm = 90; cm <= 240; cm += 5) {
    const y = gaugePixel(cm / 100, h);
    const major = cm % 10 === 0;
    const length = major ? w * 0.1 : w * 0.05;
    const thickness = major ? 3 : 2;
    ctx.fillStyle = major ? '#9aa2ae' : '#5a616c';
    ctx.fillRect(0, y - thickness / 2, length, thickness);
    ctx.fillRect(w - length, y - thickness / 2, length, thickness);
    // 数字は 20cm ごと。5cm ごとに入れると近づいたときに潰れる
    if (cm % 20 === 0) {
      ctx.font = `500 ${Math.round(h * 0.026)}px ${FONT_STACK}`;
      ctx.fillStyle = '#b9c0cb';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText((cm / 100).toFixed(2), length + h * 0.014, y);
    }
  }

  // 入室時の目線。廊下を走る見切り縁が、板の左右の端でこの高さへ着地する
  const band = gaugePixel(START_HEIGHT, h);
  ctx.fillStyle = '#ff5c3d';
  ctx.fillRect(0, band - 7, w, 14);
  if (label) {
    // 帯の上に置く。下に置くと、縮んだ目線の標識と重なって読めなくなる
    ctx.font = `600 ${Math.round(h * 0.028)}px ${FONT_STACK}`;
    ctx.fillStyle = '#ffb3a2';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, band - h * 0.022);
  }
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
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x6e727b, roughness: 0.95 });
  /*
   * 見切り縁と方立。廊下が暗いので自己発光を少し混ぜる。
   * ここが読めないと「部屋が伸びた」を支える手がかりが消える。
   */
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0xa8aeb8,
    roughness: 0.7,
    emissive: 0x1b1e24,
  });
  const geometries: THREE.BufferGeometry[] = [];

  const addBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };

  // 側壁と天井。原点は廊下の中心なので z は 0 基準
  addBox(wallMaterial, WALL_THICKNESS, HEIGHT, LENGTH, -HALF_WIDTH, HEIGHT / 2, 0);
  addBox(wallMaterial, WALL_THICKNESS, HEIGHT, LENGTH, HALF_WIDTH, HEIGHT / 2, 0);
  addBox(wallMaterial, HALF_WIDTH * 2 + WALL_THICKNESS, 0.16, LENGTH, 0, HEIGHT, 0);
  // 突き当たり。行き止まりにすることで、来館者は必ず身長計の前で立ち止まり、
  // 引き返すぶんの距離でドリフトが下がりきる
  addBox(
    wallMaterial,
    HALF_WIDTH * 2 + WALL_THICKNESS,
    HEIGHT,
    WALL_THICKNESS,
    0,
    HEIGHT / 2,
    END_Z - WALL_THICKNESS / 2,
  );

  /*
   * 入室時の目線 1.60m を通る見切り縁。廊下の全長を走らせるのが要点で、
   * 眼高と同じ高さの水平線は消失点へ向かって一直線に見える。縮むにつれて
   * 両側の縁が上へ反り返り、「天井が高くなった」感覚の根拠になる。
   */
  for (const side of [-1, 1]) {
    addBox(trimMaterial, 0.06, 0.05, LENGTH, side * INNER_X, START_HEIGHT, 0);
    // 方立。歩いた距離と部屋の伸びを読むための刻み
    for (let i = 1; i <= 5; i++) {
      const z = -LENGTH / 2 + (LENGTH * i) / 6;
      addBox(trimMaterial, 0.05, HEIGHT, 0.14, side * INNER_X, HEIGHT / 2, z);
      if (side < 0) addBox(trimMaterial, HALF_WIDTH * 2, 0.012, 0.05, 0, 0.006, z);
    }
  }

  // 側壁と突き当たりの当たり判定。ExhibitManager が展示 ID のタグで一括除去する
  const id = ctx.definition.id;
  for (const side of [-1, 1]) {
    ctx.collision.addSegment(
      POSITION.x + side * HALF_WIDTH,
      Z_NEAR,
      POSITION.x + side * HALF_WIDTH,
      Z_FAR,
      WALL_THICKNESS,
      id,
    );
  }
  ctx.collision.addSegment(
    POSITION.x - HALF_WIDTH,
    Z_FAR,
    POSITION.x + HALF_WIDTH,
    Z_FAR,
    WALL_THICKNESS,
    id,
  );

  // ---------------------------------------------------------------- 身長計

  let gaugeLabel = '';
  const gaugeMaterial = new THREE.MeshBasicMaterial({ transparent: true });
  gaugeMaterial.toneMapped = false;
  let gaugeTexture: THREE.CanvasTexture | null = null;
  const paintGauge = (): void => {
    gaugeTexture?.dispose();
    gaugeTexture = createCanvasTexture(
      { width: 1024, height: 1024, wrap: THREE.ClampToEdgeWrapping },
      (c, w, h) => drawGauge(c, w, h, gaugeLabel),
    );
    gaugeMaterial.map = gaugeTexture;
    gaugeMaterial.needsUpdate = true;
  };
  paintGauge();

  const gauge = new THREE.Mesh(
    new THREE.PlaneGeometry(GAUGE_WIDTH, GAUGE_HEIGHT),
    gaugeMaterial,
  );
  gauge.position.set(0, (GAUGE_TOP + GAUGE_BOTTOM) / 2, GAUGE_Z);
  root.add(gauge);

  /*
   * いまの目の高さを指す標識。近づいたときだけ現れる。
   * 廊下の入口から読めてしまうと「縮んでいる最中」に気づいてしまい、
   * 気づかせないことで成り立つ展示の前提が崩れる。
   */
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd2b0,
    transparent: true,
    opacity: 0,
  });
  markerMaterial.toneMapped = false;
  // 板より少し短くする。目線が 1.60m へ戻ったとき、橙の帯を塗り潰さずに重なる
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(GAUGE_WIDTH * 0.84, 0.035, 0.02),
    markerMaterial,
  );
  marker.position.set(0, START_HEIGHT, GAUGE_Z + 0.03);
  root.add(marker);

  const markerLabel = createTextPlate({
    width: 1.9,
    height: 0.2,
    frame: false,
    align: 'center',
    background: 'rgba(0,0,0,0)',
    // 3m ほど離れた位置から読める大きさ。既定の注記サイズでは小さすぎた
    scale: 1.7,
  });
  markerLabel.setLines([]);
  // 標識の「下」に置く。上に出すと、目線が 1.60m に近い間は帯の見出しと重なる
  markerLabel.root.position.set(0, START_HEIGHT - MARKER_LABEL_DROP, GAUGE_Z + 0.04);
  root.add(markerLabel.root);
  const markerLabelMaterial = plateMaterial(markerLabel);
  if (markerLabelMaterial) markerLabelMaterial.opacity = 0;

  /*
   * タネあかしで身体が 1.60m へ戻るとき、直前の目線の高さに残す影。
   * 「戻った」ことではなく「どれだけ低くなっていたか」が山場なので、
   * 戻ったあとも差が目盛の上に残っていなければ意味がない。
   */
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2f0eb,
    transparent: true,
    opacity: 0,
  });
  ghostMaterial.toneMapped = false;
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(GAUGE_WIDTH * 0.84, 0.025, 0.02),
    ghostMaterial,
  );
  ghost.position.set(0, END_HEIGHT, GAUGE_Z + 0.05);
  ghost.visible = false;
  root.add(ghost);

  const removeSpot = ctx.lighting.addSpot({
    position: new THREE.Vector3(POSITION.x, HEIGHT - 0.2, POSITION.z + LENGTH * 0.3),
    target: new THREE.Vector3(POSITION.x, 0.4, POSITION.z - LENGTH * 0.35),
    color: 0xf3ecdd,
    // decay = 0 で距離減衰を切り、廊下全体を均一に照らす。
    // 明るさの勾配が残ると「奥ほど暗い」が奥行きの手がかりになってしまう
    intensity: 4.2,
    angle: 0.86,
    penumbra: 0.8,
    distance: 0,
    decay: 0,
    critical: true,
  });

  let inside = false;
  let dwell = 0;
  /** 廊下の中で歩いた距離。ドリフトの主な駆動源 */
  let travelled = 0;
  let lastX = 0;
  let lastZ = 0;
  let hasLast = false;
  let height = START_HEIGHT;
  let markerY = START_HEIGHT;
  let fade = 0;
  let revealed = false;

  /** 上書きを完全に取り下げる。目線の高さは PlayerController が 0.4 秒ほどで戻す */
  const releaseOverride = (): void => {
    ctx.playerOverride.setEyeHeight(null);
    ctx.playerOverride.setMoveSpeedScale(null);
  };

  const restart = (): void => {
    dwell = 0;
    travelled = 0;
    hasLast = false;
    height = START_HEIGHT;
    markerY = START_HEIGHT;
  };

  return {
    root,
    setLocale(content: HintContent) {
      // 1 行目が身長計の帯（入室時）、2 行目が標識（いま）
      const lines = (content.scale ?? '').split('\n');
      gaugeLabel = (lines[0] ?? '').trim();
      paintGauge();
      const now = (lines[1] ?? '').trim();
      markerLabel.setLines(now ? [{ text: now, weight: 'note' }] : []);
      if (markerLabelMaterial) markerLabelMaterial.opacity = fade;
    },
    onZoneEnter() {
      inside = true;
      restart();
    },
    onZoneExit() {
      inside = false;
      restart();
      fade = 0;
      releaseOverride();
    },
    update(dt) {
      if (!inside) return;
      const camera = ctx.camera.position;

      // 廊下の中で歩いた距離。ワープの飛びは 1 フレームぶんとして数えない
      if (hasLast) {
        const step = Math.hypot(camera.x - lastX, camera.z - lastZ);
        if (step < 0.6) travelled += step;
      }
      lastX = camera.x;
      lastZ = camera.z;
      hasLast = true;

      // 無効化されていたら身体は触らない。滞在中に切られた場合もここで巻き戻る
      if (!ctx.flags.shrinkingRoom || ctx.flags.reducedMotion || revealed) {
        releaseOverride();
      } else {
        dwell += dt;
        const seconds = ctx.flags.mobile ? DRIFT_SECONDS_MOBILE : DRIFT_SECONDS;
        const metres = ctx.flags.mobile ? DRIFT_METRES_MOBILE : DRIFT_METRES;
        // 立ち止まっていても歩いていても進む。速いほうを採る
        const k = easeInOutSine(clamp(Math.max(dwell / seconds, travelled / metres), 0, 1));
        // 下がる速さに上限を掛ける。ダッシュで一気に距離を稼いでも「沈んだ」と気づかせない
        height = Math.max(lerp(START_HEIGHT, END_HEIGHT, k), height - MAX_DRIFT_RATE * dt);
        ctx.playerOverride.setEyeHeight(height);
        // 歩幅も縮める。速度がそのままだと「縮んでいない」ことに気づかれる
        ctx.playerOverride.setMoveSpeedScale(CORRIDOR_SPEED * Math.sqrt(height / START_HEIGHT));
      }

      // 標識はカメラの実測値に追従させる。ヘッドボブが乗るので少し鈍らせる
      markerY = lerp(markerY, camera.y, damp(9, dt));
      marker.position.y = markerY;
      markerLabel.root.position.y = markerY - MARKER_LABEL_DROP;

      const distance = Math.abs(camera.z - GAUGE_WORLD_Z);
      const near = 1 - saturate((distance - MARKER_NEAR) / (MARKER_FAR - MARKER_NEAR));
      fade = lerp(fade, near, damp(5, dt));
      markerMaterial.opacity = fade;
      if (markerLabelMaterial) markerLabelMaterial.opacity = fade;
      marker.visible = fade > 0.01;
      markerLabel.root.visible = fade > 0.01;
    },
    setRevealed(isRevealed, progress) {
      // タネあかしの山場は「一気に元の高さへ戻す」瞬間。
      // 上書きを外すと PlayerController が 0.4 秒ほどで 1.60m へ戻す
      if (isRevealed && !revealed) {
        // 戻る前の高さを目盛の上に残す。戻ったあとも差が読める
        ghost.position.y = height;
        releaseOverride();
        restart();
      }
      revealed = isRevealed;
      ghost.visible = progress > 0.01;
      ghostMaterial.opacity = progress * 0.85;
    },
    dispose() {
      removeSpot();
      releaseOverride();
      for (const geometry of geometries) geometry.dispose();
      wallMaterial.dispose();
      trimMaterial.dispose();
      gauge.geometry.dispose();
      gaugeTexture?.dispose();
      gaugeMaterial.dispose();
      marker.geometry.dispose();
      markerMaterial.dispose();
      markerLabel.dispose();
      ghost.geometry.dispose();
      ghostMaterial.dispose();
    },
  };
}

export const shrinkingRoom: ExhibitDefinition = {
  id: 'shrinkingRoom',
  textKey: 'shrinkingRoom',
  room: 'opus',
  kind: 'zone',
  // 順路は D6 → D4 → D3 → D5 → D2 → D1（ROOM_D §4）
  order: 24,
  // 身長計そのものが実測ガイドなので、カメラは動かさない
  reveal: 'measure',
  position: POSITION,
  rotationY: 0,
  zone: {
    min: { x: POSITION.x - HALF_WIDTH, y: -1, z: Z_FAR },
    max: { x: POSITION.x + HALF_WIDTH, y: 3, z: Z_NEAR },
  },
  // 中を歩く展示なので、占有範囲＝ゾーンそのもの（§10b）
  footprint: {
    minX: POSITION.x - HALF_WIDTH,
    maxX: POSITION.x + HALF_WIDTH,
    minZ: Z_FAR,
    maxZ: Z_NEAR,
  },
  build,
};
