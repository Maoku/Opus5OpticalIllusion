import * as THREE from 'three';
import { Assets } from './Assets';
import { Device } from './Device';
import { EventBus } from './EventBus';
import { Loop } from './Loop';
import { Quality, type QualityPreset } from './Quality';
import { applyQuality, createRenderer, resizeRenderer } from './RendererFactory';
import { DevHud } from '../ui/DevHud';
import { DisposeBag } from '../utils/dispose';

export interface AppEvents extends Record<string, unknown> {
  quality: QualityPreset;
  resize: { width: number; height: number };
}

export interface Updatable {
  update(dt: number, elapsed: number): void;
}

export interface AppOptions {
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
}

/**
 * 全体のライフサイクル。renderer / scene / camera / loop を所有し、
 * 上位のシステム（Museum, Player, ExhibitManager …）を Updatable として束ねる。
 */
export class App {
  readonly device = new Device();
  readonly quality: Quality;
  readonly assets = new Assets();
  readonly events = new EventBus<AppEvents>();

  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly overlayRoot: HTMLElement;

  readonly #loop: Loop;
  readonly #updatables: Updatable[] = [];
  readonly #bag = new DisposeBag();
  readonly #devHud: DevHud | null;
  #renderCamera: THREE.Camera;

  constructor({ canvas, overlayRoot }: AppOptions) {
    this.overlayRoot = overlayRoot;
    this.quality = new Quality(this.device.defaultQuality);
    this.renderer = createRenderer({ canvas, preset: this.quality.preset });

    const vp = this.device.viewport;
    this.camera = new THREE.PerspectiveCamera(70, vp.width / vp.height, 0.05, 200);
    this.camera.position.set(0, 1.6, 4);

    this.#renderCamera = this.camera;
    this.#loop = new Loop(this.#update, this.#render);

    this.#bag.addFn(this.device.onViewportChange(() => this.resize()));
    this.#bag.addFn(
      this.quality.events.on('changed', (preset) => {
        applyQuality(this.renderer, preset);
        this.events.emit('quality', preset);
      }),
    );
    this.resize();

    this.#devHud = import.meta.env.DEV ? new DevHud(overlayRoot) : null;
  }

  add(updatable: Updatable): void {
    this.#updatables.push(updatable);
  }

  remove(updatable: Updatable): void {
    const i = this.#updatables.indexOf(updatable);
    if (i >= 0) this.#updatables.splice(i, 1);
  }

  /**
   * 実際に描画に使うカメラ。正投影を要求する ViewSpot（ネッカーキューブ）で
   * OrthographicCamera に差し替わる。
   */
  get renderCamera(): THREE.Camera {
    return this.#renderCamera;
  }

  set renderCamera(camera: THREE.Camera) {
    this.#renderCamera = camera;
    this.resize();
  }

  resize(): void {
    const { width, height } = this.device.viewport;
    resizeRenderer(this.renderer, this.camera, width, height);
    if (this.#renderCamera !== this.camera) {
      resizeRenderer(
        this.renderer,
        this.#renderCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
        width,
        height,
      );
    }
    this.events.emit('resize', { width, height });
  }

  start(): void {
    this.#loop.start();
  }

  stop(): void {
    this.#loop.stop();
  }

  get elapsed(): number {
    return this.#loop.elapsed;
  }

  readonly #update = (dt: number, elapsed: number): void => {
    for (const u of this.#updatables) u.update(dt, elapsed);
  };

  readonly #render = (): void => {
    this.renderer.render(this.scene, this.#renderCamera);
    this.quality.sampleFrame(this.#loop.frameDt);
    this.#devHud?.update(this.#loop.frameDt, this.renderer, this.quality.level);
  };

  dispose(): void {
    this.stop();
    this.#devHud?.dispose();
    this.#bag.dispose();
    this.assets.dispose();
    this.device.dispose();
    this.renderer.dispose();
    this.events.clear();
  }
}
