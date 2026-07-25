import { describe, expect, it, vi } from 'vitest';
import { Quality } from '../src/core/Quality';
import { EventBus } from '../src/core/EventBus';

function feed(q: Quality, fps: number, frames: number): void {
  const dt = 1 / fps;
  for (let i = 0; i < frames; i++) q.sampleFrame(dt);
}

describe('Quality auto-degrade', () => {
  it('degrades one step when fps stays below 80% of target', () => {
    const q = new Quality('high');
    feed(q, 30, 80);
    expect(q.level).toBe('mid');
  });

  it('does not degrade while fps is healthy', () => {
    const q = new Quality('high');
    feed(q, 60, 300);
    expect(q.level).toBe('high');
  });

  it('never degrades below low', () => {
    const q = new Quality('low');
    feed(q, 5, 600);
    expect(q.level).toBe('low');
  });

  it('respects the autoDegrade toggle', () => {
    const q = new Quality('high');
    q.autoDegrade = false;
    feed(q, 10, 300);
    expect(q.level).toBe('high');
  });

  it('emits changed with the new preset', () => {
    const q = new Quality('mid');
    const spy = vi.fn();
    q.events.on('changed', spy);
    q.setLevel('low');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ level: 'low', shadowMapSize: 0 });
  });

  it('keeps shadows on for mid and high, off for low', () => {
    expect(new Quality('low').preset.shadowMapSize).toBe(0);
    expect(new Quality('mid').preset.shadowMapSize).toBeGreaterThan(0);
    expect(new Quality('high').preset.shadowMapSize).toBeGreaterThan(0);
  });
});

describe('EventBus', () => {
  it('delivers payloads and supports unsubscribe', () => {
    const bus = new EventBus<{ ping: number }>();
    const seen: number[] = [];
    const off = bus.on('ping', (n) => seen.push(n));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(seen).toEqual([1]);
  });

  it('once fires exactly one time', () => {
    const bus = new EventBus<{ ping: void }>();
    const spy = vi.fn();
    bus.once('ping', spy);
    bus.emit('ping', undefined);
    bus.emit('ping', undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('tolerates unsubscribing from inside a listener', () => {
    const bus = new EventBus<{ ping: void }>();
    const spy = vi.fn();
    const offA = bus.on('ping', () => offB());
    const offB = bus.on('ping', spy);
    bus.emit('ping', undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    bus.emit('ping', undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    offA();
  });
});
