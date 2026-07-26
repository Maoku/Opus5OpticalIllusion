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
  #ambience: AudioBufferSourceNode | null = null;
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

  /**
   * ホールの環境音。残響のある空間を思わせる、ごく低い帯域のノイズ。
   * 音楽は置かない（§10-1: 環境音のみでも成立する）。
   */
  startAmbience(volume = 0.045): void {
    const ctx = this.#context;
    const master = this.#master;
    if (!ctx || !master || this.#ambience) return;

    // 4 秒ぶんのブラウンノイズを作ってループさせる
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    // 継ぎ目のクリックを消すため、端をクロスフェードしておく
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] = data[i]! * k + data[length - fade + i]! * (1 - k);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 2.5);

    source.connect(filter).connect(gain).connect(master);
    source.start();
    this.#ambience = source;
  }

  /** 足音。短いノイズのバースト。歩幅ごとに呼ぶ */
  footstep(volume = 0.06): void {
    const ctx = this.#context;
    const master = this.#master;
    if (!ctx || !master || this.#muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.07);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 240 + Math.random() * 120;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
  }

  /** UI の効果音。ヒントを開く・視点に立つなど */
  ui(frequency = 880, volume = 0.12): void {
    const ctx = this.#context;
    const master = this.#master;
    if (!ctx || !master || this.#muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  dispose(): void {
    try {
      this.#ambience?.stop();
    } catch {
      /* 無視 */
    }
    this.#ambience = null;
    try {
      void this.#context?.close();
    } catch {
      /* 無視 */
    }
    this.#context = null;
    this.#master = null;
  }
}
