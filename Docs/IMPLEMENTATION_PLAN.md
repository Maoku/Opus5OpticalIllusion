# 実装計画 — Optical Illusion Museum

対象要件: [PLAN.md](PLAN.md)

- ブラウザ上で動作する 3D シーンのミュージアム
- Optical Illusion をテーマにした展示を鑑賞する
- 見え方のヒントは初期状態で非表示。ボタンを押すと解説が見られる

---

## 0. 前提と方針決定

### 0.1 技術選定（採用案）

| 項目 | 採用 | 理由 |
|---|---|---|
| ビルド | Vite | 設定ゼロに近く HMR が速い。静的出力で配信が容易 |
| 言語 | TypeScript (strict) | 展示メタデータの型安全性が効く |
| 3D | Three.js (バニラ / r16x 系最新) | React Three Fiber は不採用。本作は「1本の歩行体験」でありコンポーネント再利用の恩恵が薄く、後述の視点スナップやカスタムシェーダで生の three API を直接触りたいため |
| UI | 素の HTML/CSS オーバーレイ | ヒントパネル・HUD 程度。フレームワーク不要 |
| 状態管理 | 自前の軽量イベントバス | 規模的に十分 |
| テスト | Vitest（純ロジックのみ） | 幾何計算・当たり判定・視点解決を単体テスト |
| 配信 | 静的ホスティング（GitHub Pages / Netlify / Cloudflare Pages） | サーバ不要 |

> **代替案メモ**: チーム開発や UI 比率が大きくなるなら React + React Three Fiber + drei に切り替える価値がある。切り替えるならフェーズ0の時点で決めること（フェーズ4以降での変更はコストが跳ね上がる）。

### 0.2 動作ターゲット

- **第一対象**: デスクトップ Chrome / Edge / Safari / Firefox、WebGL2、60fps
- **第一対象**: **スマートフォン（iOS Safari / Android Chrome）** — バーチャルパッド操作、横向き、30fps 以上
- **対象**: iPad / Android タブレット
- WebXR は **スコープ外**（将来拡張として設計だけ阻害しないようにする）

