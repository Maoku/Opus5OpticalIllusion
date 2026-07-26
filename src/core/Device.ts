import type { QualityLevel } from './Quality';

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
  portrait: boolean;
}

/**
 * 端末判定・ビューポート追従・全画面/向きロックの試行（§4.3）。
 *
 * iOS Safari は Pointer Lock も screen.orientation.lock も持たない。
 * 呼べないものは try/catch で握り潰し、必ず処理を継続する。
 */
export class Device {
  readonly isTouch: boolean;
  readonly isIOS: boolean;
  readonly isCoarsePointer: boolean;
  readonly supportsPointerLock: boolean;
  readonly prefersReducedMotion: boolean;

  #listeners: Array<() => void> = [];

  constructor() {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const maxTouch = nav?.maxTouchPoints ?? 0;
    // ?touch=1 / ?touch=0 でタッチ UI を強制する。実機を用意せずに
    // バーチャルパッドと文脈ボタンの導線を確認するための逃げ道（開発用）
    const forced = touchOverride();
    this.isTouch =
      forced ?? (maxTouch > 0 || (typeof window !== 'undefined' && 'ontouchstart' in window));
    this.isCoarsePointer = forced ?? matchMediaSafe('(pointer: coarse)');
    // iPadOS は Macintosh を名乗るため maxTouchPoints で補正する
    const ua = nav?.userAgent ?? '';
    this.isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);
    this.supportsPointerLock =
      typeof document !== 'undefined' && 'requestPointerLock' in document.documentElement;
    this.prefersReducedMotion = matchMediaSafe('(prefers-reduced-motion: reduce)');
  }

  /** タッチ主体の端末か。バーチャルパッドの初期表示判断に使う。 */
  get isMobileLike(): boolean {
    return this.isTouch && this.isCoarsePointer;
  }

  /** §4.4: スマホ既定は low、デスクトップ既定は high */
  get defaultQuality(): QualityLevel {
    if (this.isMobileLike) return 'low';
    const cores = navigator.hardwareConcurrency ?? 4;
    return cores <= 4 ? 'mid' : 'high';
  }

  get viewport(): Viewport {
    const vv = window.visualViewport;
    const width = Math.max(1, Math.round(vv?.width ?? window.innerWidth));
    const height = Math.max(1, Math.round(vv?.height ?? window.innerHeight));
    return {
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      portrait: height > width,
    };
  }

  /** §4.3: resize ではなく visualViewport を購読する */
  onViewportChange(handler: (v: Viewport) => void): () => void {
    const fire = () => handler(this.viewport);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', fire);
    vv?.addEventListener('scroll', fire);
    window.addEventListener('resize', fire);
    window.addEventListener('orientationchange', fire);
    const off = () => {
      vv?.removeEventListener('resize', fire);
      vv?.removeEventListener('scroll', fire);
      window.removeEventListener('resize', fire);
      window.removeEventListener('orientationchange', fire);
    };
    this.#listeners.push(off);
    return off;
  }

  /**
   * 初回タップで呼ぶ。iOS Safari では両方失敗するが、失敗しても続行する。
   *
   * 「失敗する」だけでなく「いつまでも決着しない」ことがある。
   * 実ユーザー操作から呼ばれた requestFullscreen は、埋め込みブラウザや
   * 権限待ちの環境で Promise が解決も棄却もされないまま止まりうる。
   * 呼び出し側を巻き添えにしないよう、必ずタイムアウトで打ち切る。
   */
  async tryImmersive(element: HTMLElement = document.documentElement): Promise<void> {
    if (!document.fullscreenElement && element.requestFullscreen) {
      await settleWithin(() => element.requestFullscreen({ navigationUI: 'hide' }));
    }
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
      | undefined;
    if (orientation?.lock) {
      await settleWithin(() => orientation.lock!('landscape'));
    }
  }

  /** Android のみ有効。iOS では無視されるだけで害はない（§4.2）。 */
  vibrate(ms: number): void {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* 無視 */
    }
  }

  dispose(): void {
    for (const off of this.#listeners) off();
    this.#listeners = [];
  }
}

/** 非対応 API の「投げる / 棄却される / 返ってこない」をすべて吸収する */
async function settleWithin(run: () => Promise<unknown> | undefined, ms = 1200): Promise<void> {
  try {
    await Promise.race([
      Promise.resolve(run()),
      new Promise((resolve) => window.setTimeout(resolve, ms)),
    ]);
  } catch {
    /* 非対応。無視して続行 */
  }
}

function touchOverride(): boolean | null {
  try {
    const value = new URLSearchParams(location.search).get('touch');
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {
    /* 無視 */
  }
  return null;
}

function matchMediaSafe(query: string): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}
