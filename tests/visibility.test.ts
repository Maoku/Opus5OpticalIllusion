import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VisibilityTracker } from '../src/exhibits/common/VisibilityTracker';
import { BEHIND_YOU_LAYOUT } from '../src/exhibits/behindYou';

/**
 * D3「後ろの正面」の判定（ROOM_D §1 / §2.4）。
 *
 * 誤判定の代償が大きい展示である。「見えている個体を変えてしまった」が
 * 一度でも起きると、錯視ではなく **バグ**として記憶される。
 * 視錐台・遮蔽・注視の 3 段すべてを固定しておく。
 */

function cameraAt(x: number, z: number, yaw = 0): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.05, 200);
  camera.position.set(x, 1.6, z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(0, yaw, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

describe('VisibilityTracker', () => {
  it('sees what is in front and not what is behind', () => {
    const camera = cameraAt(0, 0);
    const tracker = new VisibilityTracker(camera, [
      { position: new THREE.Vector3(0, 1.6, -4), radius: 0.4 },
      { position: new THREE.Vector3(0, 1.6, 4), radius: 0.4 },
    ]);
    tracker.update(1 / 60);
    expect(tracker.isVisible(0)).toBe(true);
    expect(tracker.isVisible(1)).toBe(false);
    expect(tracker.isUnobserved(1)).toBe(true);
  });

  it('treats anything beyond the distance limit as unseen', () => {
    const camera = cameraAt(0, 0);
    const tracker = new VisibilityTracker(
      camera,
      [{ position: new THREE.Vector3(0, 1.6, -30), radius: 0.4 }],
      { maxDistance: 20 },
    );
    tracker.update(1 / 60);
    expect(tracker.isVisible(0)).toBe(false);
  });

  // 中庭が無いと回廊の反対側まで視錐台に入り、変えられる個体が無くなる
  it('respects occluders standing between the camera and the target', () => {
    const camera = cameraAt(0, 0);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 0.4), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1.5, -2);
    wall.updateMatrixWorld(true);
    const targets = [
      { position: new THREE.Vector3(0, 1.6, -4), radius: 0.4 },
      { position: new THREE.Vector3(3, 1.6, -4), radius: 0.4 },
    ];
    const tracker = new VisibilityTracker(camera, targets, { occluders: [wall] });
    tracker.update(1 / 60);
    expect(tracker.isVisible(0), 'hidden behind the wall').toBe(false);
    expect(tracker.isVisible(1), 'clear of the wall').toBe(true);
  });

  it('needs a sustained look before it counts as gazed at', () => {
    const camera = cameraAt(0, 0);
    const tracker = new VisibilityTracker(
      camera,
      [{ position: new THREE.Vector3(0, 1.6, -4), radius: 0.4 }],
      { gazeSeconds: 0.3, memorySeconds: 2 },
    );
    tracker.update(0.2);
    expect(tracker.wasGazedRecently(0)).toBe(false);
    tracker.update(0.2);
    expect(tracker.wasGazedRecently(0)).toBe(true);
  });

  /** 注視した直後の個体は、視界から外れても触らない（記憶と食い違うため） */
  it('keeps a gazed target off limits until the memory lapses', () => {
    const camera = cameraAt(0, 0);
    const target = { position: new THREE.Vector3(0, 1.6, -4), radius: 0.4 };
    const tracker = new VisibilityTracker(camera, [target], {
      gazeSeconds: 0.3,
      memorySeconds: 2,
    });
    tracker.update(0.4);
    expect(tracker.wasGazedRecently(0)).toBe(true);

    // 振り返る（対象は背後へ）
    camera.rotation.set(0, Math.PI, 0);
    camera.updateMatrixWorld(true);
    tracker.update(0.5);
    expect(tracker.isVisible(0)).toBe(false);
    expect(tracker.isUnobserved(0)).toBe(false);

    // 記憶が切れたら触ってよい
    for (let i = 0; i < 4; i++) tracker.update(0.5);
    expect(tracker.isUnobserved(0)).toBe(true);
  });

  it('reports how long ago a target was last visible', () => {
    const camera = cameraAt(0, 0);
    const tracker = new VisibilityTracker(camera, [
      { position: new THREE.Vector3(0, 1.6, -4), radius: 0.4 },
    ]);
    tracker.update(0.1);
    expect(tracker.secondsSinceVisible(0)).toBe(0);
    camera.rotation.set(0, Math.PI, 0);
    camera.updateMatrixWorld(true);
    tracker.update(0.5);
    expect(tracker.secondsSinceVisible(0)).toBeCloseTo(0.5, 5);
  });
});

describe('Behind You cloister', () => {
  /**
   * 回廊の中庭は遮蔽物として本質的である。
   * 外周を歩く来館者から見て、反対側の彫像が中庭に隠れること。
   */
  it('hides the far side of the ring behind the courtyard', () => {
    const { count, ringRadius, coreRadius } = BEHIND_YOU_LAYOUT;
    const viewer = { x: 0, z: ringRadius + 1.4 };
    let hidden = 0;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const statue = { x: Math.sin(angle) * ringRadius, z: Math.cos(angle) * ringRadius };
      // 視線と中庭の中心との距離
      const dx = statue.x - viewer.x;
      const dz = statue.z - viewer.z;
      const length = Math.hypot(dx, dz);
      const distance = Math.abs(viewer.x * dz - viewer.z * dx) / length;
      // 中庭より向こう側にある場合だけ遮蔽になる
      const behind = -(viewer.x * dx + viewer.z * dz) / length > 0;
      if (distance < coreRadius && behind) hidden++;
    }
    expect(hidden).toBeGreaterThanOrEqual(3);
  });

  it('keeps the whole ring inside the walk-in zone', () => {
    const { ringRadius, zoneHalf } = BEHIND_YOU_LAYOUT;
    expect(zoneHalf).toBeGreaterThan(ringRadius + 1.0);
  });
});
