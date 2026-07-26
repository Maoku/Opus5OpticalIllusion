/**
 * ポインタロック（デスクトップのみ）。
 *
 * iOS Safari には Pointer Lock が無い（§4.1）。requestPointerLock は
 * 必ず try/catch で呼び、失敗しても素通しのマウス移動で視点が動くようにする。
 */
export class PointerLookControls {
  #locked = false;
  #justReleased = false;
  #enabled = true;
  #dx = 0;
  #dy = 0;
  #dragging = false;
  #listeners: Array<() => void> = [];

  constructor(private readonly element: HTMLElement) {
    const onPointerDown = (e: PointerEvent): void => {
      if (!this.#enabled || e.button !== 0) return;
      if (this.#locked) return;
      if (!this.request()) {
        // Pointer Lock が使えない環境ではドラッグで代替する
        this.#dragging = true;
        element.setPointerCapture(e.pointerId);
      }
    };
    const onPointerUp = (): void => {
      this.#dragging = false;
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (!this.#enabled) return;
      if (this.#locked || this.#dragging) {
        this.#dx += e.movementX ?? 0;
        this.#dy += e.movementY ?? 0;
      }
    };
    const onLockChange = (): void => {
      const locked = document.pointerLockElement === element;
      // Chrome ではロック中の Esc がブラウザに吸われるが、ページにも届く
      // 環境がある。届いた場合に「ロック解除」と「ヒントを閉じる」が
      // 一度に走らないよう、解除直後の cancel を捨てる材料を残す（§9b-4）。
      if (this.#locked && !locked) this.#justReleased = true;
      this.#locked = locked;
    };

    element.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerlockchange', onLockChange);

    this.#listeners = [
      () => element.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => document.removeEventListener('pointerlockchange', onLockChange),
    ];
  }

  get locked(): boolean {
    return this.#locked;
  }

  set enabled(v: boolean) {
    this.#enabled = v;
    if (!v) this.exit();
  }

  /** 前回の確認以降にロックが外れたか。1 回読むと下りる。 */
  consumeJustReleased(): boolean {
    const released = this.#justReleased;
    this.#justReleased = false;
    return released;
  }

  /** ロックを試みる。成功見込みがあれば true */
  request(): boolean {
    try {
      const el = this.element as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
      if (!el.requestPointerLock) return false;
      const result = el.requestPointerLock();
      // Safari は Promise を返さない。返ってきたら失敗を握り潰す
      void Promise.resolve(result).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  exit(): void {
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {
      /* 無視 */
    }
    this.#dragging = false;
  }

  /** 前回の consume 以降に溜まったマウス移動量を取り出す */
  consume(): { dx: number; dy: number } {
    const out = { dx: this.#dx, dy: this.#dy };
    this.#dx = 0;
    this.#dy = 0;
    return out;
  }

  dispose(): void {
    this.exit();
    for (const off of this.#listeners) off();
    this.#listeners = [];
  }
}
