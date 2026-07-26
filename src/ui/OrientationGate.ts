import type { Dictionary } from '../i18n';

/**
 * 縦持ち時の案内（§4.3）。
 *
 * 強制はしない。縦でも一応遊べる状態を保ち、「閉じる」で消せるようにする。
 */
export class OrientationGate {
  readonly el: HTMLDivElement;
  readonly #title: HTMLHeadingElement;
  readonly #body: HTMLParagraphElement;
  readonly #close: HTMLButtonElement;
  #dismissed = false;
  #portrait = false;
  #enabled = false;

  constructor(parent: HTMLElement, dictionary: Dictionary) {
    this.el = document.createElement('div');
    this.el.className = 'orientation-gate';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="orientation-inner">
        <h2 class="orientation-title"></h2>
        <p class="orientation-body"></p>
        <button class="orientation-close" type="button"></button>
      </div>`;
    this.#title = this.el.querySelector('.orientation-title')!;
    this.#body = this.el.querySelector('.orientation-body')!;
    this.#close = this.el.querySelector('.orientation-close')!;
    this.#close.addEventListener('click', () => {
      this.#dismissed = true;
      this.#render();
    });
    parent.appendChild(this.el);
    this.setDictionary(dictionary);
  }

  /** タッチ端末でのみ有効にする */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#render();
  }

  setPortrait(portrait: boolean): void {
    if (portrait !== this.#portrait) {
      this.#portrait = portrait;
      // 一度横にしたら、次に縦へ戻ったときはまた案内する
      if (!portrait) this.#dismissed = false;
    }
    this.#render();
  }

  setDictionary(t: Dictionary): void {
    this.#title.textContent = t.ui.orientationTitle;
    this.#body.textContent = t.ui.orientationBody;
    this.#close.textContent = t.ui.close;
  }

  dispose(): void {
    this.el.remove();
  }

  #render(): void {
    this.el.hidden = !(this.#enabled && this.#portrait && !this.#dismissed);
  }
}
