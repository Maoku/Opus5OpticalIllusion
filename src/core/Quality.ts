import { EventBus } from './EventBus';

export type QualityLevel = 'low' | 'mid' | 'high';

export interface QualityPreset {
  level: QualityLevel;
  /** devicePixelRatio の上限 */
  maxPixelRatio: number;
  /** 影 OFF なら 0 */
  shadowMapSize: number;
  antialias: boolean;
  /** 展示スポットライトの同時点灯上限（§2 の「合計8灯以内」） */
  maxSpotLights: number;
  /** 目標 fps。自動降格の閾値判定に使う */
  targetFps: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low',
    maxPixelRatio: 1.0,
    shadowMapSize: 0,
    antialias: false,
    maxSpotLights: 1,
    targetFps: 30,
  },
  mid: {
    level: 'mid',
    maxPixelRatio: 1.5,
    shadowMapSize: 1024,
    antialias: true,
    maxSpotLights: 4,
    targetFps: 45,
  },
  high: {
    level: 'high',
    maxPixelRatio: 2.0,
    shadowMapSize: 2048,
    antialias: true,
    maxSpotLights: 8,
    targetFps: 60,
  },
};

const ORDER: QualityLevel[] = ['low', 'mid', 'high'];

export interface QualityEvents extends Record<string, unknown> {
  changed: QualityPreset;
}

/**
 * 画質プリセットの保持と自動降格（§4.4 / Phase 8a）。
 *
 * antialias だけは WebGLRenderer 生成時にしか決められないため、
 * 実行中の降格では pixelRatio / 影 / ライト数のみが変化する。
 */
export class Quality {
  readonly events = new EventBus<QualityEvents>();

  #preset: QualityPreset;
  #autoDegrade = true;
  /** 直近フレームの dt を保持するリングバッファ */
  readonly #frames: number[] = [];
  #cooldown = 0;

  constructor(initial: QualityLevel) {
    this.#preset = QUALITY_PRESETS[initial];
  }

  get preset(): QualityPreset {
    return this.#preset;
  }

  get level(): QualityLevel {
    return this.#preset.level;
  }

  set autoDegrade(v: boolean) {
    this.#autoDegrade = v;
  }

  get autoDegrade(): boolean {
    return this.#autoDegrade;
  }

  setLevel(level: QualityLevel): void {
    if (level === this.#preset.level) return;
    this.#preset = QUALITY_PRESETS[level];
    this.#frames.length = 0;
    this.#cooldown = 3;
    this.events.emit('changed', this.#preset);
  }

  /**
   * 毎フレーム呼ぶ。直近 60 フレームの平均 fps が目標の 80% を割ったら 1 段下げる。
   * 降格後は 3 秒のクールダウンを置き、連鎖降格を防ぐ。
   */
  sampleFrame(dt: number): void {
    if (this.#cooldown > 0) {
      this.#cooldown -= dt;
      return;
    }
    if (!this.#autoDegrade) return;

    this.#frames.push(dt);
    if (this.#frames.length < 60) return;
    if (this.#frames.length > 60) this.#frames.shift();

    const avg = this.#frames.reduce((a, b) => a + b, 0) / this.#frames.length;
    const fps = avg > 0 ? 1 / avg : Infinity;
    if (fps < this.#preset.targetFps * 0.8) {
      const idx = ORDER.indexOf(this.#preset.level);
      if (idx > 0) this.setLevel(ORDER[idx - 1]!);
      else this.#cooldown = 10; // low で足りないならこれ以上できることはない
      this.#frames.length = 0;
    }
  }
}
