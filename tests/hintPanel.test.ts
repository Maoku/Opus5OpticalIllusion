// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HintPanel } from '../src/ui/HintPanel';
import { setSceneElement } from '../src/ui/focus';
import { ja } from '../src/i18n/ja';
import type { Dictionary } from '../src/i18n';
import type { HintContent } from '../src/exhibits/types';

const t = ja as unknown as Dictionary;

const CONTENT: HintContent = {
  title: 'カフェウォール錯視',
  appearance: 'どう見えるか',
  explanation: 'なぜそう見えるか',
  reference: '出典',
};

function setup(): {
  panel: HintPanel;
  root: HTMLElement;
  onRevealChange: ReturnType<typeof vi.fn>;
} {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onRevealChange = vi.fn();
  const panel = new HintPanel(root, t, { onRevealChange });
  return { panel, root, onRevealChange };
}

function panelEl(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.hint-panel')!;
}

function textOf(root: HTMLElement, selector: string): string {
  const el = root.querySelector<HTMLElement>(selector)!;
  return el.hidden || el.closest('[hidden]') ? '' : (el.textContent ?? '');
}

describe('HintPanel staged disclosure', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    document.body.replaceChildren();
    s = setup();
  });

  // ★要件: ヒントを一度も押さなければ解説が一切目に入らない
  it('starts completely hidden, even from assistive technology', () => {
    expect(s.panel.stage).toBe('hidden');
    expect(panelEl(s.root).hidden).toBe(true);
    expect(panelEl(s.root).getAttribute('aria-hidden')).toBe('true');
    expect(s.panel.button.hidden).toBe(true);
  });

  it('shows the hint button only when an exhibit is available', () => {
    s.panel.setContent(CONTENT);
    expect(s.panel.button.hidden).toBe(true);
    s.panel.setAvailable(true);
    expect(s.panel.button.hidden).toBe(false);
    expect(s.panel.button.textContent).toContain(t.ui.hintButton);
  });

  it('reveals appearance first, and never the explanation', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    expect(s.panel.stage).toBe('appearance');
    expect(panelEl(s.root).hidden).toBe(false);
    expect(textOf(s.root, '.hint-appearance')).toBe(CONTENT.appearance);
    expect(textOf(s.root, '.hint-explanation')).toBe('');
    expect(s.onRevealChange).not.toHaveBeenCalled();
  });

  it('reveals the explanation and drives the 3D reveal on the second press', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    s.panel.advance();
    expect(s.panel.stage).toBe('explanation');
    expect(textOf(s.root, '.hint-explanation')).toBe(CONTENT.explanation);
    expect(textOf(s.root, '.hint-reference')).toBe(CONTENT.reference);
    expect(s.onRevealChange).toHaveBeenCalledWith(true);
  });

  it('rolls the reveal back when closed', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    s.panel.advance();
    s.panel.close();
    expect(s.panel.stage).toBe('hidden');
    expect(s.onRevealChange).toHaveBeenLastCalledWith(false);
    expect(panelEl(s.root).getAttribute('aria-hidden')).toBe('true');
  });

  it('rolls the reveal back when the exhibit changes', () => {
    s.panel.setContent(CONTENT, 'cafeWall');
    s.panel.setAvailable(true);
    s.panel.advance();
    s.panel.advance();
    s.panel.setContent({ ...CONTENT, title: 'ネッカーキューブ' }, 'neckerCube');
    expect(s.panel.stage).toBe('hidden');
    expect(s.onRevealChange).toHaveBeenLastCalledWith(false);
  });

  // 言語切替でヒントが畳まれると、読んでいる途中で消えてしまう
  it('keeps the open stage when only the language changes', () => {
    s.panel.setContent(CONTENT, 'cafeWall');
    s.panel.setAvailable(true);
    s.panel.advance();
    s.panel.advance();
    s.panel.setContent({ ...CONTENT, title: 'Café Wall illusion' }, 'cafeWall');
    expect(s.panel.stage).toBe('explanation');
    expect(s.root.querySelector('.hint-title')!.textContent).toBe('Café Wall illusion');
  });

  it('rolls the reveal back when the player walks away', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    s.panel.advance();
    s.panel.setAvailable(false);
    expect(s.panel.stage).toBe('hidden');
    expect(s.onRevealChange).toHaveBeenLastCalledWith(false);
  });

  it('cycles hidden -> appearance -> explanation -> hidden with toggle/advance', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      s.panel.advance();
      seen.push(s.panel.stage);
    }
    expect(seen).toEqual(['appearance', 'explanation', 'hidden', 'appearance']);
  });

  it('does nothing without content', () => {
    s.panel.setAvailable(true);
    s.panel.advance();
    expect(s.panel.stage).toBe('hidden');
  });

  it('swaps every label when the dictionary changes', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    const swapped = {
      ...t,
      ui: { ...t.ui, hintButton: 'Show hint', revealButton: 'Show me why' },
    } as Dictionary;
    s.panel.setDictionary(swapped);
    expect(s.root.querySelector('.hint-next')!.textContent).toBe('Show me why');
  });

  /**
   * §12a: 3D 空間のキャプション板を撤去した。その文言と注意書きを
   * 受け取るのはここだけなので、第 1 段階から読めなければ情報が消える。
   */
  it('carries the caption and notice from the removed world plates', () => {
    s.panel.setContent({
      ...CONTENT,
      caption: '目地の明るさが、傾きを作る。',
      notice: 'この展示はスクリーンショットでは伝わりません。',
    });
    s.panel.setAvailable(true);
    s.panel.advance();
    expect(textOf(s.root, '.hint-caption')).toBe('目地の明るさが、傾きを作る。');
    expect(textOf(s.root, '.hint-notice')).toBe('この展示はスクリーンショットでは伝わりません。');
  });

  it('hides the caption and notice for exhibits that have none', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    expect(textOf(s.root, '.hint-caption')).toBe('');
    expect(textOf(s.root, '.hint-notice')).toBe('');
  });

  // §9a: 閉じたあとフォーカスがヒントボタンに残ると WASD が死ぬ
  it('returns focus to the scene when closed, not to the hint button', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    setSceneElement(canvas);
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    s.panel.close();
    expect(document.activeElement).toBe(canvas);
    setSceneElement(null);
  });

  // §8c: パネルは実 DOM テキストであること（スクリーンリーダ可読）
  it('renders hint text as real DOM text nodes', () => {
    s.panel.setContent(CONTENT);
    s.panel.setAvailable(true);
    s.panel.advance();
    const paragraph = s.root.querySelector('.hint-appearance')!;
    expect(paragraph.textContent).toBe(CONTENT.appearance);
    expect(paragraph.childNodes[0]?.nodeType).toBe(3);
  });
});
