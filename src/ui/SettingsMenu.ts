import type { Settings, SettingsModel } from '../core/Settings';
import type { QualityLevel } from '../core/Quality';
import { focusScene } from './focus';

/**
 * 設定メニューの文言。i18n 辞書から注入する（§5.1: コードに文言を埋めない）。
 */
export interface SettingsLabels {
  title: string;
  fov: string;
  mouseSensitivity: string;
  touchSensitivity: string;
  invertY: string;
  headBob: string;
  quality: string;
  qualityAuto: string;
  qualityLow: string;
  qualityMid: string;
  qualityHigh: string;
  reducedMotion: string;
  shrinkingRoom: string;
  muted: string;
  close: string;
  language: string;
}

/** 設定メニューに常設する「操作方法」（§9b-5）。案内板の受け皿。 */
export interface ControlsHelp {
  heading: string;
  rows: Array<[label: string, value: string]>;
}

type Row = { el: HTMLElement; sync: (m: SettingsModel) => void };

/** FOV / 感度 / Y軸反転 / ヘッドボブ / 画質 の設定パネル（Phase 3 DoD） */
export class SettingsMenu {
  readonly el: HTMLDivElement;
  readonly #rows: Row[] = [];
  readonly #body: HTMLDivElement;
  readonly #titleEl: HTMLHeadingElement;
  readonly #closeBtn: HTMLButtonElement;
  #open = false;
  #onCloseFocus: HTMLElement | null = null;
  #help!: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    labels: SettingsLabels,
    /** 言語切替 UI をここに差し込む（Phase 5 の LanguageSwitch） */
    languageControl?: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'settings-menu';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="settings-panel">
        <h2 class="settings-title"></h2>
        <div class="settings-body"></div>
        <button class="settings-close" type="button"></button>
      </div>`;
    this.#titleEl = this.el.querySelector('.settings-title')!;
    this.#body = this.el.querySelector('.settings-body')!;
    this.#closeBtn = this.el.querySelector('.settings-close')!;
    this.#closeBtn.addEventListener('click', () => this.close());
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    parent.appendChild(this.el);

    if (languageControl) {
      this.#body.appendChild(this.#labelled(labels.language, languageControl));
    }
    this.#buildRows();
    // 操作方法は設定のいちばん下。3D 空間の案内板を撤去した後もここから読める
    this.#help = document.createElement('section');
    this.#help.className = 'settings-help';
    this.#body.appendChild(this.#help);
    this.setLabels(labels);
    this.#sync();

    settings.events.on('changed', () => this.#sync());
  }

  get isOpen(): boolean {
    return this.#open;
  }

  setLabels(labels: SettingsLabels): void {
    this.#titleEl.textContent = labels.title;
    this.#closeBtn.textContent = labels.close;
    for (const [key, el] of this.#labelNodes) {
      el.textContent = labels[key];
    }
    for (const [value, el] of this.#qualityNodes) {
      el.textContent =
        value === 'auto'
          ? labels.qualityAuto
          : value === 'low'
            ? labels.qualityLow
            : value === 'mid'
              ? labels.qualityMid
              : labels.qualityHigh;
    }
  }

  /** 操作方法セクションの中身。言語切替のたびに呼ばれる。 */
  setControlsHelp(help: ControlsHelp): void {
    const heading = document.createElement('h3');
    heading.className = 'settings-help-heading';
    heading.textContent = help.heading;
    const rows = help.rows.map(([label, value]) => {
      const row = document.createElement('p');
      row.className = 'settings-help-row';
      const term = document.createElement('span');
      term.className = 'settings-help-term';
      term.textContent = label;
      row.append(term, document.createTextNode(value));
      return row;
    });
    this.#help.replaceChildren(heading, ...rows);
  }

  open(returnFocusTo?: HTMLElement): void {
    this.#open = true;
    this.el.hidden = false;
    this.#onCloseFocus = returnFocusTo ?? null;
    this.#closeBtn.focus();
  }

  close(): void {
    this.#open = false;
    this.el.hidden = true;
    // 明示的な戻し先が無ければ操作面へ（§9a-2）
    if (this.#onCloseFocus) this.#onCloseFocus.focus();
    else focusScene();
  }

  toggle(): void {
    if (this.#open) this.close();
    else this.open();
  }

  dispose(): void {
    this.el.remove();
  }

  // ------------------------------------------------------------- internals

  readonly #labelNodes = new Map<keyof SettingsLabels, HTMLElement>();
  readonly #qualityNodes = new Map<QualityLevel | 'auto', HTMLElement>();

  #labelled(text: string, control: HTMLElement, key?: keyof SettingsLabels): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const span = document.createElement('span');
    span.className = 'settings-label';
    span.textContent = text;
    if (key) this.#labelNodes.set(key, span);
    row.append(span, control);
    return row;
  }

  #buildRows(): void {
    this.#addSlider('fov', 60, 100, 1, (m) => m.fov, (v) => ({ fov: v }));
    this.#addSlider(
      'mouseSensitivity',
      0.0005,
      0.006,
      0.0001,
      (m) => m.mouseSensitivity,
      (v) => ({ mouseSensitivity: v }),
    );
    this.#addSlider(
      'touchSensitivity',
      0.05,
      0.4,
      0.01,
      (m) => m.touchSensitivityDegPerPx,
      (v) => ({ touchSensitivityDegPerPx: v }),
    );
    this.#addToggle('invertY', (m) => m.invertY, (v) => ({ invertY: v }));
    this.#addToggle('headBob', (m) => m.headBob, (v) => ({ headBob: v }));
    this.#addToggle('reducedMotion', (m) => m.reducedMotion, (v) => ({ reducedMotion: v }));
    this.#addToggle('shrinkingRoom', (m) => m.shrinkingRoom, (v) => ({ shrinkingRoom: v }));
    this.#addToggle('muted', (m) => m.muted, (v) => ({ muted: v }));
    this.#addQuality();
  }

  #addSlider(
    key: keyof SettingsLabels,
    min: number,
    max: number,
    step: number,
    read: (m: SettingsModel) => number,
    write: (v: number) => Partial<SettingsModel>,
  ): void {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.className = 'settings-slider';
    input.addEventListener('input', () => this.settings.patch(write(Number(input.value))));
    const row = this.#labelled('', input, key);
    this.#body.appendChild(row);
    this.#rows.push({ el: row, sync: (m) => (input.value = String(read(m))) });
  }

  #addToggle(
    key: keyof SettingsLabels,
    read: (m: SettingsModel) => boolean,
    write: (v: boolean) => Partial<SettingsModel>,
  ): void {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'settings-toggle';
    input.addEventListener('change', () => this.settings.patch(write(input.checked)));
    const row = this.#labelled('', input, key);
    this.#body.appendChild(row);
    this.#rows.push({ el: row, sync: (m) => (input.checked = read(m)) });
  }

  #addQuality(): void {
    const group = document.createElement('div');
    group.className = 'settings-choice';
    const values: Array<QualityLevel | 'auto'> = ['auto', 'low', 'mid', 'high'];
    const buttons = new Map<QualityLevel | 'auto', HTMLButtonElement>();
    for (const value of values) {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => this.settings.patch({ quality: value }));
      group.appendChild(button);
      buttons.set(value, button);
      this.#qualityNodes.set(value, button);
    }
    const row = this.#labelled('', group, 'quality');
    this.#body.appendChild(row);
    this.#rows.push({
      el: row,
      sync: (m) => {
        for (const [value, button] of buttons) {
          button.classList.toggle('is-selected', m.quality === value);
        }
      },
    });
  }

  #sync(): void {
    for (const row of this.#rows) row.sync(this.settings.value);
  }
}
