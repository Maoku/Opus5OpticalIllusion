import { VirtualPad } from '../../ui/VirtualPad';
import { applyDeadzone, isTap, stickVector, toNdc, type PointerSample } from './gesture';
import {
  DEFAULT_LOOK_SETTINGS,
  type GameAction,
  type InputSource,
  type InputState,
  type LookSettings,
} from './types';

/** 左スティックの反応半径（px）。指の可動域に対して大きすぎない値 */
const STICK_RADIUS = 64;
const STICK_DEADZONE = 0.12;
/** 画面左からこの割合までが移動領域（§4.2: 左下 40% 領域） */
const STICK_ZONE_RATIO = 0.45;

interface TrackedPointer {
  role: 'stick' | 'look';
  start: PointerSample;
  origin: { x: number; y: number };
  last: { x: number; y: number };
  moved: boolean;
}

/**
 * タッチ入力 → InputState（§4.1 / §4.2）。
 *
 * - 左領域: 可変原点のサムスティック
 * - 右領域: ドラッグで視点回転、タップでレイキャスト
 * - 左右同時操作は pointerId で個別に追跡する
 */
export class TouchSource implements InputSource {
  readonly id = 'touch' as const;

  settings: LookSettings = { ...DEFAULT_LOOK_SETTINGS };

  readonly #pointers = new Map<number, TrackedPointer>();
  readonly #pad: VirtualPad;
  #lookDx = 0;
  #lookDy = 0;
  #pending = new Set<GameAction>();
  #pendingNdc: { x: number; y: number } | null = null;
  #anyInput = false;
  readonly #listeners: Array<() => void> = [];

  constructor(
    private readonly element: HTMLElement,
    padParent: HTMLElement,
  ) {
    this.#pad = new VirtualPad(padParent);

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      const rect = this.element.getBoundingClientRect();
      const isStick =
        e.clientX - rect.left < rect.width * STICK_ZONE_RATIO &&
        e.clientY - rect.top > rect.height * 0.35;
      const sample: PointerSample = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      this.#pointers.set(e.pointerId, {
        role: isStick ? 'stick' : 'look',
        start: sample,
        origin: { x: e.clientX, y: e.clientY },
        last: { x: e.clientX, y: e.clientY },
        moved: false,
      });
      if (isStick) this.#pad.show(e.clientX - rect.left, e.clientY - rect.top);
      this.#anyInput = true;
    };

    const onMove = (e: PointerEvent): void => {
      const tracked = this.#pointers.get(e.pointerId);
      if (!tracked) return;
      const dx = e.clientX - tracked.last.x;
      const dy = e.clientY - tracked.last.y;
      tracked.last = { x: e.clientX, y: e.clientY };
      if (Math.hypot(e.clientX - tracked.start.x, e.clientY - tracked.start.y) > 4) {
        tracked.moved = true;
      }
      if (tracked.role === 'look') {
        this.#lookDx += dx;
        this.#lookDy += dy;
      } else {
        const v = applyDeadzone(
          stickVector(tracked.origin, tracked.last, STICK_RADIUS),
          STICK_DEADZONE,
        );
        this.#pad.setKnob(v.x, v.y, STICK_RADIUS);
      }
      this.#anyInput = true;
    };

    const onUp = (e: PointerEvent): void => {
      const tracked = this.#pointers.get(e.pointerId);
      if (!tracked) return;
      this.#pointers.delete(e.pointerId);
      if (tracked.role === 'stick') this.#pad.hide();

      // §4.2: タップとドラッグの弁別。タップだけをレイキャストに使う
      const end: PointerSample = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      if (tracked.role === 'look' && !tracked.moved && isTap(tracked.start, end)) {
        const rect = this.element.getBoundingClientRect();
        this.#pendingNdc = toNdc(end.x, end.y, rect);
        this.#pending.add('interact');
      }
      this.#anyInput = true;
    };

    element.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    this.#listeners.push(
      () => element.removeEventListener('pointerdown', onDown),
      () => window.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
      () => window.removeEventListener('pointercancel', onUp),
    );
  }

  get pad(): VirtualPad {
    return this.#pad;
  }

  /** TouchActionBar のボタンから呼ぶ（§4.1: 文脈ボタン） */
  queueAction(action: GameAction): void {
    this.#pending.add(action);
    this.#anyInput = true;
  }

  consumeActivity(): boolean {
    const had = this.#anyInput;
    this.#anyInput = false;
    return had;
  }

  poll(): InputState {
    let move = { x: 0, y: 0 };
    for (const tracked of this.#pointers.values()) {
      if (tracked.role !== 'stick') continue;
      move = applyDeadzone(stickVector(tracked.origin, tracked.last, STICK_RADIUS), STICK_DEADZONE);
    }

    const degPerPx = this.settings.touchSensitivityDegPerPx;
    const radPerPx = (degPerPx * Math.PI) / 180;
    const invert = this.settings.invertY ? -1 : 1;
    const look = { yaw: -this.#lookDx * radPerPx, pitch: -this.#lookDy * radPerPx * invert };
    this.#lookDx = 0;
    this.#lookDy = 0;

    const pressed = this.#pending;
    this.#pending = new Set();
    const pointerNdc = this.#pendingNdc;
    this.#pendingNdc = null;

    return { move, look, pressed, pointerNdc };
  }

  dispose(): void {
    for (const off of this.#listeners) off();
    this.#listeners.length = 0;
    this.#pointers.clear();
    this.#pad.dispose();
  }
}
