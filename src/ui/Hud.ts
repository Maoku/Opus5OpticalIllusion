import type { InputSourceId } from '../core/input/types';
import type { Dictionary } from '../i18n';

/**
 * クロスヘア・現在の部屋名・操作プロンプト。
 *
 * プロンプトは active input source を見て出し分ける（§4.1）。
 * デスクトップは「[F] ここから見る」、タッチはボタンに任せて文言だけ出す。
 */
export class Hud {
  readonly el: HTMLDivElement;
  readonly #crosshair: HTMLDivElement;
  readonly #room: HTMLDivElement;
  readonly #prompt: HTMLDivElement;
  readonly #toast: HTMLDivElement;
  #toastTimer = 0;
  #source: InputSourceId = 'keyboardMouse';
  #promptText: string | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-crosshair" aria-hidden="true"></div>
      <div class="hud-room"></div>
      <div class="hud-prompt" role="status" aria-live="polite"></div>
      <div class="hud-toast" role="status" aria-live="polite"></div>`;
    this.#crosshair = this.el.querySelector('.hud-crosshair')!;
    this.#room = this.el.querySelector('.hud-room')!;
    this.#prompt = this.el.querySelector('.hud-prompt')!;
    this.#toast = this.el.querySelector('.hud-toast')!;
    parent.appendChild(this.el);
  }

  setRoomName(name: string | null): void {
    this.#room.textContent = name ?? '';
    this.#room.classList.toggle('is-visible', !!name);
  }

  /** ViewSpot 進入プロンプト。null で消える */
  setPrompt(text: string | null): void {
    this.#promptText = text;
    this.#renderPrompt();
  }

  setActiveSource(source: InputSourceId): void {
    this.#source = source;
    // クロスヘアはデスクトップのみ（タッチでは指で隠れる）
    this.#crosshair.classList.toggle('is-visible', source === 'keyboardMouse');
    this.#renderPrompt();
  }

  setDictionary(_t: Dictionary): void {
    // 文言そのものは setPrompt / setRoomName の呼び出し側が辞書から渡す
  }

  /** 一時的な告知（Opus 棟の開錠など）。数秒で消える */
  showToast(text: string, ms = 5000): void {
    this.#toast.textContent = text;
    this.#toast.classList.add('is-visible');
    window.clearTimeout(this.#toastTimer);
    this.#toastTimer = window.setTimeout(() => {
      this.#toast.classList.remove('is-visible');
    }, ms);
  }

  dispose(): void {
    window.clearTimeout(this.#toastTimer);
    this.el.remove();
  }

  #renderPrompt(): void {
    if (!this.#promptText) {
      this.#prompt.textContent = '';
      this.#prompt.classList.remove('is-visible');
      return;
    }
    this.#prompt.textContent =
      this.#source === 'keyboardMouse' ? `[F] ${this.#promptText}` : this.#promptText;
    this.#prompt.classList.add('is-visible');
  }
}
