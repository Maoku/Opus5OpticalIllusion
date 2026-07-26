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

/**
 * 疑似ロケール（§5.6）。
 *
 * 英語は日本語より 1.3〜1.6 倍長くなる。実訳を待たずに崩れを見つけるため、
 * ?pseudo=1 で全文言を 1.6 倍へ引き伸ばし、両端に記号を付けて
 * 「切れているか」「はみ出しているか」を一目で分かるようにする。
 */
export function pseudoLocalise<T>(value: T): T {
  if (typeof value === 'string') {
    const padding = '·'.repeat(Math.max(2, Math.ceil(value.length * 0.6)));
    return `«${value}${padding}»` as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = pseudoLocalise(child);
    }
    return out as T;
  }
  return value;
}

function pseudoEnabled(): boolean {
  try {
    return new URLSearchParams(location.search).get('pseudo') === '1';
  } catch {
    return false;
  }
}

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
  readonly #pseudo = pseudoEnabled();
  readonly #pseudoApplied = new Set<Locale>();
  #dictionaries: Partial<Record<Locale, Dictionary>> = { ja: ja as Dictionary };

  get locale(): Locale {
    return this.#locale;
  }

  /** 現在の辞書 */
  get t(): Dictionary {
    return this.#dictionaries[this.#locale] ?? (ja as Dictionary);
  }

  /** 疑似ロケールが有効か（レイアウト検証用） */
  get pseudo(): boolean {
    return this.#pseudo;
  }

  async setLocale(locale: Locale): Promise<void> {
    if (!this.#dictionaries[locale]) {
      const module = await import('./en');
      this.#dictionaries.en = module.en;
    }
    // 二重に引き伸ばさないよう、辞書ごとに一度だけ適用する
    if (this.#pseudo && !this.#pseudoApplied.has(locale)) {
      this.#dictionaries[locale] = pseudoLocalise(this.#dictionaries[locale]!);
      this.#pseudoApplied.add(locale);
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
