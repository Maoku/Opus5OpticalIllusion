/**
 * バーチャルパッドの見た目（§4.2）。
 *
 * Canvas ではなく DOM で実装する。セーフエリア追従が CSS の env() で済み、
 * aria-label を付けられ、3D の描画負荷と独立に動くため。
 *
 * 入力の解釈は TouchSource 側の責務で、ここは表示だけを持つ。
 */
export class VirtualPad {
  readonly root: HTMLDivElement;
  readonly #base: HTMLDivElement;
  readonly #knob: HTMLDivElement;
  #visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'virtual-pad';
    this.root.innerHTML = `
      <div class="pad-base" aria-hidden="true">
        <div class="pad-knob"></div>
      </div>`;
    this.#base = this.root.querySelector('.pad-base')!;
    this.#knob = this.root.querySelector('.pad-knob')!;
    parent.appendChild(this.root);
    this.hide();
  }

  /** 可変原点方式: 触れた場所にスティックを出す */
  show(originX: number, originY: number): void {
    this.#visible = true;
    this.#base.style.left = `${originX}px`;
    this.#base.style.top = `${originY}px`;
    this.root.classList.add('is-active');
    this.setKnob(0, 0, 1);
  }

  /** vector は -1..1、radius は px */
  setKnob(x: number, y: number, radius: number): void {
    if (!this.#visible) return;
    // y は「前進が正」で来るので、画面座標に戻す
    this.#knob.style.transform = `translate(-50%, -50%) translate(${x * radius}px, ${-y * radius}px)`;
  }

  hide(): void {
    this.#visible = false;
    this.root.classList.remove('is-active');
  }

  setEnabled(enabled: boolean): void {
    this.root.hidden = !enabled;
    if (!enabled) this.hide();
  }

  dispose(): void {
    this.root.remove();
  }
}
