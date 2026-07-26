import { EventBus } from '../core/EventBus';
import { ja, type JaDictionary } from './ja';

export type Locale = 'ja' | 'en';
export const LOCALES: readonly Locale[] = ['ja', 'en'];

/**
 * 言語名は「その言語自身の表記」で出す（自称語）。
 * 翻訳対象ではないので辞書ではなくここに置く。
 */
export const LOCALE_LABELS: Record<Locale, string> = { ja: '日本語', en: 'English' };

/** ja を型の源にすることで、英語の訳し漏れがビルド時に落ちる（§5.2） */
type Stringify<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : Stringify<T[K]>;
};

export type Dictionary = Stringify<JaDictionary>;
export type ExhibitTextKey = keyof Dictionary['exhibits'];
export type RoomTextKey = keyof Dictionary['rooms'];

const STORAGE_KEY = 'oim.locale';

export interface I18nEvents extends Record<string, unknown> {
  changed: { locale: Locale; t: Dictionary };
}

/**
 * 初期言語の決定（§5.6）:
 *   ?lang= クエリ > localStorage > navigator.language（ja で始まれば日本語）> 既定 en
 */
export function resolveInitialLocale(search = location.search): Locale {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (isLocale(fromQuery)) return fromQuery;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* プライベートブラウジング等 */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  if (nav?.toLowerCase().startsWith('ja')) return 'ja';
  return 'en';
}

export function isLocale(value: unknown): value is Locale {
  return value === 'ja' || value === 'en';
}

/**
 * 辞書の保持と切替。リロード不要で即時反映する購読モデル（§5.6）。
 * en.ts は動的 import して初期ロードから外す。
 */
export class I18n {
  readonly events = new EventBus<I18nEvents>();

  #locale: Locale = 'ja';
  #dictionaries: Partial<Record<Locale, Dictionary>> = { ja: ja as Dictionary };

  get locale(): Locale {
    return this.#locale;
  }

  /** 現在の辞書 */
  get t(): Dictionary {
    return this.#dictionaries[this.#locale] ?? (ja as Dictionary);
  }

  async setLocale(locale: Locale): Promise<void> {
    if (!this.#dictionaries[locale]) {
      const module = await import('./en');
      this.#dictionaries.en = module.en;
    }
    this.#locale = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* 保存できなくても続行 */
    }
    this.#applyDocumentMetadata();
    this.events.emit('changed', { locale, t: this.t });
  }

  /** 購読と同時に一度呼び出す。UI 側の初期化が 1 行で済む。 */
  subscribe(listener: (t: Dictionary, locale: Locale) => void): () => void {
    listener(this.t, this.#locale);
    return this.events.on('changed', ({ t, locale }) => listener(t, locale));
  }

  #applyDocumentMetadata(): void {
    const t = this.t;
    document.documentElement.lang = this.#locale;
    document.title = t.meta.title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t.meta.description);
    // §5.6: 言語別の改行規則
    document.documentElement.dataset.lang = this.#locale;
  }
}
