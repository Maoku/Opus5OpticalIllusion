/**
 * WebAudio の薄いラッパ（ROOM_D §2.4）。
 *
 * autoplay ポリシーにより、AudioContext はユーザー操作の中で resume しないと
 * 鳴らない。D4「聞こえる衝突」は音が成立条件なので、解禁できているかどうかを
 * 展示側から確認できるようにしてある（未解禁なら「音を有効にする」を出す）。
 */
export class AudioBus {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #muted = false;

  get unlocked(): boolean {
    return this.#context?.state === 'running';
  }

  get muted(): boolean {
    return this.#muted;
  }

  set muted(value: boolean) {
    this.#muted = value;
    if (this.#master) this.#master.gain.value = value ? 0 : 1;
  }

  /** ユーザー操作の中から呼ぶこと。失敗しても例外は投げない。 */
  async resume(): Promise<boolean> {
    try {
      if (!this.#context) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.#context = new Ctor();
        this.#master = this.#context.createGain();
        this.#master.gain.value = this.#muted ? 0 : 1;
        this.#master.connect(this.#context.destination);
      }
      if (this.#context.state !== 'running') await this.#context.resume();
      return this.#context.state === 'running';
    } catch {
      return false;
    }
  }

  /**
   * 20ms の短いクリック音。衝突の瞬間に同期させる。
   * 減衰の速い矩形寄りのノイズにすると「カツン」と硬い音になる。
   */
  click(volume = 0.5): void {
    const ctx = this.#context;
    const master = this.#master;
    if (!ctx || !master || this.#muted || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const duration = 0.02;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  dispose(): void {
    try {
      void this.#context?.close();
    } catch {
      /* 無視 */
    }
    this.#context = null;
    this.#master = null;
  }
}