スマホは「動けばよい副対象」ではなく **設計の第一対象**として扱う。詳細は [§4 モバイル対応](#4-モバイル対応バーチャルパッド)。

### 0.3 対応言語

- **日本語 / 英語の2言語を確定スコープとする。** 後付けではなく最初から辞書経由で実装する。
- 詳細は [§5 多言語対応](#5-多言語対応-jaen)。

### 0.4 設計上の最重要課題（先に潰す）

**錯視の多くは単一視点でしか成立しない。** 自由歩行カメラのままではペンローズの三角形もエイムズの部屋も「ただの歪んだ物体」にしか見えない。

→ **ViewSpot（視点マーカー）システム**を中核機能として第一級で実装する。

1. 展示の前の床に発光したマーカーを置く
2. プレイヤーが半径内に入ると HUD に「[F] ここから見る」を表示
3. 決定でカメラ位置・向き・FOV を正解値へ 0.6 秒で補間し、移動をロック
4. この状態で初めて錯視が完成する。ヒントボタンもこの状態で活性化
5. `Esc` / 移動入力で解除

**これは装飾ではなく体験の成立条件**であり、フェーズ7ではなくフェーズ4と並行で組む。

---

## 1. ディレクトリ構成

```
.
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ public/
│   ├─ models/            # glTF（ホロウマスク等）
│   ├─ textures/          # 生成できない画像のみ
│   └─ audio/
├─ src/
│   ├─ main.ts
│   ├─ core/
│   │   ├─ App.ts                 # 全体のライフサイクル
│   │   ├─ RendererFactory.ts     # WebGLRenderer 生成・画質プリセット
│   │   ├─ Loop.ts                # 固定 dt の update / render ループ
│   │   ├─ Assets.ts              # ローダ + 進捗
│   │   ├─ EventBus.ts
│   │   ├─ Quality.ts             # low / mid / high プリセット
│   │   ├─ Device.ts              # 端末判定・safe-area・全画面/向き制御
│   │   └─ input/
│   │       ├─ InputManager.ts    # ★入力抽象化。GameAction を発行
│   │       ├─ types.ts           # GameAction / InputState / InputSource
│   │       ├─ KeyboardMouseSource.ts
│   │       └─ TouchSource.ts     # バーチャルパッド → InputState
│   ├─ world/
│   │   ├─ Museum.ts              # ルーム合成・全体の組み立て
│   │   ├─ RoomBuilder.ts         # 壁・床・天井・幅木・ドア枠の生成
│   │   ├─ Lighting.ts            # 環境光 + 展示スポット
│   │   └─ Collision.ts           # XZ 平面の壁セグメント衝突
│   ├─ player/
│   │   ├─ PlayerController.ts    # 移動・衝突・視点高さ
│   │   └─ PointerLookControls.ts # ポインタロック（デスクトップのみ）
│   ├─ viewpoint/
│   │   ├─ ViewSpot.ts            # マーカーの見た目 + 判定
│   │   └─ ViewpointController.ts # スナップ補間・ロック管理
│   ├─ exhibits/
│   │   ├─ types.ts               # ExhibitDefinition / ExhibitInstance
│   │   ├─ ExhibitManager.ts      # 生成・更新・破棄・フォーカス管理
│   │   ├─ registry.ts            # 全展示の登録テーブル
│   │   ├─ common/
│   │   │   ├─ PanelExhibit.ts    # 額縁 + テクスチャの共通実装
│   │   │   ├─ CanvasTexture.ts   # 手続き的テクスチャ生成ヘルパ
│   │   │   └─ eyeProjection.ts   # 「視点から見て◯◯に見える」座標解決
│   │   ├─ cafeWall.ts
│   │   ├─ muellerLyer.ts
│   │   ├─ checkerShadow.ts
│   │   ├─ ebbinghaus.ts
│   │   ├─ heringIllusion.ts
│   │   ├─ peripheralDrift.ts
│   │   ├─ penroseTriangle.ts
│   │   ├─ penroseStairs.ts
│   │   ├─ neckerCube.ts
│   │   ├─ anamorphosis.ts
│   │   ├─ amesRoom.ts
│   │   ├─ beuchetChair.ts
│   │   ├─ hollowMask.ts
│   │   └─ ponzoCorridor.ts
│   ├─ ui/
│   │   ├─ Hud.ts                 # クロスヘア・操作プロンプト
│   │   ├─ HintPanel.ts           # ★ヒント非表示/表示の中核
│   │   ├─ ExhibitList.ts         # 展示一覧 + ワープ
│   │   ├─ VirtualPad.ts          # ★左スティック + 右視点ドラッグ（DOM）
│   │   ├─ TouchActionBar.ts      # ★文脈ボタン（見る/ヒント/戻る/一覧）
│   │   ├─ OrientationGate.ts     # 縦持ち時の「横にしてください」
│   │   ├─ LanguageSwitch.ts
│   │   ├─ LoadingScreen.ts
│   │   ├─ SettingsMenu.ts
│   │   └─ styles.css
│   ├─ i18n/
│   │   ├─ index.ts               # Locale 解決・切替・購読
│   │   ├─ ja.ts                  # ★唯一の正（Dictionary 型の源）
│   │   └─ en.ts                  # ja から型導出。キー欠落は型エラー
│   ├─ data/
│   │   └─ layout.ts              # 部屋の寸法・展示の配置座標
│   └─ utils/
│       ├─ math.ts
│       └─ dispose.ts             # ジオメトリ/マテリアルの解放
├─ tools/
│   ├─ buildShadowHull.ts         # Room D5 用 visual hull 生成
│   └─ subsetFont.ts              # ★日本語フォントのグリフサブセット化
├─ tests/
└─ Docs/
    ├─ PLAN.md
    └─ IMPLEMENTATION_PLAN.md
```

---

## 2. 中核となる型定義

```ts
// src/exhibits/types.ts
import type * as THREE from 'three';

export type ExhibitId = string;
export type RoomId = 'plane' | 'impossible' | 'space' | 'opus';

/** 台に置かれた物体か、部屋そのものが展示か（Room D の D2/D3 が後者） */
export type ExhibitKind = 'object' | 'zone';

/** ヒント公開時に走らせる「タネあかし」演出の種別 */
export type RevealKind =
  | 'none'
  | 'orbit'        // カメラを回して破綻を見せる（ペンローズ系）
  | 'strip'        // 同色を繋ぐ帯を出す（チェッカーシャドウ）
  | 'fadeContext'  // 周囲の文脈を消す（エビングハウス、ヘリング）
  | 'measure'      // 実測ガイド線を重ねる（ミュラー・リヤー、ポンゾ）
  | 'explode'      // パーツを分離する（ブーシェの椅子、ペンローズ）
  | 'topDown'      // 真上から本当の形を見せる（エイムズ、アナモルフォーシス）
  | 'grayscale';   // 彩度を落とすと動きが止まる（回転する蛇）

export interface ViewSpotDefinition {
  /** プレイヤーが立つ床の位置 */
  standAt: THREE.Vector3Like;
  /** 錯視が成立するカメラの目位置（standAt + 目線高さが基本） */
  eye: THREE.Vector3Like;
  lookAt: THREE.Vector3Like;
  fov: number;
  /** マーカー反応半径 (m) */
  radius: number;
}

/** 展示の文言は i18n 辞書に置き、定義側はキーだけを持つ。
 *  こうしないと展示コードに日本語が埋め込まれ、英語対応が後付け作業になる */
export type ExhibitTextKey = keyof Dictionary['exhibits'];

// i18n/ja.ts の各展示エントリが持つ形（= HintContent の実体）
//   title:       展示名
//   appearance:  第1段階「どう見えるか」
//   explanation: 第2段階「なぜそう見えるか」
//   reference:   錯視の正式名称・提唱者・先行例（任意）

export interface ExhibitDefinition {
  id: ExhibitId;
  /** 展示名・解説文はすべて i18n 辞書から引く（§5） */
  textKey: ExhibitTextKey;
  room: RoomId;
  kind: ExhibitKind;
  /** ワールド配置 */
  position: THREE.Vector3Like;
  rotationY: number;
  /** 単一視点でのみ成立する展示は必須。自由視点で良いものは省略可。
   *  複数の正解視点を持つ展示（Room D の「二つの真実」）のため配列とする */
  viewSpots?: ViewSpotDefinition[];
  /** kind === 'zone' のとき、進入判定に使う AABB */
  zone?: { min: THREE.Vector3Like; max: THREE.Vector3Like };
  hint: HintContent;
  reveal: RevealKind;
  build(ctx: BuildContext): Promise<ExhibitInstance> | ExhibitInstance;
}

export interface ExhibitInstance {
  root: THREE.Object3D;
  /** ヒントの第2段階で true。演出を切り替える */
  setRevealed(revealed: boolean, progress: number): void;
  update?(dt: number, elapsed: number): void;
  /** 言語切替時に呼ばれる。ワールド内の3Dテキスト（キャプションプレート等）や、
   *  文字そのものが展示内容である展示（Room D1）はここで作り直す。§5.4 */
  setLocale?(locale: Locale): void;
  dispose(): void;
}

export interface BuildContext {
  assets: Assets;
  quality: QualityLevel;
  /** viewSpots の eye 座標が渡る（形状の逆算に使う） */
  eyes: THREE.Vector3[];
  /** 展示がプレイヤー状態（目線高さ・移動速度）を一時的に上書きするためのハンドル。
   *  ExhibitManager がゾーン退出時・dispose 時に必ず巻き戻す責任を持つ */
  playerOverride: PlayerOverrideHandle;
}
```

**ポイント**: `reveal` を型に持たせることで、「ヒントは文章を出すだけ」ではなく**3Dシーン自体が種明かしをする**。これが本作の差別化点になる。

> **Room D 由来の拡張について**: `viewSpots`（複数視点）、`kind: 'zone'`（部屋そのものが展示）、`playerOverride`（展示がプレイヤーの身体を改変する）の3点は、Room D の展示が要求する拡張である。**Phase 4 の設計時点で最初から入れておくこと。** 後付けは高くつく。詳細は [ROOM_D_OPUS_WING.md §2](ROOM_D_OPUS_WING.md) を参照。

---

## 3. 展示物カタログ

3 部屋構成。★は MVP（フェーズ6a）で必ず実装する 6 点。

### Room A —「平面のだまし絵」（板状展示・自由視点可）

| # | 展示 | 実装方法 | reveal 演出 |
|---|---|---|---|
| 1 ★ | カフェウォール錯視 | Canvas2D で手続き生成 → CanvasTexture | モルタル線をフェードして水平線が平行だと示す |
| 2 ★ | ミュラー・リヤー錯視 | 板 + ライン（LineSegments or Canvas） | 矢羽根を消し、実測ガイドを重ねる |
| 3 ★ | チェッカーシャドウ（Adelson） | **実物3D**: 実際のチェック板+円柱+影を落とす | A/B を繋ぐ同輝度の帯を出す |
| 4 | エビングハウス錯視 | Canvas 生成 | 周囲円をフェードアウト |
| 5 | ヘリング錯視 | Canvas 生成 | 放射線を消す |
| 6 | 回転する蛇（周辺ドリフト） | 静止 PNG or Canvas 生成 | グレースケール化 → 動きが止まる |

### Room B —「あり得ない立体」（ViewSpot 必須）

| # | 展示 | 実装方法 | reveal 演出 |
|---|---|---|---|
| 7 ★ | ペンローズの三角形 | 3本の角柱。1本を切断し、断面2つを **視線上に整列** させる | カメラを 90° オービットし隙間を見せる |
| 8 | ペンローズの階段 | 同上の視線整列トリック | orbit + explode |
| 9 ★ | ネッカーキューブ | ワイヤーフレーム + **正投影カメラ**（透視だと成立しない） | 2通りの解釈を面塗り分けで交互提示 |
| 10 | アナモルフォーシス（床の歪んだ絵） | 床メッシュに **プロジェクタ行列によるUV投影シェーダ** | カメラを真上へ移動し歪んだ実体を見せる |

### Room C —「空間と身体」（ViewSpot 必須）

| # | 展示 | 実装方法 | reveal 演出 |
|---|---|---|---|
| 11 ★ | エイムズの部屋 | 台形の部屋を「覗き穴から矩形に見える」よう逆算構築。左右に同サイズの人形 | 天井/壁を透過し真上から本当の台形を見せる |
| 12 | ブーシェの椅子 | 背もたれ・脚を遠方に、座面を手前に分離配置 | パーツを実位置へ分離アニメ |
| 13 ★ | くぼんだ顔（ホロウマスク） | 凹面の顔モデル + マット材質 + 単一方向光 | ゆっくり回転して凹面であることを示す |
| 14 | ポンゾ錯視の廊下 | 実3D の収束する廊下 + 同寸の棒2本 | 2本を並べて同長を示す |

### Room D — 「Opus 棟：絵にできない錯視」（オリジナル展示）

Room A〜C の展示はすべて「写真1枚で成立する」既存の名作錯視である。Room D はその逆に、**スクリーンショットを撮った瞬間に消滅する錯視だけ**を集めたオリジナル展示室。観測者の移動・時間・音・身体改変・視線のいずれかを成立条件として要求する。

| # | 展示 | 成立条件 | Tier |
|---|---|---|---|
| D1 | 二つの真実 — 同じ断片群が視点Aで「真」、視点Bで「偽」を結ぶ | 観測者の移動 | 2 |
| D2 | 縮んでいく部屋 — 目線高さが 1.60m→1.15m へ気づかぬ速度でドリフト | 身体改変 | **1** |
| D3 | 後ろの正面 — 視界に入っていない彫像だけが変化する | 視線が入力 | 2 |
| D4 | 聞こえる衝突 — 音のON/OFFで「すれ違い」が「衝突」に反転 | 音と時間 | **1** |
| D5 | 嘘つきの影 — 1つの塊が同時に鳥と魚の影を落とす | 光源操作 | 2 |
| D6 | 縞の下の嘘 — 同一マテリアルの球6つが投影光で別色に見える | 実光源・自由視点 | **1** |
| D7 | 果てのない回廊 — 非ユークリッド空間（ポータルレンダリング） | — | 3 |

**Tier 1 の3点（合計 1.5日）だけで展示室として成立する。** 設計・実装詳細・工数・リスクは [ROOM_D_OPUS_WING.md](ROOM_D_OPUS_WING.md) を参照。

### 3.1 共通ヘルパ `eyeProjection.ts`

7・8・10・11・12 はすべて同じ数学に帰着する:

> 「視点 E から見て、見かけの点 P に重なるように、距離 d の位置へ実点を置きたい」

```ts
/** 視点 eye から apparent 方向へ距離 depth の実座標を返す */
export function placeOnEyeRay(
  eye: THREE.Vector3,
  apparent: THREE.Vector3,  // 「こう見えてほしい」理想形状上の点
  depth: number,
): THREE.Vector3 {
  return eye.clone().addScaledVector(
    apparent.clone().sub(eye).normalize(),
    depth,
  );
}
```

**これを最初に書いて単体テストを通す。** ここが崩れると Room B / C が全滅する。

---

## 4. モバイル対応（バーチャルパッド）

### 4.1 本質的な作業はスティックではなく「入力抽象化」

バーチャルパッド自体は半日で書ける。**本当のコストは、デスクトップ前提で設計された操作導線がスマホに存在しないこと**にある。

| 機能 | デスクトップ | スマホに何が必要か |
|---|---|---|
| 視点操作 | Pointer Lock + マウス | 右半分のドラッグ。**iOS Safari に Pointer Lock は無い** |
| 移動 | WASD | 左サムスティック |
| ViewSpot に立つ | `F` キー | 文脈ボタン |
| ヒント表示 | `H` キー / 画面下ボタン | ボタン（既に DOM なので流用可） |
| 展示の注視判定 | 画面中央のクロスヘア + レイキャスト | **タップ位置からのレイキャスト**（クロスヘアは指で隠れる） |
| 展示一覧 | `Tab` | ハンバーガーボタン |
| ロック解除 | `Esc` | 戻るボタン |
| ダッシュ | `Shift` | スティックを外周まで倒す |

つまり **UI と操作の並行系統をもう1つ作る**のに等しい。だからこそ入力を抽象化し、上位（`PlayerController` / `ViewpointController` / `HintPanel`）が入力デバイスを一切知らない構造にする。

```ts
// src/core/input/types.ts
export type GameAction =
  | 'interact'   // ViewSpot に立つ / ワールド内ボタンを押す
  | 'hint'       // ヒントを見る
  | 'reveal'     // タネあかし
  | 'cancel'     // ロック解除 / パネルを閉じる
  | 'list';      // 展示一覧

export interface InputState {
  /** 移動ベクトル。長さ 0..1。長さ > 0.9 でダッシュ扱い */
  move: { x: number; y: number };
  /** このフレームの視点回転量（rad） */
  look: { yaw: number; pitch: number };
  /** このフレームで発火したアクション */
  pressed: ReadonlySet<GameAction>;
  /** ワールドへのレイキャスト原点（NDC）。デスクトップは常に画面中央 (0,0) */
  pointerNdc: { x: number; y: number } | null;
}

export interface InputSource {
  readonly id: 'keyboardMouse' | 'touch';
  poll(dt: number): InputState;
  dispose(): void;
}
```

`InputManager` は両ソースを保持し、**最後に入力があったほうを active** にする（タブレット + Bluetooth キーボードのような混在環境で自然に切り替わる）。HUD の操作プロンプトは active source を見て `[F] ここから見る` / `ボタン表示` を出し分ける。

### 4.2 バーチャルパッドの実装方針

**Canvas ではなく DOM で実装する。** 理由: セーフエリア（ノッチ・ホームインジケータ）への追従が CSS `env(safe-area-inset-*)` で済み、`aria-label` も付けられ、3D の描画負荷と独立に動くため。

- **左スティック**: 固定位置ではなく **可変原点方式**（画面左下 40% 領域のどこに触れてもそこが原点になる）。固定だと親指を狙って画面を見てしまい、展示から目が離れる
- **右エリア**: ドラッグで視点回転。感度は `deg/px` で定義し、設定でスライダー調整可
- **同時タッチ**: `pointerdown/move/up` を `pointerId` で管理。左右同時操作は必須
- **文脈ボタン (`TouchActionBar`)**: 画面右下に縦積み。状況に応じて `見る` / `ヒント` / `タネあかし` / `戻る` が入れ替わる。**常時表示されるボタンは最小限**にし、展示を隠さない
- **タップ判定**: 移動距離 10px 未満 & 300ms 未満のみタップ扱い。ドラッグと誤爆させない
- **ハプティクス**: ViewSpot スナップ時に `navigator.vibrate(15)`（Android のみ。iOS は無視されるだけで害はない）

### 4.3 スマホ固有の落とし穴（先に潰す）

| 問題 | 対策 |
|---|---|
| ピンチズーム / ダブルタップズーム | `<meta name="viewport" content="... user-scalable=no, viewport-fit=cover">` + canvas に `touch-action: none` |
| 引っ張って更新（pull-to-refresh） | `body { overscroll-behavior: none; }` |
| iOS の `100vh` がアドレスバーで狂う | `100dvh` を使用。`resize` ではなく `visualViewport` を購読 |
| 長押しで選択メニュー・コールアウト | `-webkit-touch-callout: none; user-select: none;` |
| 縦持ちで極端に狭い | `OrientationGate` で「横向きにしてください」を全画面表示。**縦でも一応遊べる**ようにはしておく（強制はしない） |
| 全画面/向きロック | 初回タップ時に `requestFullscreen()` → `screen.orientation.lock('landscape')` を **try/catch で試すだけ**（iOS Safari は非対応。失敗しても続行） |
| 音声が鳴らない | 初回タッチで `AudioContext.resume()`（Room D4 の成立条件） |
| 発熱・サーマルスロットリング | 低fps を検知したら quality を自動降格。`Quality` に auto-degrade を実装 |

### 4.4 性能プリセット

| | low（スマホ既定） | mid | high（デスクトップ既定） |
|---|---|---|---|
| pixelRatio | 1.0 上限 | 1.5 上限 | 2.0 上限 |
| 影 | **OFF**（`emissive` と AO テクスチャで代替） | 1024 | 2048 |
| アンチエイリアス | OFF | ON | ON |
| 動的ライト | 環境光 + 方向光1 | +スポット4 | +スポット8 |
| 目標 | 30fps | 45fps | 60fps |

**注意**: 影を切ると **Room A のチェッカーシャドウ（Adelson）と Room C のホロウマスクが成立しなくなる。** この2展示だけは low でも影/専用ライトを維持する例外扱いとする。展示ごとに「削ってよい描画」と「錯視の成立条件である描画」を区別して `build()` 内に明示すること。

### 4.5 影響を受ける既存展示

| 展示 | スマホでの懸念 | 対応 |
|---|---|---|
| Room C ホロウマスク | 画面が小さいと凹凸の手がかりが減り、**むしろ錯視が強く効く** | 問題なし（むしろ好都合） |
| Room B ネッカーキューブ | 正投影のため画面サイズ非依存 | 問題なし |
| Room D2 縮んでいく部屋 | **スマホでの 3D 酔いリスクが最も高い** | スマホでは既定でドリフト時間を 60→90秒 に延長 |
| Room D6 縞の下の嘘 | 端末の色再現・自動輝度調整に左右される | 「画面の明るさ自動調整をお切りください」を展示キャプションに記載 |
| Room D4 聞こえる衝突 | サイレントスイッチ ON だと成立しない | 「音を有効にする」ボタンを展示内に常設 |

---

## 5. 多言語対応 (ja / en)

### 5.1 方針: 「後付けしない」

英語対応で最も高くつくのは、**コード中に日本語が直書きされた後で剥がす作業**。だから i18n 基盤は Phase 5（UI 実装）の時点で入れ、以降すべての文言は辞書経由にする。

一方で **翻訳作業そのものは全展示が固まってから**行う。原文が動いている段階で訳すと二度手間になるため。

> **基盤は最初、翻訳は最後。** これが i18n のコスト最適解。

### 5.2 辞書の型設計 — 訳し漏れをコンパイルエラーにする

```ts
// src/i18n/ja.ts —— 唯一の正（source of truth）
export const ja = {
  ui: {
    hintButton: 'ヒントを見る',
    revealButton: 'タネあかしを見る',
    closeButton: '元に戻す',
    standHere: 'ここから見る',
    ...
  },
  rooms: { plane: '平面のだまし絵', impossible: 'あり得ない立体', ... },
  exhibits: {
    cafeWall: {
      title: 'カフェウォール錯視',
      appearance: '…',
      explanation: '…',
      reference: '…',
    },
    // …全22展示
  },
} as const;

export type Dictionary = {
  -readonly [K in keyof typeof ja]: { /* 再帰的に string 化 */ };
};
```

```ts
// src/i18n/en.ts
import type { Dictionary } from './ja';

export const en: Dictionary = {  // ← キーが1つでも欠ければ型エラー
  ui: { hintButton: 'Show hint', ... },
  ...
};
```

**`ja` を型の源にすることで、英語の訳し漏れがビルド時に落ちる。** 実行時に `undefined` が画面に出ることがなくなる。

加えて Vitest でキー構造の一致とプレースホルダの整合を検証する（型では拾えない `{n}` の欠落などを拾う）。

### 5.3 フォント — ここが最大のコスト

日本語 Web フォントは素で 3〜5MB あり、**総アセット 5MB 以下という目標を単独で破壊する。**

| 用途 | 方針 | コスト |
|---|---|---|
| DOM の UI 文字 | **システムフォント**（`system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`）| **0 バイト** |
| ワールド内の 3D テキスト（キャプションプレート、案内板） | **ビルド時グリフサブセット化** | 数十 KB |

`tools/subsetFont.ts` で、`i18n/ja.ts` と `en.ts` に出現する全文字を抽出 → `subset-font` で woff2 を生成する。使用グリフは数百字程度なので **50KB 以下**に収まる。

> DOM UI にシステムフォントを使うと OS 間でデザインが揺れるが、**5MB のフォントを配信するコストのほうが遥かに大きい。**特にスマホ回線では致命的。デザイン統一が必要なら見出しだけサブセットフォントを当てる。

### 5.4 ワールド内テキストと「文字が展示内容である」展示

DOM の文言は再描画で済むが、**3D 空間内のテキストは切替時に作り直しが要る。**

- キャプションプレート・案内板・部屋名サイン → `ExhibitInstance.setLocale()` でテクスチャを再生成

**Room D1「二つの真実」— 文字は翻訳しない（確定方針）**

英語版でも **「真」「偽」の字形をそのまま使う。** TRUE / FALSE には置き換えない。理由は「作品の主題が言語ではなく形であること」「漢字のほうが点群として密度が高く美しいこと」「読めないことが再訪を生み、それが本作の主題と一致すること」の3点（[ROOM_D_OPUS_WING.md](ROOM_D_OPUS_WING.md) D1 参照）。

実装上の帰結:

- **断片配置は locale 非依存の単一解**になる。`build()` は言語を知らなくてよい。`setLocale()` も不要
- 代わりに **`glyphGloss` の仕組みが要る。** 字が結ばれた 0.4 秒後に字の脇へ小さなラベルをフェードイン表示する。`ja` は空文字で非表示、`en` は `真 — "true"` / `偽 — "false"`
  → **必ず字が結ばれた後に出すこと。** 事前表示は reveal を台無しにする
- 英語版のキャプションで「**意図的に日本語のままにしている**」ことを明示する。訳し忘れと誤解されてはならない

### 5.5 訳文の品質 — 直訳しない

錯視には **英語圏で確立した正式名称**がある。日本語からの直訳は誤りになる。

| 日本語 | ❌直訳 | ✅正式名称 |
|---|---|---|
| カフェウォール錯視 | Cafe Wall Illusion | **Café Wall illusion** |
| エイムズの部屋 | Ames's Room | **Ames room** |
| くぼんだ顔 | Dented Face | **Hollow-Face illusion** |
| 回転する蛇 | Rotating Snakes | **Rotating Snakes**（北岡明佳、正式名称として正しい）|
| ブーシェの椅子 | Bouchet Chair | **Beuchet chair** |
| ペンローズの階段 | Penrose Stairs | **Penrose stairs / Schroeder stairs** |

`reference` フィールドには **各言語で通用する正式名称と提唱者**を書く。Room D のオリジナル展示は逆に、英語名を先に決めてから日本語名を付けるほうが自然な結果になる（*Two Truths* / *The Shrinking Room* / *Behind You* / *Audible Collision* / *The Lying Shadow* / *Under the Stripes*）。

### 5.6 その他の実装項目

- **初期言語の決定**: `?lang=` クエリ > `localStorage` > `navigator.language`（`ja` で始まれば日本語）> 既定 `en`
- **切替 UI**: 設定メニュー + エントランスに常設。**リロード不要**で即時反映（購読モデル）
- **`<html lang>` の更新**、`<title>` / `meta description` / OGP の言語別出し分け
- **レイアウト崩れ**: 英語は日本語より **1.3〜1.6 倍長くなる**。`HintPanel` は固定高さにせず、スクロール可能にする。開発中は疑似ロケール（全文字を `xxx` に置換して最長化）で検証
- **改行**: 日本語は `word-break: auto-phrase` / `line-break: strict`、英語は `hyphens: auto` を言語別に適用

---

## 6. 実装フェーズ

各フェーズに **DoD（完了条件）** を定義する。DoD を満たすまで次に進まない。

---

### Phase 0 — プロジェクト初期化 〔0.5日〕

- `npm create vite@latest -- --template vanilla-ts`
- `three`, `@types/three` 導入
- ESLint + Prettier + tsconfig strict
- ディレクトリ雛形作成、Vitest 設定
- `vite.config.ts` に `base` を設定（GitHub Pages 用）

**DoD**: `npm run dev` で黒画面 + `npm run build` 成功 + `npm test` が空パスで通る。

---

### Phase 1 — 描画基盤 〔1日〕

- `RendererFactory`: WebGL2、`antialias`、`toneMapping = ACESFilmic`、`outputColorSpace = SRGB`、`setPixelRatio(min(dpr, 2))`
- `Loop`: 固定 dt（1/60）の update + 可変 render、`clock.getDelta()` の上限クランプ（タブ復帰対策）
- リサイズ対応、`stats.js`（dev のみ）
- `Assets`: GLTFLoader / TextureLoader をラップし LoadingManager で進捗を通知
- `Quality`: low / mid / high（影解像度、影のON/OFF、pixelRatio、アンチエイリアス）

**DoD**: 回転する立方体が 60fps で描画され、ウィンドウリサイズで歪まない。ローディング進捗が 0→100% で出る。

---

### Phase 2 — ミュージアム建築 〔2日〕

- `RoomBuilder`: 壁セグメント定義（始点・終点・高さ・厚み）から `BoxGeometry` を生成。ドア開口はセグメント分割で表現
- 3部屋 + 接続通路 + エントランスホールを `data/layout.ts` に座標データとして記述
- 床・壁・天井のマテリアル（`MeshStandardMaterial`、`roughness` 高め、リピートテクスチャ or 単色）
- `Lighting`:
  - `HemisphereLight`（弱）+ `AmbientLight`（弱）
  - 部屋ごとに `DirectionalLight` 1灯（影あり、`shadow.camera` を部屋に密着させる）
  - 展示ごとの `SpotLight` は **合計8灯以内**に制限（それ以上はマテリアルのemissiveで代替）
- **ホロウマスクとチェッカーシャドウは照明が成立条件**なので、その2展示の照明は個別チューニング枠を確保

**DoD**: 3部屋を無衝突カメラで飛び回れる。影が落ちている。high プリセットで 60fps 維持。

---

### Phase 3 — 入力抽象化とプレイヤー操作 〔2.5日〕

**§4.1 の入力抽象化を最初に置く。** これを飛ばして `PlayerController` が直接キーを読むと、バーチャルパッド対応が全面改修になる。

- `InputManager` + `InputSource` インターフェース、`GameAction` 定義〔0.5日〕
- `KeyboardMouseSource`: `requestPointerLock`、pitch ±85° クランプ、感度設定
- `TouchSource` + `VirtualPad`（DOM）: 可変原点の左スティック / 右ドラッグ視点 / `pointerId` 管理による同時タッチ / タップとドラッグの弁別〔1.0日〕
- `PlayerController`: `InputState` のみを入力とする。目線高さ 1.6m、加減速あり、**ヘッドボブ既定 OFF**
- `Collision`: XZ 平面。プレイヤー半径 0.35 の円 vs 壁線分でスライド解決
- `Device.ts` + §4.3 の落とし穴対策（viewport meta、`touch-action`、`overscroll-behavior`、`100dvh`、コールアウト抑止）〔0.5日〕
- 設定メニュー: FOV、感度、Y軸反転、ヘッドボブ、画質

**DoD**: 壁をすり抜けない。角で引っかからずスライドする。**実機のスマホとデスクトップの両方で歩ける。**両者を切り替えても `PlayerController` に一切の分岐がない。5分歩いて酔わない。

---

### Phase 4 — 展示フレームワーク + ViewSpot 〔2日〕

*※ Phase 4 と ViewSpot は不可分。同時に作る。*

- `ExhibitManager`:
  - `registry` から `ExhibitDefinition[]` を読み、`build()` して `Museum` に追加
  - プレイヤー距離による **LOD/カリング**（20m 超は `visible = false`、`update` も停止）
  - フォーカス判定: 最寄り ViewSpot + 画面中央レイキャストの併用
- `ViewSpot`: 床の発光リング（`ShaderMaterial` でパルス）+ 足跡アイコン
- `ViewpointController`:
  - 進入検知 → HUD プロンプト → 決定でスナップ
  - `easeInOutCubic` で 0.6秒、position / quaternion / fov を同時補間
  - ロック中は `PlayerController` を停止。解除で元の位置・向きへ復帰
  - **ロック中の微小な首振り（±3°）は許可**（完全固定は不気味なので）
  - 進入は `GameAction.interact` で発火（キーかタッチかを知らない）
- ダミー展示（ただの箱）2つで通しの動作確認

**DoD**: マーカーに立つ→スナップ→固定→解除、が破綻なく往復できる。スナップ中に壁抜けしない。**スマホでも同じ導線が成立する。**

---

### Phase 5 — ヒント UI + i18n 基盤 + タッチ UI 〔2日〕（★要件の中核）

**i18n 基盤をここで入れる（§5.1）。** UI を作る時点で辞書経由にしておけば追加コストはほぼゼロ。後から剥がすと数日かかる。

- `i18n/index.ts` + `ja.ts` の骨格 + `Dictionary` 型導出 + 購読モデル〔0.5日〕
- `LanguageSwitch`、`<html lang>` 更新、初期言語解決（`?lang=` > localStorage > `navigator.language`）
- `HintPanel`（HTML オーバーレイ）
  - **初期状態: 完全非表示**（DOM は存在するが `aria-hidden` + 非表示）
  - ViewSpot ロック中、または展示を注視中にボタン「💡 ヒントを見る」が右下に出現
  - **段階式開示**:
    1. 押下 → 「どう見えるか」(`hint.appearance`) をパネル表示
    2. 「タネあかしを見る」ボタン出現 → 押下で `hint.explanation` 表示 **＋ `reveal` 演出を 3D シーンで再生**
    3. 「元に戻す」で reveal を巻き戻し、パネルを閉じる
  - 操作: `H` で開閉 / `Esc` で閉じる、スマホは `TouchActionBar` のボタン
  - `pointer-events: none` を基本にし、ボタン/パネルのみ `auto`
  - **英語で 1.6 倍に伸びても崩れない**こと。固定高さにせずスクロール可能に（§5.6）
- `Hud`: 操作プロンプト（active input source で表記を出し分け）、現在の部屋名。クロスヘアはデスクトップのみ
- `TouchActionBar`: 文脈ボタン（見る / ヒント / タネあかし / 戻る / 一覧）〔0.5日〕
- `ExhibitList`: `Tab` またはボタンで展示一覧。選択でその ViewSpot へワープ（**酔い対策 & アクセシビリティの主要導線**）
- `OrientationGate`: 縦持ち時の案内

**DoD**: 6展示ぶんのダミーテキストで、非表示→appearance→explanation+reveal→巻き戻しが全展示で通る。ヒントを一度も押さなければ解説が一切目に入らない。**日本語↔英語をリロードなしで切り替えられる**（英語は仮訳でよい）。**スマホで全機能に到達できる。**

---

### Phase 6a — MVP 展示実装（★6点）〔3日〕

実装順（依存関係が浅い順）:

1. **カフェウォール**（`CanvasTexture` ヘルパの確立を兼ねる）
2. **ミュラー・リヤー**（`measure` reveal の確立）
3. **チェッカーシャドウ**（実3D + 影。Phase 2 の照明が正しいかの検証を兼ねる）
4. **ネッカーキューブ**（正投影カメラを ViewSpot に持たせる = `fov` の代わりに `orthographic` フラグが必要と判明するはず → 型を拡張）
5. **ペンローズの三角形**（`placeOnEyeRay` の初実戦。`orbit` reveal）
6. **エイムズの部屋**（最難関。部屋そのものを `placeOnEyeRay` で構築。`topDown` reveal）

**DoD**: 6展示すべてで、ViewSpot に立つと錯視が「効く」ことを目視確認。reveal で確かに種が割れる。

---

### Phase 6b — 残り展示 〔3日〕

7. エビングハウス / 8. ヘリング / 9. 回転する蛇（Canvas 生成の量産、1日）
10. アナモルフォーシス（投影シェーダ、0.5日）
11. ペンローズの階段（0.5日）
12. ポンゾの廊下（0.5日）
13. ブーシェの椅子（0.5日）
14. **ホロウマスク**（モデル調達が必要 — 下記リスク参照）

**DoD**: 14展示すべてが配置・解説・reveal 込みで動く。

---

### Phase 6c — Room D「Opus 棟」Tier 1 〔2日〕

オリジナル展示室。詳細設計は [ROOM_D_OPUS_WING.md](ROOM_D_OPUS_WING.md)。

- 部屋の建築 + 順路〔0.5日〕
  - **注記 2026.07.26（改良計画 §12b / 決定事項 B）**: 「Room A〜C を一定数見ると開錠」は廃止。
    施錠扉は概念ごと削除し、Opus 棟は初回から素通しで入れる。
    詳細は [ROOM_D_OPUS_WING.md](ROOM_D_OPUS_WING.md) §4。
- D6 縞の下の嘘（`SpotLight.map` のゴボ投影）〔0.5日〕
- D4 聞こえる衝突（`AudioBus` + ワールド内3Dボタン）〔0.5日〕
- D2 縮んでいく部屋（`playerOverride` + ゾーン型展示）〔0.5日〕

**DoD**: 3展示が動作し、**D2 の巻き戻しが退出時・dispose時・ワープ時の3経路すべてで保証されている**（縮んだまま他室に行けると全展示の錯視が壊れる — Vitest で担保）。`prefers-reduced-motion` で D2 が無効化される。

---

### Phase 7 — 演出とポリッシュ 〔2日〕

- エントランスの案内板、展示キャプションプレート（`troika-three-text` or Canvas テクスチャ）
- 環境音（残響のあるホール音）+ UI 効果音 + 足音。**初回はミュート、ユーザー操作で解除**（autoplay ポリシー対応）
- ローディング画面（進捗バー + 「クリックして入場」）
- 軽い後処理: `Vignette` 程度。**Bloom は錯視の明度知覚を壊すので不採用**
- チェッカーシャドウ／ホロウマスクは **トーンマッピングの影響を受けるため、後処理追加後に必ず再検証**

**DoD**: 初回訪問者が説明なしでエントランス→展示→ヒント表示まで到達できる。

---

### Phase 8a — モバイル仕上げ 〔1.5日〕

Phase 3 で操作は成立しているので、ここは**体験の質と実機での現実**に対処する。

- 親指の可動域に合わせたボタン配置調整、セーフエリア（`env(safe-area-inset-*)`）追従
- 初回タップでの全画面化 + 向きロック試行（失敗しても続行）、`AudioContext.resume()`
- `Quality` の **自動降格**: 直近60フレームの平均 fps が閾値を割ったらプリセットを1段下げる
- 発熱・バッテリー確認（10分連続プレイ）
- **実機確認**: iPhone Safari / Android Chrome / iPad Safari の最低3機種
- §4.5 の展示別対応（D2 のドリフト時間延長、D4 の音声ボタン、D6 の輝度注意書き）

**DoD**: スマホ実機で 30fps 以上を維持し、全22展示にバーチャルパッドだけで到達・鑑賞・ヒント表示ができる。10分プレイで操作不能になる発熱が起きない。

---

### Phase 8b — 英語版の作成と検証 〔1.0日〕

全展示の日本語原文が確定した後に着手する（§5.1）。

- `i18n/en.ts` の全訳。**錯視の正式名称は §5.5 の表に従い直訳しない**
- `tools/subsetFont.ts` で日英の使用グリフを抽出しサブセット woff2 を生成（§5.3）
- ワールド内 3D テキストの `setLocale()` 実装・検証
- **Room D1 の `glyphGloss` 実装**（§5.4）。字が結ばれた 0.4 秒後にラベルをフェードイン、`ja` は非表示
- **D1 英語キャプションで「意図的に日本語のままである」ことを明示**
- 疑似ロケールでのレイアウト崩れ検証、言語別の改行規則適用
- Vitest による ja/en キー構造の一致検証

**DoD**: 英語のみで全展示を鑑賞して意味が通る。日本語フォント込みで総アセット 5MB 以下を維持。**日本語を読めない人が D1 を見て「訳し忘れ」と受け取らない。**

---

### Phase 8c — 最適化・アクセシビリティ・対応検証 〔2日〕

- **パフォーマンス**
  - ドローコール監視。板展示のマテリアル/ジオメトリ共有
  - 影の解像度を quality に連動、影を落とす対象を絞る
  - `renderer.info` を dev HUD に出す
  - 目標: high で 60fps / low で 30fps（統合GPUノート）
- **アクセシビリティ / 酔い対策**
  - 展示リストからのワープ（歩行不要でも全展示到達可能）
  - `prefers-reduced-motion` でスナップ補間を短縮、回転 reveal を段階送りに
  - ヒントパネルは実 DOM テキスト（スクリーンリーダ可読）、フォーカストラップ、キーボードのみで全操作可能
  - バーチャルパッドの各ボタンに `aria-label`（**言語別**に出し分け）
  - **色覚多様性**: 色相のみに依存する展示（チェッカーシャドウ等）で輝度差を確保
- **メモリ**: `dispose.ts` でジオメトリ/マテリアル/テクスチャを確実に解放。**言語切替を50回繰り返してもリークしない**ことを確認（`setLocale()` がテクスチャを作り直すため）
- ブラウザ実機確認（Chrome / Safari / Firefox）

**DoD**: Lighthouse で致命的指摘なし。10分プレイでメモリ増加が頭打ち。言語切替を反復してもメモリが増え続けない。

---

### Phase 9 — ビルドとデプロイ 〔0.5日〕

- `vite build` の chunk 分割（three を別チャンク）、gzip/brotli 確認
- テクスチャは可能な限り手続き生成 → **総アセット 5MB 以下**を目標（サブセットフォント込み）
- GitHub Actions で push → Pages デプロイ
- OGP / favicon / `<title>` / meta description を **言語別に出し分け**、`hreflang` 設定
- `?lang=ja` / `?lang=en` で直接入場できることを確認

**DoD**: 公開 URL で初回ロード 5秒以内（一般的な回線）。**モバイル回線（4G スロットリング）でも 10秒以内。**

---

## 7. スケジュール概観

| フェーズ | 内容 | 目安 | 累計 |
|---|---|---|---|
| 0 | 初期化 | 0.5日 | 0.5 |
| 1 | 描画基盤 | 1.0日 | 1.5 |
| 2 | 建築・照明 | 2.0日 | 3.5 |
| 3 | **入力抽象化 + プレイヤー操作 + バーチャルパッド** | 2.5日 | 6.0 |
| 4 | 展示FW + ViewSpot | 2.0日 | 8.0 |
| 5 | **ヒントUI + i18n基盤 + タッチUI** | 2.0日 | 10.0 |
| 6a | MVP展示 6点 | 3.0日 | 13.0 |
| 6b | 残り展示 8点 | 3.0日 | 16.0 |
| 6c | **Room D Tier 1（オリジナル3点＋部屋）** | 2.0日 | 18.0 |
| 7 | 演出 | 2.0日 | 20.0 |
| 8a | **モバイル仕上げ** | 1.5日 | 21.5 |
| 8b | **英語版の作成と検証** | 1.0日 | 22.5 |
| 8c | 最適化・a11y | 2.0日 | 24.5 |
| 9 | デプロイ | 0.5日 | **25.0** |
| 10 | **Room D Tier 2（本命3点）** | 6.0日 | 31.0 |

**Phase 6a 完了時点（約13日）で「遊べる状態」に到達する**ため、ここを最初のマイルストーンに置く。以降は差分リリース可能。

**Phase 9 までの 25.0日で公開可能な完成品**（既存錯視14点 + オリジナル3点、日英2言語、PC/スマホ対応）。Room D Tier 2 は公開後の独立マイルストーンとして、落ち着いて着手する。特に D1「二つの真実」はミュージアムの看板作品になりうるため、時間を取って作る価値がある。

### モバイル対応・英語対応の追加コスト内訳（計 +4.5日）

| 内訳 | 工数 | 備考 |
|---|---|---|
| 入力抽象化 + バーチャルパッド + 端末対策（Phase 3） | +1.0日 | 前倒しで入れるため安い |
| タッチ UI（Phase 5） | +0.5日 | |
| モバイル仕上げ・実機検証（Phase 8a） | +1.5日 | **実機確認が主。省略不可** |
| i18n 基盤（Phase 5） | +0.5日 | 前倒しで入れるため安い |
| 英語版作成・フォント・`glyphGloss`（Phase 8b） | +1.0日 | D1 の断片再解決が不要になり 0.5日減 |

> **前倒しにした2項目（入力抽象化・i18n基盤）が計 1.5日で済んでいるのが肝。** これらを Phase 8 で後付けすると、それぞれ 3日以上の改修になる。

---

## 8. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| **単一視点の錯視が自由歩行と両立しない** | 体験の根幹が成立しない | ViewSpot を Phase 4 で最優先実装。ダミー展示で先に検証 |
| **エイムズの部屋の逆算構築が難航** | 目玉展示が落ちる | `placeOnEyeRay` を Phase 4 開始前に単体テスト付きで完成させる。最悪、部屋形状を手動座標で調整して逃げる |
| **ホロウマスクの顔モデル調達**（ライセンス） | 実装ブロック | CC0 のスキャンモデル（Poly Haven / Sketchfab CC0）を早期に確保。無ければ **簡易なレリーフ状の顔を自前生成**に代替。ライセンス表記を `Docs/CREDITS.md` に必ず記載 |
| **明度系錯視がトーンマッピング/後処理で壊れる** | 錯視が効かない | Phase 7 で後処理を入れた直後に該当展示を再検証。壊れるなら該当マテリアルのみ `MeshBasicMaterial` + 素通しで描画 |
| **3D酔い** | 離脱 | 加減速の調整、ヘッドボブ既定OFF、FOV設定、ワープ導線、`prefers-reduced-motion` 対応 |
| **モバイル性能不足** | 対象ユーザー減 | quality プリセットで影OFF・pixelRatio 1.0 + fps 低下時の自動降格。展示のポリゴン数は元々小さいので主に影と解像度で調整 |
| **画質を落とすと錯視が壊れる** | 展示が成立しない | 影OFF はチェッカーシャドウとホロウマスクを破壊する。**「削ってよい描画」と「錯視の成立条件である描画」を `build()` 内で区別**し、後者は low でも維持（§4.4） |
| **入力抽象化を飛ばして実装が進む** | バーチャルパッド対応が全面改修に | Phase 3 の DoD に「`PlayerController` に入力デバイス分岐が存在しないこと」を明記済み。レビュー時に必ず確認 |
| **i18n を後付けする誘惑** | 剥がし作業に数日 | Phase 5 で辞書を通す。以降、**コードへの日本語直書きを ESLint ルールで禁止**（`no-irregular-whitespace` ではなく独自の正規表現ルールで CJK リテラルを検出）|
| **日本語フォントで転送量が破綻** | モバイル回線で離脱 | DOM UI はシステムフォント（0バイト）、3Dテキストのみビルド時サブセット化（§5.3）|
| **英語訳が直訳になり錯視名が誤る** | 教育コンテンツとして問題 | §5.5 の正式名称対応表に従う。`reference` に提唱者と原名を併記 |
| **D1 の日本語が「訳し忘れ」に見える** | 看板作品が手抜きと受け取られる | 英語キャプションで意図的な選択であることを明示。加えて `glyphGloss` で字が結ばれた直後に意味を提示し、**reveal の山場と意味の到達を同期させる**（§5.4）|
| **iOS Safari の非対応 API** | 起動不能 | Pointer Lock / 向きロック / `vibrate` はすべて **try/catch で試すだけ**にし、失敗しても機能継続する設計を徹底 |
| **解説文の正確さ** | 教育コンテンツとして問題 | 各展示に `reference` フィールドを持たせ、錯視の正式名称と提唱者を明記。文章は独自に執筆（既存解説の転載をしない） |
| **Room D の「オリジナル」の誇張** | 誠実さを欠く | オリジナルなのは**体験の設計**であって知覚現象の発見ではない。各展示の `reference` に下敷きにした既知の現象・先行例を明記する（[ROOM_D_OPUS_WING.md §0.1](ROOM_D_OPUS_WING.md)） |
| **D2 の身体改変が巻き戻らない** | 他の全展示の錯視が壊れる | `playerOverride` の巻き戻しを3経路すべて Vitest で担保。Phase 6c の DoD に含める |

---

## 9. テスト方針

- **単体（Vitest）**
  - `placeOnEyeRay` / `closestPointsBetweenRays` / 衝突解決 / イージング / ViewSpot 進入判定
  - `playerOverride` の巻き戻し（退出時・dispose時・ワープ時の3経路）
  - **ja / en の辞書キー構造の一致**（型で拾えないプレースホルダ欠落を検出）
  - `TouchSource` のタップ/ドラッグ弁別（`pointerId` 管理のロジックを純関数化して検証）
- **目視チェックリスト**: 展示ごとに「ViewSpot に立つと錯視が効くか」「reveal で種が割れるか」を `Docs/QA_CHECKLIST.md` に列挙。**各項目を「PC日本語 / PC英語 / スマホ日本語 / スマホ英語」の4条件で確認**
- **スモーク（任意）**: Playwright で起動 → WebGL コンテキスト生成 → コンソールエラーなし。**モバイルエミュレーション（iPhone プリセット）でも実行**
- **性能回帰**: dev HUD の `renderer.info`（ドローコール / 三角形数）を各フェーズ末に記録

---

## 10. 未確定事項（進行中に判断すればよいもの）

1. **BGM の有無** — Phase 7 で判断。環境音のみでも十分成立する
2. **展示数** — Room A〜C の14点が上限。Phase 6b で時間が厳しければ 8・12・14 番を削る（削っても体験は成立する構成にしてある）
3. **Room D Tier 2 の着手可否** — Phase 9 の公開後に判断
4. **英語版の訳出体制** — 自前で書くか、訳文レビューを別途入れるか。錯視の正式名称は §5.5 で確定済みなので、残るは解説文の自然さのみ

---

## 11. 直近の着手手順

```bash
npm create vite@latest . -- --template vanilla-ts
npm install three
npm install -D @types/three vitest eslint prettier subset-font
```

1. Phase 0 のディレクトリ雛形を切る
2. `src/exhibits/common/eyeProjection.ts` と `tests/eyeProjection.test.ts` を **最初に**書く（Room B/C の生命線）
3. Phase 1 の `App` / `Loop` / `RendererFactory` を通す

### 後戻りが高くつく3つの設計判断（着手前に必ず確定させる）

| 判断 | 入れるべきタイミング | 後付けした場合のコスト |
|---|---|---|
| **入力抽象化**（`InputManager` / `GameAction`） | Phase 3 の冒頭 | 3日以上（全操作系の改修） |
| **i18n 辞書経由の文言管理** | Phase 5 の冒頭 | 3日以上（全 UI と展示から日本語を剥がす） |
| **展示型の拡張**（`viewSpots` 複数化 / `kind: 'zone'` / `playerOverride`） | Phase 4 の設計時 | 2日以上（Room D が作れなくなる） |

この3つ以外は、走りながら判断してよい。
