import type { Dictionary } from '../i18n';
import type { HintContent } from '../exhibits/types';

export type HintStage = 'hidden' | 'appearance' | 'explanation';

export interface HintPanelOptions {
  /** 第2段階に入る/戻るときに呼ばれる。3D シーンの reveal 演出を駆動する */
  onRevealChange(revealed: boolean): void;
  onStageChange?(stage: HintStage): void;
}

/**
 * ヒントの段階式開示（★要件の中核 / §Phase 5）。
 *
 *   初期状態: 完全非表示（DOM は存在するが aria-hidden + 非表示）
 *   1. 「ヒントを見る」→ どう見えるか
 *   2. 「タネあかしを見る」→ なぜそう見えるか ＋ 3D シーンの reveal 演出
 *   3. 「元に戻す」→ reveal を巻き戻してパネルを閉じる
 *
 * ヒントを一度も押さなければ、解説は一切目に入らない。
 */
export class HintPanel {
  readonly el: HTMLDivElement;
  readonly button: HTMLButtonElement;

  readonly #panel: HTMLDivElement;
  readonly #title: HTMLHeadingElement;
  readonly #appearanceHeading: HTMLHeadingElement;
  readonly #appearance: HTMLParagraphElement;
  readonly #explanationBlock: HTMLDivElement;
  readonly #explanationHeading: HTMLHeadingElement;
  readonly #explanation: HTMLParagraphElement;
  readonly #referenceBlock: HTMLDivElement;
  readonly #referenceHeading: HTMLHeadingElement;
  readonly #reference: HTMLParagraphElement;
  readonly #next: HTMLButtonElement;
  readonly #close: HTMLButtonElement;

  #stage: HintStage = 'hidden';
  #content: HintContent | null = null;
  #contentKey: string | null = null;
  #available = false;
  #t: Dictionary;

