import type * as THREE from 'three';
import type { Assets } from '../core/Assets';
import type { QualityLevel } from '../core/Quality';
import type { RoomId } from '../data/layout';
import type { PlayerOverrideHandle } from '../player/PlayerController';
import type { Lighting } from '../world/Lighting';
import type { Collision } from '../world/Collision';
import type { AudioBus } from '../core/AudioBus';
import type { Dictionary, ExhibitTextKey } from '../i18n';

export type ExhibitId = string;
export type { RoomId };

/** 台に置かれた物体か、部屋そのものが展示か（Room D の D2/D3 が後者） */
export type ExhibitKind = 'object' | 'zone';

/** ヒント公開時に走らせる「タネあかし」演出の種別 */
export type RevealKind =
  | 'none'
  | 'orbit' // カメラを回して破綻を見せる（ペンローズ系）
  | 'strip' // 同色を繋ぐ帯を出す（チェッカーシャドウ）
  | 'fadeContext' // 周囲の文脈を消す（エビングハウス、ヘリング）
  | 'measure' // 実測ガイド線を重ねる（ミュラー・リヤー、ポンゾ）
  | 'explode' // パーツを分離する（ブーシェの椅子、ペンローズ）
  | 'topDown' // 真上から本当の形を見せる（エイムズ、アナモルフォーシス）
  | 'grayscale'; // 彩度を落とすと動きが止まる（回転する蛇）

/**
 * カメラ演出（§11a）。見た目の演出（RevealKind）とは軸を分ける。
 *
 * 「帯を出す」と「見下ろす」は本来独立で、まとめてしまうと
 * チェッカーシャドウのように「帯は出るがカメラは水平のまま」になる。
 *
 *   orbit    … 回り込んで破綻を見せる
 *   topDown  … 真上から本当の形を見せる
 *   tilt     … 方位はそのままに見下ろす。俯瞰しつつ立体の関係も残したいとき
 *   traverse … 2 つの ViewSpot のあいだを弧を描いて渡る（ROOM_D §2.1 / D1）。
 *              **途中の無意味な状態こそが種明かし**なので、中間で一度止める
 */
export type RevealCameraKind = 'orbit' | 'topDown' | 'tilt' | 'traverse';

