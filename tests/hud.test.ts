// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Hud } from '../src/ui/Hud';

/**
 * §9b-1: ポインタロック中はカーソルが消えるので、UI をキーで操作できることが
 * 画面に出ていないと詰む。常設キーガイドの出し分けを固定する。
 */
describe('Hud key guide', () => {
  let root: HTMLElement;
  let hud: Hud;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
    hud = new Hud(root);
  });

  function keys(): HTMLElement {
    return root.querySelector<HTMLElement>('.hud-keys')!;
  }

  it('starts empty', () => {
    expect(keys().classList.contains('is-visible')).toBe(false);
    expect(keys().textContent).toBe('');
  });

  it('renders each hint as a key and a label', () => {
    hud.setKeyHints([
      { key: 'H', label: 'ヒント' },
      { key: 'Esc', label: 'カーソルを出す' },
    ]);
    const items = keys().querySelectorAll('.hud-key');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('kbd')!.textContent).toBe('H');
    expect(items[0]!.textContent).toContain('ヒント');
    expect(keys().classList.contains('is-visible')).toBe(true);
  });

  // タッチでは同じ内容が文脈ボタンに出るので、キーガイドは邪魔になる
  it('hides itself when touch becomes the active source', () => {
    hud.setKeyHints([{ key: 'H', label: 'ヒント' }]);
    hud.setActiveSource('touch');
    expect(keys().classList.contains('is-visible')).toBe(false);
    hud.setActiveSource('keyboardMouse');
    expect(keys().classList.contains('is-visible')).toBe(true);
  });

  // 毎フレーム呼ばれるので、同じ内容なら DOM を作り直さないこと
  it('keeps the same nodes when the hints are unchanged', () => {
    hud.setKeyHints([{ key: 'H', label: 'ヒント' }]);
    const first = keys().firstElementChild;
    hud.setKeyHints([{ key: 'H', label: 'ヒント' }]);
    expect(keys().firstElementChild).toBe(first);
  });

  it('clears the guide when given nothing', () => {
    hud.setKeyHints([{ key: 'H', label: 'ヒント' }]);
    hud.setKeyHints([]);
    expect(keys().classList.contains('is-visible')).toBe(false);
    expect(keys().textContent).toBe('');
  });
});
