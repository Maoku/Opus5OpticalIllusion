import { EventBus } from './EventBus';
import type { QualityLevel } from './Quality';

export interface SettingsModel {
  /** 視野角（度）。3D 酔い対策として調整可能にする */
  fov: number;
  mouseSensitivity: number;
  touchSensitivityDegPerPx: number;
  invertY: boolean;
  headBob: boolean;
  /** 'auto' は端末判定 + 自動降格に任せる */
  quality: QualityLevel | 'auto';
  /** prefers-reduced-motion とは別に、ユーザーが明示的に切れるトグル */
  reducedMotion: boolean;
  /** ROOM_D §5: D2「縮んでいく部屋」の独立トグル（3D 酔い対策） */
  shrinkingRoom: boolean;
  muted: boolean;
}

export const DEFAULT_SETTINGS: SettingsModel = {
  fov: 70,
  mouseSensitivity: 0.0022,
  touchSensitivityDegPerPx: 0.16,
  invertY: false,
  headBob: false,
  quality: 'auto',
  reducedMotion: false,
  shrinkingRoom: true,
  muted: false,
};

const STORAGE_KEY = 'oim.settings.v1';

export interface SettingsEvents extends Record<string, unknown> {
  changed: SettingsModel;
}

export class Settings {
  readonly events = new EventBus<SettingsEvents>();
  #model: SettingsModel;

  constructor(defaults: Partial<SettingsModel> = {}) {
    this.#model = { ...DEFAULT_SETTINGS, ...defaults, ...readStored() };
  }

  get value(): SettingsModel {
    return this.#model;
  }

  patch(patch: Partial<SettingsModel>): void {
    this.#model = { ...this.#model, ...patch };
    writeStored(this.#model);
    this.events.emit('changed', this.#model);
  }

  reset(): void {
    this.#model = { ...DEFAULT_SETTINGS };
    writeStored(this.#model);
    this.events.emit('changed', this.#model);
  }
}

function readStored(): Partial<SettingsModel> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<SettingsModel>) : {};
  } catch {
    return {};
  }
}

function writeStored(model: SettingsModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    /* プライベートブラウジング等。保存できなくても動作は続ける */
  }
}
