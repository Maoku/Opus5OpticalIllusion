/**
 * 入力抽象化（§4.1）。
 *
 * 上位（PlayerController / ViewpointController / HintPanel）は
 * キーボードなのかバーチャルパッドなのかを一切知らない。
 * ここを飛ばすとバーチャルパッド対応が全面改修になる（§8 リスク表）。
 */
export type GameAction =
  | 'interact' // ViewSpot に立つ / ワールド内ボタンを押す
  | 'hint' // ヒントを見る
  | 'reveal' // タネあかし
  | 'cancel' // ロック解除 / パネルを閉じる
  | 'list' // 展示一覧
  | 'settings'; // 設定メニュー

export type InputSourceId = 'keyboardMouse' | 'touch';

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
  readonly id: InputSourceId;
  poll(dt: number): InputState;
  dispose(): void;
}

export const EMPTY_ACTIONS: ReadonlySet<GameAction> = new Set<GameAction>();

export function emptyInputState(): InputState {
  return {
    move: { x: 0, y: 0 },
    look: { yaw: 0, pitch: 0 },
    pressed: EMPTY_ACTIONS,
    pointerNdc: null,
  };
}

export interface LookSettings {
  /** マウス感度（rad / px） */
  mouseSensitivity: number;
  /** タッチ感度（deg / px）。§4.2 に従い deg/px で定義する */
  touchSensitivityDegPerPx: number;
  invertY: boolean;
}

export const DEFAULT_LOOK_SETTINGS: LookSettings = {
  mouseSensitivity: 0.0022,
  touchSensitivityDegPerPx: 0.16,
  invertY: false,
};