  constructor(
    parent: HTMLElement,
    dictionary: Dictionary,
    private readonly options: HintPanelOptions,
  ) {
    this.#t = dictionary;
    this.el = document.createElement('div');
    this.el.className = 'hint-layer';
    this.el.innerHTML = `
      <button class="hint-open" type="button" hidden></button>
      <div class="hint-panel" role="dialog" aria-modal="false" hidden>
        <h2 class="hint-title"></h2>
        <div class="hint-scroll">
          <h3 class="hint-heading hint-heading-appearance"></h3>
          <p class="hint-text hint-appearance"></p>
          <div class="hint-explanation-block" hidden>
            <h3 class="hint-heading hint-heading-explanation"></h3>
            <p class="hint-text hint-explanation"></p>
          </div>
          <div class="hint-reference-block" hidden>
            <h3 class="hint-heading hint-heading-reference"></h3>
            <p class="hint-reference"></p>
          </div>
        </div>
        <div class="hint-actions">
          <button class="hint-next" type="button"></button>
          <button class="hint-close" type="button"></button>
        </div>
      </div>`;

    this.button = this.el.querySelector('.hint-open')!;
    this.#panel = this.el.querySelector('.hint-panel')!;
    this.#title = this.el.querySelector('.hint-title')!;
    this.#appearanceHeading = this.el.querySelector('.hint-heading-appearance')!;
    this.#appearance = this.el.querySelector('.hint-appearance')!;
    this.#explanationBlock = this.el.querySelector('.hint-explanation-block')!;
    this.#explanationHeading = this.el.querySelector('.hint-heading-explanation')!;
    this.#explanation = this.el.querySelector('.hint-explanation')!;
    this.#referenceBlock = this.el.querySelector('.hint-reference-block')!;
    this.#referenceHeading = this.el.querySelector('.hint-heading-reference')!;
    this.#reference = this.el.querySelector('.hint-reference')!;
    this.#next = this.el.querySelector('.hint-next')!;
    this.#close = this.el.querySelector('.hint-close')!;

    this.button.addEventListener('click', () => this.advance());
    this.#next.addEventListener('click', () => this.advance());
    this.#close.addEventListener('click', () => this.close());
    this.#panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Tab') this.#trapFocus(e);
    });

    parent.appendChild(this.el);
    this.setDictionary(dictionary);
    this.#render();
  }

  get stage(): HintStage {
    return this.#stage;
  }

  get isOpen(): boolean {
    return this.#stage !== 'hidden';
  }

  setDictionary(t: Dictionary): void {
    this.#t = t;
    this.#appearanceHeading.textContent = t.ui.appearanceHeading;
    this.#explanationHeading.textContent = t.ui.explanationHeading;
    this.#referenceHeading.textContent = t.ui.referenceHeading;
    this.#close.textContent = t.ui.closeButton;
    this.#render();
  }

  /**
   * フォーカス中の展示の文言。null なら「どの展示にも向き合っていない」。
   *
   * key は展示の同一性。言語切替では key が変わらないので、
   * 開いているヒントを畳まずに文言だけ差し替える。
   */
  setContent(content: HintContent | null, key: string | null = null): void {
    if (content === this.#content) return;
    const sameExhibit = key !== null && key === this.#contentKey;
    if (!sameExhibit && this.#stage !== 'hidden') this.close();
    this.#content = content;
    this.#contentKey = key;
    this.#render();
  }

  /** ViewSpot ロック中、または展示を注視中のみボタンを出す */
  setAvailable(available: boolean): void {
    if (available === this.#available) return;
    this.#available = available;
    if (!available && this.#stage !== 'hidden') this.close();
    this.#render();
  }

  /** H キー / ヒントボタン: 段階を1つ進める */
  advance(): void {
    if (!this.#content || !this.#available) return;
    if (this.#stage === 'hidden') this.#setStage('appearance');
    else if (this.#stage === 'appearance') this.#setStage('explanation');
    else this.close();
  }

  /** Esc / 「元に戻す」: reveal を巻き戻して閉じる */
  close(): void {
    if (this.#stage === 'hidden') return;
    this.#setStage('hidden');
  }

  toggle(): void {
    if (this.#stage === 'hidden') this.advance();
    else this.close();
  }

  dispose(): void {
    this.el.remove();
  }

  // ------------------------------------------------------------- internals

  #setStage(stage: HintStage): void {
    if (stage === this.#stage) return;
    const wasRevealed = this.#stage === 'explanation';
    this.#stage = stage;
    const isRevealed = stage === 'explanation';
    if (wasRevealed !== isRevealed) this.options.onRevealChange(isRevealed);
    this.options.onStageChange?.(stage);
    this.#render();
    if (stage !== 'hidden') this.#next.focus();
    else this.button.focus({ preventScroll: true });
  }

  #render(): void {
    const t = this.#t;
    const content = this.#content;
    const open = this.#stage !== 'hidden';

    this.button.hidden = !this.#available || open || !content;
    this.button.textContent = `💡 ${t.ui.hintButton}`;

    this.#panel.hidden = !open;
    // 非表示のときは支援技術からも隠す（初期状態は「完全非表示」）
    this.#panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (!content) return;

    this.#title.textContent = content.title;
    this.#appearance.textContent = content.appearance;

    const explained = this.#stage === 'explanation';
    this.#explanationBlock.hidden = !explained;
    this.#explanation.textContent = content.explanation;

    const hasReference = explained && !!content.reference;
    this.#referenceBlock.hidden = !hasReference;
    this.#reference.textContent = content.reference ?? '';

    this.#next.textContent = explained ? t.ui.closeButton : t.ui.revealButton;
    this.#close.textContent = t.ui.close;
    this.#close.hidden = explained;
  }

  /** パネル内でフォーカスを閉じ込める（§8c: キーボードのみで全操作可能） */
  #trapFocus(e: KeyboardEvent): void {
    const focusable = [...this.#panel.querySelectorAll<HTMLElement>('button:not([hidden])')];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
