/**
 * ローディング画面。進捗バーと「クリックして入場」を出す。
 * 入場クリックは autoplay ポリシー解除（AudioContext.resume）と
 * 全画面/向きロック試行のトリガも兼ねる（Phase 7 / §4.3）。
 */
export class LoadingScreen {
  readonly el: HTMLDivElement;
  readonly #bar: HTMLDivElement;
  readonly #label: HTMLDivElement;
  readonly #enter: HTMLButtonElement;
  readonly #title: HTMLHeadingElement;
  readonly #intro: HTMLParagraphElement;
  #ratio = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading-screen';
    this.el.innerHTML = `
      <div class="loading-inner">
        <h1 class="loading-title">Optical Illusion Museum</h1>
        <p class="loading-intro"></p>
        <div class="loading-bar"><div class="loading-bar-fill"></div></div>
        <div class="loading-label">0%</div>
        <button class="loading-enter" type="button" hidden></button>
      </div>`;
    this.#bar = this.el.querySelector('.loading-bar-fill')!;
    this.#label = this.el.querySelector('.loading-label')!;
    this.#enter = this.el.querySelector('.loading-enter')!;
    this.#title = this.el.querySelector('.loading-title')!;
    this.#intro = this.el.querySelector('.loading-intro')!;
    parent.appendChild(this.el);
  }

  /**
   * 入館時の導入文（§12a）。
   *
   * エントランスの自立案内板を撤去したので、その内容はここで一度だけ出す。
   * 3D 空間に説明文を置かない、という方針の受け皿。
   */
  setIntro(title: string, body: string): void {
    this.#title.textContent = title;
    // 案内板と同じく、改行はそのまま活かす
    this.#intro.textContent = body;
  }

  setProgress(ratio: number): void {
    this.#ratio = Math.max(this.#ratio, Math.min(1, Math.max(0, ratio)));
    this.#bar.style.transform = `scaleX(${this.#ratio})`;
    this.#label.textContent = `${Math.round(this.#ratio * 100)}%`;
  }

  /** 読み込み完了。入場ボタンを出し、押されたら解決する Promise を返す。 */
  ready(enterLabel: string): Promise<void> {
    this.setProgress(1);
    this.#enter.textContent = enterLabel;
    this.#enter.hidden = false;
    this.#enter.focus();
    return new Promise((resolve) => {
      this.#enter.addEventListener('click', () => resolve(), { once: true });
    });
  }

  hide(): void {
    this.el.classList.add('is-hidden');
    window.setTimeout(() => this.el.remove(), 600);
  }
}
