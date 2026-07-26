// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Device } from '../src/core/Device';

type FullscreenFn = (options?: FullscreenOptions) => Promise<void>;

function stubFullscreen(fn: FullscreenFn | undefined): void {
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    value: fn,
    configurable: true,
    writable: true,
  });
}

function stubOrientationLock(fn: ((o: string) => Promise<void>) | undefined): void {
  Object.defineProperty(screen, 'orientation', {
    value: fn ? { lock: fn } : {},
    configurable: true,
    writable: true,
  });
}

/** tryImmersive が指定時間内に決着することを確かめる */
async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  const sentinel = Symbol('timeout');
  const race = await Promise.race([
    promise.then(() => 'settled' as const),
    new Promise((resolve) => setTimeout(() => resolve(sentinel), ms)),
  ]);
  return race === 'settled';
}

afterEach(() => {
  vi.useRealTimers();
  stubFullscreen(undefined);
  stubOrientationLock(undefined);
});

describe('Device.tryImmersive', () => {
  it('resolves when both APIs are missing', async () => {
    const device = new Device();
    await expect(device.tryImmersive()).resolves.toBeUndefined();
  });

  it('swallows a rejected fullscreen request', async () => {
    stubFullscreen(() => Promise.reject(new Error('denied')));
    stubOrientationLock(() => Promise.reject(new Error('NotSupportedError')));
    const device = new Device();
    await expect(device.tryImmersive()).resolves.toBeUndefined();
  });

  it('swallows a synchronous throw', async () => {
    stubFullscreen(() => {
      throw new Error('boom');
    });
    const device = new Device();
    await expect(device.tryImmersive()).resolves.toBeUndefined();
  });

  /**
   * 実際に起きた不具合の回帰テスト。
   * 実ユーザー操作から呼ばれた requestFullscreen が解決も棄却もされないまま
   * 止まる環境があり、boot() がここで固まって入場ボタンが効かなくなっていた。
   */
  it('gives up on a fullscreen request that never settles', async () => {
    stubFullscreen(() => new Promise<void>(() => undefined));
    stubOrientationLock(() => new Promise<void>(() => undefined));
    const device = new Device();
    expect(await settlesWithin(device.tryImmersive(), 4000)).toBe(true);
  }, 10000);
});
