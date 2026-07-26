import { EventBus } from '../EventBus';
import { KeyboardMouseSource } from './KeyboardMouseSource';
import { TouchSource } from './TouchSource';
import {
  emptyInputState,
  type GameAction,
  type InputSourceId,
  type InputState,
  type LookSettings,
  DEFAULT_LOOK_SETTINGS,
} from './types';

export interface InputEvents extends Record<string, unknown> {
  /** HUD の表記を「[F] ここから見る」/ ボタン表示 で出し分けるために使う */
  activeSourceChanged: InputSourceId;
  action: GameAction;
}

export interface InputManagerOptions {
  /** 入力を受けるサーフェス（canvas） */
  element: HTMLElement;
  /** バーチャルパッドを載せる DOM */
  overlay: HTMLElement;
  enableTouch: boolean;
}

/**
 * 両ソースを保持し、最後に入力があったほうを active にする（§4.1）。
 * タブレット + Bluetooth キーボードのような混在環境で自然に切り替わる。
 */
export class InputManager {
  readonly events = new EventBus<InputEvents>();
  readonly keyboard: KeyboardMouseSource;
  readonly touch: TouchSource | null;

  #active: InputSourceId = 'keyboardMouse';
  #state: InputState = emptyInputState();
  readonly #queued = new Set<GameAction>();
  #settings: LookSettings = { ...DEFAULT_LOOK_SETTINGS };
  /** UI がテキスト入力などで入力を専有している間は移動を止める */
  #suspended = false;

  constructor({ element, overlay, enableTouch }: InputManagerOptions) {
    this.keyboard = new KeyboardMouseSource(element);
    this.touch = enableTouch ? new TouchSource(element, overlay) : null;
    if (this.touch) this.#active = 'touch';
  }

  get activeSource(): InputSourceId {
    return this.#active;
  }

  get state(): InputState {
    return this.#state;
  }

  get settings(): LookSettings {
    return this.#settings;
  }

  setSettings(patch: Partial<LookSettings>): void {
    this.#settings = { ...this.#settings, ...patch };
    this.keyboard.settings = this.#settings;
    if (this.touch) this.touch.settings = this.#settings;
  }

  set suspended(v: boolean) {
    this.#suspended = v;
    if (v) this.keyboard.look.exit();
  }

  get suspended(): boolean {
    return this.#suspended;
  }

  get pointerLocked(): boolean {
    return this.keyboard.look.locked;
  }

  /**
   * カーソルを返す（§9b-2）。
   *
   * `suspended` は移動ごと止めてしまうので、ヒント（開いたまま歩ける）には
   * 使えない。ポインタロックだけを外す口を分けて用意する。
   */
  releasePointer(): void {
    this.keyboard.look.exit();
  }

  /** 直前のフレーム以降にポインタロックが外れたか。1 回読むと下りる。 */
  consumePointerRelease(): boolean {
    return this.keyboard.look.consumeJustReleased();
  }

  /** UI のボタンからアクションを流し込む。次の poll で pressed に現れる。 */
  dispatch(action: GameAction): void {
    this.#queued.add(action);
  }

  poll(_dt: number): InputState {
    const keyboard = this.keyboard.poll();
    const touch = this.touch?.poll() ?? null;

    // 「最後に入力があったほう」を active にする
    const keyboardActive = this.keyboard.consumeActivity();
    const touchActive = this.touch?.consumeActivity() ?? false;
    if (touchActive && this.#active !== 'touch') this.#setActive('touch');
    else if (keyboardActive && this.#active !== 'keyboardMouse') this.#setActive('keyboardMouse');

    // 移動・視点は active 側のみ。アクションは両方から受け取る
    // （タッチ端末でも Bluetooth キーボードの Esc が効いてほしい）
    const primary = this.#active === 'touch' && touch ? touch : keyboard;
    const pressed = new Set<GameAction>([
      ...keyboard.pressed,
      ...(touch?.pressed ?? []),
      ...this.#queued,
    ]);
    this.#queued.clear();
    for (const action of pressed) this.events.emit('action', action);

    this.#state = {
      move: this.#suspended ? { x: 0, y: 0 } : primary.move,
      look: this.#suspended ? { yaw: 0, pitch: 0 } : primary.look,
      pressed,
      pointerNdc: touch?.pointerNdc ?? primary.pointerNdc,
    };
    return this.#state;
  }

  dispose(): void {
    this.keyboard.dispose();
    this.touch?.dispose();
    this.events.clear();
  }

  #setActive(id: InputSourceId): void {
    this.#active = id;
    this.events.emit('activeSourceChanged', id);
  }
}
