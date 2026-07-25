export type UpdateFn = (dt: number, elapsed: number) => void;
export type RenderFn = (alpha: number, elapsed: number) => void;

const FIXED_DT = 1 / 60;
/** タブ復帰時に dt が巨大化して物理が飛ぶのを防ぐ上限（§Phase 1） */
const MAX_FRAME_DT = 0.25;
/** 1 フレームで消化する固定ステップの上限（スパイラル防止） */
const MAX_STEPS = 5;

/**
 * 固定 dt の update + 可変 render ループ。
 * update は常に 1/60 秒刻みで呼ばれるので、衝突・補間の挙動が fps に依存しない。
 */
export class Loop {
  #rafId = 0;
  #running = false;
  #lastTime = 0;
  #accumulator = 0;
  #elapsed = 0;
  #frameDt = FIXED_DT;

  constructor(
    private readonly update: UpdateFn,
    private readonly render: RenderFn,
  ) {}

  /** 直近フレームの実 dt（fps 計測・自動降格の判定に使う） */
  get frameDt(): number {
    return this.#frameDt;
  }

  get elapsed(): number {
    return this.#elapsed;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = performance.now();
    this.#accumulator = 0;
    this.#tick(this.#lastTime);
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
  }

  readonly #tick = (now: number): void => {
    if (!this.#running) return;
    this.#rafId = requestAnimationFrame(this.#tick);

    const raw = (now - this.#lastTime) / 1000;
    this.#lastTime = now;
    const dt = Math.min(Math.max(raw, 0), MAX_FRAME_DT);
    this.#frameDt = dt;
    this.#accumulator += dt;

    let steps = 0;
    while (this.#accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.#elapsed += FIXED_DT;
      this.update(FIXED_DT, this.#elapsed);
      this.#accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.#accumulator = 0;

    this.render(this.#accumulator / FIXED_DT, this.#elapsed);
  };
}

export const FIXED_TIMESTEP = FIXED_DT;
