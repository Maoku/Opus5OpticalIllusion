import * as THREE from 'three';
import type { ExhibitId, ViewSpotDefinition } from '../exhibits/types';
import { damp } from '../utils/math';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uActive;
uniform vec3 uColor;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  // outer ring
  float ring = smoothstep(0.06, 0.0, abs(r - 0.88));
  // pulse converging inward: reads as "stand here"
  float pulsePhase = fract(uTime * 0.45);
  float pulseR = mix(0.86, 0.16, pulsePhase);
  float pulse = smoothstep(0.09, 0.0, abs(r - pulseR)) * (1.0 - pulsePhase) * 0.8;
  // faint core glow
  float core = smoothstep(0.55, 0.0, r) * 0.28;

  float alpha = (ring + pulse + core) * mix(0.45, 1.0, uActive);
  vec3 color = mix(uColor, vec3(1.0), uActive * 0.35);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;

/**
 * 床の視点マーカー（§0.4）。
 *
 * 「錯視の多くは単一視点でしか成立しない」ため、これは装飾ではなく
 * 体験の成立条件そのもの。近づくと明るくなり、決定でスナップする。
 */
export class ViewSpot {
  readonly mesh: THREE.Mesh;
  readonly standAt = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly lookAt = new THREE.Vector3();

  #active = 0;
  #target = 0;

  constructor(
    readonly exhibitId: ExhibitId,
    readonly index: number,
    readonly definition: ViewSpotDefinition,
  ) {
    this.standAt.set(definition.standAt.x, definition.standAt.y, definition.standAt.z);
    this.eye.set(definition.eye.x, definition.eye.y, definition.eye.z);
    this.lookAt.set(definition.lookAt.x, definition.lookAt.y, definition.lookAt.z);

    const geometry = new THREE.PlaneGeometry(1.3, 1.3);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uActive: { value: 0 },
        uColor: { value: new THREE.Color(0x6fd2b0) },
      },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.standAt);
    // 床との z-fighting を避けるため僅かに浮かせる
    this.mesh.position.y += 0.012;
    this.mesh.renderOrder = 2;
    this.mesh.name = `viewspot:${exhibitId}:${index}`;
  }

  get radius(): number {
    return this.definition.radius;
  }

  /** プレイヤーが反応半径内にいるか */
  contains(position: THREE.Vector3): boolean {
    const dx = position.x - this.standAt.x;
    const dz = position.z - this.standAt.z;
    return dx * dx + dz * dz <= this.radius * this.radius;
  }

  distanceTo(position: THREE.Vector3): number {
    return Math.hypot(position.x - this.standAt.x, position.z - this.standAt.z);
  }

  setHighlighted(v: boolean): void {
    this.#target = v ? 1 : 0;
  }

  update(dt: number, elapsed: number): void {
    const material = this.mesh.material as THREE.ShaderMaterial;
    material.uniforms.uTime!.value = elapsed;
    this.#active = THREE.MathUtils.lerp(this.#active, this.#target, damp(9, dt));
    material.uniforms.uActive!.value = this.#active;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
