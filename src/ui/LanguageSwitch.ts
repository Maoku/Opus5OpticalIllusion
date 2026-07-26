import { LOCALES, LOCALE_LABELS, type Locale } from '../i18n';

/** 言語切替。リロード不要で即時反映する（§5.6） */
export class LanguageSwitch {
  readonly el: HTMLDivElement;
  readonly #buttons = new Map<Locale, HTMLButtonElement>();

  constructor(onSelect: (locale: Locale) => void) {
    this.el = document.createElement('div');
    this.el.className = 'settings-choice language-switch';
    this.el.setAttribute('role', 'group');
    for (const locale of LOCALES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.lang = locale;
      button.textContent = LOCALE_LABELS[locale];
      button.addEventListener('click', () => onSelect(locale));
      this.el.appendChild(button);
      this.#buttons.set(locale, button);
    }
  }

  /**
   * 見出しを持たない場所（タイトル画面）に置くとき用のラベル。
   * 設定メニュー内では行ラベルが役目を果たすので呼ばなくてよい。
   */
  setLabel(label: string): void {
    this.el.setAttribute('aria-label', label);
  }

  setLocale(locale: Locale): void {
    for (const [key, button] of this.#buttons) {
      button.classList.toggle('is-selected', key === locale);
      button.setAttribute('aria-pressed', String(key === locale));
    }
  }
}