/** revealCamera === 'tilt' の詰め方 */
export interface RevealTilt {
  /** 見下ろし角（度）。90 で真上 */
  elevation: number;
  /** 注視点までの距離 */
  distance: number;
  fov: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * 展示が床の上で占める矩形（世界座標・XZ、§10b）。
 *
 * 「ペンローズの三角形の立ち位置が、階段の台座の内部だった」のような事故は、
 * 配置を人手で決めているかぎり必ず再発する。全展示ぶんを走査するテストが
 * 参照できるよう、占有範囲を定義側に持たせる。
 */
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ViewSpotDefinition {
  /** プレイヤーが立つ床の位置 */
  standAt: Vec3Like;
  /** 錯視が成立するカメラの目位置（standAt + 目線高さが基本） */
  eye: Vec3Like;
  lookAt: Vec3Like;
  fov: number;
  /** マーカー反応半径 (m) */
  radius: number;
  /**
   * ネッカーキューブは透視投影だと成立しない（Phase 6a-4）。
   * 正投影を要求する ViewSpot はここで宣言する。
   */
  projection?: 'perspective' | 'orthographic';
  /** projection === 'orthographic' のときの表示高さ（m） */
  orthoHeight?: number;
  /** 複数視点を持つ展示（D1）でマーカーを見分けるための添字ラベル */
  tag?: string;
}

/**
 * 展示の文言。実体は i18n 辞書 (§5.2) にあり、定義側はキーだけを持つ。
 * こうしないと展示コードに日本語が埋め込まれ、英語対応が後付け作業になる。
 */
export interface HintContent {
  /** 展示名 */
  title: string;
  /** 第1段階「どう見えるか」 */
  appearance: string;
  /** 第2段階「なぜそう見えるか」 */
  explanation: string;
  /** 錯視の正式名称・提唱者・先行例（§5.5） */
  reference?: string;
  /** ワールド内のキャプションプレートに刻む文 */
  caption?: string;
  /** キャプションに添える注意書き（D6 の画面輝度など、§4.5） */
  notice?: string;
  /**
   * D1 専用: 字が結ばれた後に出すグロスラベル。ja では空文字（§5.4）。
   * 視点 A・B の 2 行を改行で区切る（`真 — “true”` / `偽 — “false”`）。
   */
  glyphGloss?: string;
  /**
   * D3 専用: 回廊を一周し終えた来館者に見せる集計。
   * `{total}` と `{count}` を実数で置き換える。
   */
  counter?: string;
  /**
   * D2 専用: 突き当たりの身長計に刻む 2 行。改行で区切る。
   * 1 行目が 1.60m の帯（入室時の目線）、2 行目が追従する標識（いまの目線）。
   */
  scale?: string;
}

/** 辞書に存在しないキーはコンパイルエラーになる（§5.2） */
export type { ExhibitTextKey };

export interface ExhibitDefinition {
  id: ExhibitId;
  /** 展示名・解説文はすべて i18n 辞書から引く（§5） */
  textKey: ExhibitTextKey;
  room: RoomId;
  kind: ExhibitKind;
  /** ワールド配置 */
  position: Vec3Like;
  rotationY: number;
  /**
   * 単一視点でのみ成立する展示は必須。自由視点で良いものは省略可。
   * 複数の正解視点を持つ展示（Room D の「二つの真実」）のため配列とする。
   */
  viewSpots?: ViewSpotDefinition[];
  /** kind === 'zone' のとき、進入判定に使う AABB */
  zone?: { min: Vec3Like; max: Vec3Like };
  /**
   * 床の占有範囲（§10b）。他展示の ViewSpot がここに入っていないことを
   * tests/placement.test.ts が全展示ぶん検査する。
   */
  footprint?: Footprint;
  reveal: RevealKind;
  /**
   * カメラ演出（§11a）。省略すると reveal から推測する
   * （'orbit' / 'topDown' はそのまま、それ以外はカメラを動かさない）。
   */
  revealCamera?: RevealCameraKind;
  /** revealCamera === 'tilt' のときの見下ろし角・距離・画角 */
  revealTilt?: RevealTilt;
  /**
   * カメラ演出（orbit / topDown）が見るべき中心。展示のローカル座標。
   * 省略すると position が使われる。エイムズの部屋のように「原点が覗き穴で、
   * 見せたい実体は奥」という展示ではこれが必要になる。
   */
  revealFocus?: Vec3Like;
  /**
   * ワールド内のボタンなど、その場で押せる仕掛けを持つ展示。
   * HUD とタッチ UI に出す文言のキーを指定する（D4 の「音を有効にする」など）。
   */
  interactTextKey?: keyof Dictionary['ui'];
  /** キャプションプレートに添える注意書きのキー（§4.5 の展示別対応） */
  noticeTextKey?: keyof Dictionary['ui'];
  /**
   * 明度・色そのものが錯視の成立条件である展示。
   * ヴィネットなどの後処理を、この展示を見ている間は無効化する（§8 リスク表）。
   */
  brightnessCritical?: boolean;
  /** 一覧・順路での並び順 */
  order?: number;
  build(ctx: BuildContext): Promise<ExhibitInstance> | ExhibitInstance;
}

export interface ExhibitInstance {
  root: THREE.Object3D;
  /** ヒントの第2段階で true。progress は 0..1 の演出進行度 */
  setRevealed(revealed: boolean, progress: number): void;
  update?(dt: number, elapsed: number): void;
  /**
   * 言語切替時に呼ばれる。ワールド内の3Dテキスト（キャプションプレート等）や、
   * 文字そのものが展示内容である展示はここで作り直す（§5.4）。
   */
  setLocale?(content: HintContent): void;
  /** interactTextKey を持つ展示で、決定が押されたときに呼ばれる */
  onInteract?(): void;
  /** kind === 'zone' の展示のみ。ExhibitManager が進入・退出を通知する */
  onZoneEnter?(): void;
  /** 退出は必ず呼ばれる。playerOverride の巻き戻しはここで行う */
  onZoneExit?(): void;
  dispose(): void;
}

/**
 * 実行中に変わりうる設定。展示は参照を持ち続け、毎フレーム最新値を読む。
 * build 時の値をコピーすると、設定変更が展示に届かなくなる。
 */
export interface ExhibitFlags {
  /** prefers-reduced-motion または設定でモーション低減が有効か */
  reducedMotion: boolean;
  /** ROOM_D §5: D2「縮んでいく部屋」の独立トグル */
  shrinkingRoom: boolean;
  /** タッチ主体の端末か。§4.5 の展示別対応（D2 のドリフト時間延長）に使う */
  mobile: boolean;
}

export interface BuildContext {
  assets: Assets;
  quality: QualityLevel;
  /** viewSpots の eye 座標が渡る（形状の逆算に使う） */
  eyes: THREE.Vector3[];
  /**
   * 描画に使っているカメラ。
   * 「見られているか」が入力になる展示（D3）と、視点に応じて表示を変える展示
   * （D1 のグロスラベル）が参照する。書き換えてはならない。
   */
  camera: THREE.PerspectiveCamera;
  definition: ExhibitDefinition;
  /**
   * 展示がプレイヤー状態（目線高さ・移動速度）を一時的に上書きするためのハンドル。
   * ExhibitManager がゾーン退出時・dispose 時に必ず巻き戻す責任を持つ。
   */
  playerOverride: PlayerOverrideHandle;
  /** 展示スポットの要求先 */
  lighting: Lighting;
  /**
   * 展示が自前の壁を立てるための当たり判定。
   * 追加した線分は ExhibitManager が展示 ID のタグで一括除去する。
   */
  collision: Collision;
  /** 音が成立条件の展示（D4）が使う */
  audio: AudioBus;
  /** 実行中に変わる設定への参照 */
  flags: ExhibitFlags;
  /** @deprecated flags.reducedMotion を使う */
  reducedMotion: boolean;
}
