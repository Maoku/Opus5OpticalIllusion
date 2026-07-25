export type Listener<T> = (payload: T) => void;

/**
 * 型付きの軽量イベントバス。規模的にこれで十分（§0.1）。
 * イベント名とペイロード型の対応はジェネリクスのマップで与える。
 */
export class EventBus<Events extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.#listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    // リスナー内での購読解除に耐えるためコピーしてから回す
    for (const listener of [...set]) {
      (listener as Listener<Events[K]>)(payload);
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
