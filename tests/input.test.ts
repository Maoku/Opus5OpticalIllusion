// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { KeyboardMouseSource } from '../src/core/input/KeyboardMouseSource';
import {
  applyDeadzone,
  isDashing,
  isTap,
  stickVector,
  toNdc,
  TAP_MAX_DISTANCE_PX,
  TAP_MAX_DURATION_MS,
} from '../src/core/input/gesture';

describe('isTap', () => {
  it('accepts a short, still touch', () => {
    expect(isTap({ x: 100, y: 100, time: 0 }, { x: 103, y: 101, time: 120 })).toBe(true);
  });

  it('rejects a drag', () => {
    expect(
      isTap({ x: 100, y: 100, time: 0 }, { x: 100 + TAP_MAX_DISTANCE_PX + 1, y: 100, time: 50 }),
    ).toBe(false);
  });

  it('rejects a long press', () => {
    expect(
      isTap({ x: 100, y: 100, time: 0 }, { x: 100, y: 100, time: TAP_MAX_DURATION_MS + 1 }),
    ).toBe(false);
  });
});

describe('stickVector', () => {
  it('is zero at the origin', () => {
    expect(stickVector({ x: 50, y: 50 }, { x: 50, y: 50 }, 64)).toEqual({ x: 0, y: 0 });
  });

  it('flips screen-down into move-backward', () => {
    const v = stickVector({ x: 0, y: 0 }, { x: 0, y: 64 }, 64);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(-1);
  });

  it('clamps to length 1 beyond the radius', () => {
    const v = stickVector({ x: 0, y: 0 }, { x: 500, y: 0 }, 64);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 9);
  });

  it('scales linearly inside the radius', () => {
    const v = stickVector({ x: 0, y: 0 }, { x: 32, y: 0 }, 64);
    expect(v.x).toBeCloseTo(0.5, 9);
  });
});

describe('applyDeadzone', () => {
  it('zeroes small inputs', () => {
    expect(applyDeadzone({ x: 0.05, y: 0 }, 0.12)).toEqual({ x: 0, y: 0 });
  });

  it('keeps full deflection reachable', () => {
    const v = applyDeadzone({ x: 1, y: 0 }, 0.12);
    expect(v.x).toBeCloseTo(1, 6);
  });

  it('does not jump at the deadzone boundary', () => {
    const just = applyDeadzone({ x: 0.13, y: 0 }, 0.12);
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.05);
  });
});

describe('isDashing', () => {
  it('needs near-full deflection', () => {
    expect(isDashing({ x: 0.7, y: 0 })).toBe(false);
    expect(isDashing({ x: 0.95, y: 0 })).toBe(true);
  });
});

describe('toNdc', () => {
  const rect = { left: 0, top: 0, width: 800, height: 600 };

  it('maps the centre to the origin', () => {
    const p = toNdc(400, 300, rect);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it('maps the top-left to (-1, 1)', () => {
    const p = toNdc(0, 0, rect);
    expect(p.x).toBeCloseTo(-1);
    expect(p.y).toBeCloseTo(1);
  });

  it('accounts for the element offset', () => {
    const p = toNdc(100, 100, { left: 100, top: 100, width: 800, height: 600 });
    expect(p.x).toBeCloseTo(-1);
    expect(p.y).toBeCloseTo(1);
  });
});

/**
 * §9a: 「ヒントを開いて閉じたら二度と歩けない」の回帰。
 * 閉じたヒントはフォーカスをヒントボタンへ返していたので、単独の BUTTON を
 * 入力抑止の条件にすると移動が永久に死ぬ。
 */
describe('KeyboardMouseSource focus handling', () => {
  const sources: KeyboardMouseSource[] = [];

  afterEach(() => {
    for (const s of sources) s.dispose();
    sources.length = 0;
    document.body.replaceChildren();
  });

  function setup(): KeyboardMouseSource {
    const canvas = document.createElement('div');
    document.body.appendChild(canvas);
    const source = new KeyboardMouseSource(canvas);
    sources.push(source);
    return source;
  }

  function press(code: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  }

  function focusButton(host: HTMLElement = document.body): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    host.appendChild(button);
    button.focus();
    return button;
  }

  it('keeps moving while a HUD button has focus', () => {
    const source = setup();
    focusButton();
    press('KeyW');
    expect(source.poll().move.y).toBeGreaterThan(0);
  });

  it('stays still while a control inside a dialog has focus', () => {
    const source = setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    focusButton(dialog);
    press('KeyW');
    expect(source.poll().move).toEqual({ x: 0, y: 0 });
  });

  it('stays still while a text field has focus', () => {
    const source = setup();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    press('KeyW');
    expect(source.poll().move).toEqual({ x: 0, y: 0 });
  });

  it('still delivers Escape from inside a dialog', () => {
    const source = setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    focusButton(dialog);
    press('Escape');
    expect(source.poll().pressed.has('cancel')).toBe(true);
  });

  // Space はボタンの活性化キーでもある。クリックと決定の二重発火を避ける
  it('yields Space to a focused button instead of firing interact', () => {
    const source = setup();
    focusButton();
    press('Space');
    expect(source.poll().pressed.has('interact')).toBe(false);
  });

  it('fires interact from Space when nothing is focused', () => {
    const source = setup();
    press('Space');
    expect(source.poll().pressed.has('interact')).toBe(true);
  });

  it('always fires interact from F, even with a button focused', () => {
    const source = setup();
    focusButton();
    press('KeyF');
    expect(source.poll().pressed.has('interact')).toBe(true);
  });
});
