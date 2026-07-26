import { PointerLookControls } from '../../player/PointerLookControls';
import {
  DEFAULT_LOOK_SETTINGS,
  type GameAction,
  type InputSource,
  type InputState,
  type LookSettings,
} from './types';

const ACTION_KEYS: Record<string, GameAction> = {
  KeyF: 'interact',
  Enter: 'interact',
  Space: 'interact',
  KeyH: 'hint',
  KeyR: 'reveal',
  Escape: 'cancel',
  Tab: 'list',
  KeyO: 'settings',
};

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * UI 側にフォーカスがあるか。
 * ここが true の間はゲーム側のキー割り当てを止め、ブラウザ既定の
 * フォーカス移動と活性化に任せる。
 */
function isTextualFocus(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'BUTTON') return true;
  return !!active.closest('[role="dialog"]');
}

/** ピッチのクランプ（±85°） */
export const PITCH_LIMIT = (85 * Math.PI) / 180;

export class KeyboardMouseSource implements InputSource {
  readonly id = 'keyboardMouse' as const;

  readonly look: PointerLookControls;
  settings: LookSettings = { ...DEFAULT_LOOK_SETTINGS };

  readonly #held = new Set<string>();
  #pressed = new Set<GameAction>();
  #anyInput = false;
  readonly #listeners: Array<() => void> = [];

  constructor(element: HTMLElement) {
    this.look = new PointerLookControls(element);

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      // §8c: キーボードだけで全操作できること。
      // パネルやダイアログにフォーカスがあるときは Tab を奪わない。
      // 奪うとフォーカス移動が死に、キーボードだけの利用者が閉じ込められる。
      if (isTextualFocus()) {
        if (e.code === 'Escape') this.#pressed.add('cancel');
        return;
      }
      if (e.code === 'Tab') e.preventDefault();
      this.#held.add(e.code);
      const action = ACTION_KEYS[e.code];
      if (action) this.#pressed.add(action);
      this.#anyInput = true;
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.#held.delete(e.code);
    };
    const onBlur = (): void => this.#held.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.#listeners.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
    );
  }

  /** 最後に入力があったのがこのソースか判定するためのフラグ */
  consumeActivity(): boolean {
    const had = this.#anyInput;
    this.#anyInput = false;
    return had;
  }

  poll(): InputState {
    let x = 0;
    let y = 0;
    for (const code of this.#held) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir[0];
        y += dir[1];
      }
    }
    const len = Math.hypot(x, y);
    if (len > 0) {
      // Shift でダッシュ。長さ 1.0 がダッシュ相当（§4.1: 長さ > 0.9）
      const scale = (this.#held.has('ShiftLeft') || this.#held.has('ShiftRight') ? 1 : 0.7) / len;
      x *= scale;
      y *= scale;
      this.#anyInput = true;
    }

    const { dx, dy } = this.look.consume();
    if (dx !== 0 || dy !== 0) this.#anyInput = true;
    const invert = this.settings.invertY ? -1 : 1;

    const pressed = this.#pressed;
    this.#pressed = new Set();

    return {
      move: { x, y },
      look: {
        yaw: -dx * this.settings.mouseSensitivity,
        pitch: -dy * this.settings.mouseSensitivity * invert,
      },
      pressed,
      // デスクトップのレイキャストは常に画面中央（クロスヘア）
      pointerNdc: { x: 0, y: 0 },
    };
  }

  dispose(): void {
    this.look.dispose();
    for (const off of this.#listeners) off();
    this.#listeners.length = 0;
  }
}
