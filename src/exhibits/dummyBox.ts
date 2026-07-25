import * as THREE from 'three';
import type { BuildContext, ExhibitInstance } from './types';

/**
 * Phase 4 の通し確認用のダミー展示。
 * ViewSpot に立つ → スナップ → 固定 → 解除、および reveal の往復を検証する。
 * Phase 6a で本物の展示に置き換える。
 */
export function buildDummyBox(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();

  const pedestal = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.85 }),
  );
  pedestal.position.y = 0.45;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;

  const material = new THREE.MeshStandardMaterial({ color: 0xcc8844, roughness: 0.55 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), material);
  box.position.y = 1.2;
  box.castShadow = true;
  box.receiveShadow = true;

  root.add(pedestal, box);

  const eye = ctx.eyes[0];
  const removeSpot = ctx.lighting.addSpot({
    position: new THREE.Vector3(
      ctx.definition.position.x,
      3.4,
      ctx.definition.position.z + 1.2,
    ),
    target: new THREE.Vector3(
      ctx.definition.position.x,
      1.2,
      ctx.definition.position.z,
    ),
    color: 0xfff4e2,
    intensity: 26,
    angle: Math.PI / 7,
    penumbra: 0.5,
    distance: 12,
    shadow: true,
  });

  let spin = 0;
  return {
    root,
    update(dt) {
      spin += dt * 0.4;
      box.rotation.y = spin;
    },
    setRevealed(revealed, progress) {
      // タネあかし: 箱が浮いて色が変わる（本物の展示では reveal 種別ごとの演出になる）
      box.position.y = 1.2 + progress * 0.5;
      material.color.setHex(revealed ? 0x6fd2b0 : 0xcc8844);
      material.emissive.setHex(0x6fd2b0);
      material.emissiveIntensity = progress * 0.5;
      if (eye) box.lookAt(eye);
    },
    dispose() {
      removeSpot();
      pedestal.geometry.dispose();
      (pedestal.material as THREE.Material).dispose();
      box.geometry.dispose();
      material.dispose();
    },
  };
}
