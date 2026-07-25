import type * as THREE from 'three';
import type { Assets } from './Assets';
import type { Quality } from './Quality';

/**
 * ExhibitManager / ViewpointController が App に求める最小面。
 *
 * App をそのまま受け取ると WebGLRenderer の生成が必要になり、
 * ゾーン退出時の巻き戻し（ROOM_D §5）を Vitest で担保できなくなる。
 * App はこのインターフェースを構造的に満たす。
 */
export interface SceneHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly assets: Assets;
  readonly quality: Quality;
  readonly elapsed: number;
  renderCamera: THREE.Camera;
}
