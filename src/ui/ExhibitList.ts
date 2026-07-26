import type { ExhibitRecord } from '../exhibits/ExhibitManager';
import type { RoomId } from '../data/layout';
import type { Dictionary } from '../i18n';
import { focusScene } from './focus';

export interface ExhibitListOptions {
  /** 選択された展示の ViewSpot へワープする */
  onSelect(record: ExhibitRecord): void;
  titleOf(record: ExhibitRecord): string;
}

const ROOM_ORDER: RoomId[] = ['entrance', 'plane', 'impossible', 'space', 'opus'];

/**
 * 展示一覧とワープ。
 *
 * §8c: 歩行不要で全展示に到達できる導線であり、
 * 3D 酔い対策とアクセシビリティの主要導線を兼ねる。
 */
export class ExhibitList {
  readonly el: HTMLDivElement;
  readonly #body: HTMLDivElement;
  readonly #title: HTMLHeadingElement;
  readonly #close: HTMLButtonElement;
  #open = false;
  #t: Dictionary;

  constructor(
    parent: HTMLElement,
    dictionary: Dictionary,
    private readonly options: ExhibitListOptions,
  ) {
    this.#t = dictionary;
    this.el = document.createElement('div');
    this.el.className = 'exhibit-list';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="exhibit-list-panel">
        <h2 class="exhibit-list-title"></h2>
        <div class="exhibit-list-body"></div>
        <button class="exhibit-list-close" type="button"></button>
      </div>`;
    this.#body = this.el.querySelector('.exhibit-list-body')!;
    this.#title = this.el.querySelector('.exhibit-list-title')!;
    this.#close = this.el.querySelector('.exhibit-list-close')!;
    this.#close.addEventListener('click', () => this.close());
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    parent.appendChild(this.el);
    this.setDictionary(dictionary);
  }

  get isOpen(): boolean {
    return this.#open;
  }

  setDictionary(t: Dictionary): void {
    this.#t = t;
    this.#title.textContent = t.ui.list;
    this.#close.textContent = t.ui.close;
  }

  open(records: ExhibitRecord[]): void {
    this.#render(records);
    this.#open = true;
    this.el.hidden = false;
    this.#body.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  close(): void {
    this.#open = false;
    this.el.hidden = true;
    focusScene();
  }

  toggle(records: ExhibitRecord[]): void {
    if (this.#open) this.close();
    else this.open(records);
  }

  dispose(): void {
    this.el.remove();
  }

  #render(records: ExhibitRecord[]): void {
    const t = this.#t;
    this.#body.replaceChildren();
    for (const room of ROOM_ORDER) {
      const inRoom = records.filter((r) => r.definition.room === room);
      if (inRoom.length === 0) continue;

      const section = document.createElement('section');
      section.className = 'exhibit-list-room';
      const heading = document.createElement('h3');
      heading.textContent = t.rooms[room];
      section.appendChild(heading);

      for (const record of inRoom) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'exhibit-list-item';
        // §12b: 開錠制は廃止した。最初から全展示へワープできる
        button.textContent = this.options.titleOf(record);
        button.addEventListener('click', () => {
          this.close();
          this.options.onSelect(record);
        });
        section.appendChild(button);
      }
      this.#body.appendChild(section);
    }
  }
}
