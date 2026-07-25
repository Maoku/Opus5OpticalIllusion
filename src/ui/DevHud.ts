import type * as THREE from 'three';

/**
 * dev ビルドのみで出す性能パネル（§8c: renderer.info を dev HUD に出す）。
 * stats.js を足さずに済むよう最小構成で自作している。
 */
export class DevHud {
  readonly el: HTMLDivElement;
  #acc = 0;
  #frames = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dev-hud';
    parent.appendChild(this.el);
  }

  update(dt: number, renderer: THREE.WebGLRenderer, extra = ''): void {
    this.#acc += dt;
    this.#frames++;
    if (this.#acc < 0.5) return;
    const fps = this.#frames / this.#acc;
    const info = renderer.info;
    this.el.textContent =
      `${fps.toFixed(0)} fps  ` +
      `calls ${info.render.calls}  ` +
      `tris ${info.render.triangles}  ` +
      `geo ${info.memory.geometries}  tex ${info.memory.textures}` +
      (extra ? `  ${extra}` : '');
    this.#acc = 0;
    this.#frames = 0;
  }

  dispose(): void {
    this.el.remove();
  }
}
