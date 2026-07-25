import './ui/styles.css';
import * as THREE from 'three';
import { App } from './core/App';
import { LoadingScreen } from './ui/LoadingScreen';
import { Museum } from './world/Museum';
import { SPAWN } from './data/layout';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const overlay = document.querySelector<HTMLElement>('#overlay');
if (!canvas || !overlay) throw new Error('required DOM nodes are missing');

const app = new App({ canvas, overlayRoot: overlay });
const loading = new LoadingScreen(overlay);
app.assets.events.on('progress', ({ ratio }) => loading.setProgress(ratio * 0.9));

const museum = new Museum(app);
app.add(museum);

app.camera.position.set(SPAWN.x, 1.6, SPAWN.z);
app.camera.rotation.order = 'YXZ';
app.camera.rotation.y = SPAWN.yaw;

// --- Phase 2 検証用のフライカメラ（Phase 3 の PlayerController で置き換える） ---
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  app.camera.rotation.y -= e.movementX * 0.0025;
  app.camera.rotation.x = THREE.MathUtils.clamp(
    app.camera.rotation.x - e.movementY * 0.0025,
    -1.4,
    1.4,
  );
});

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
app.add({
  update(dt) {
    const speed = keys.has('ShiftLeft') ? 12 : 4.5;
    app.camera.getWorldDirection(forward);
    right.crossVectors(forward, app.camera.up).normalize();
    const move = new THREE.Vector3();
    if (keys.has('KeyW')) move.add(forward);
    if (keys.has('KeyS')) move.sub(forward);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    if (keys.has('KeyE')) move.y += 1;
    if (keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq() > 0) app.camera.position.addScaledVector(move.normalize(), speed * dt);
  },
});
// ---------------------------------------------------------------------------

// dev ビルドのみ: QA 用に主要オブジェクトを公開する（視点を飛ばして目視確認する）
if (import.meta.env.DEV) {
  (globalThis as unknown as Record<string, unknown>).__museum = { app, museum, THREE };
}

async function boot(): Promise<void> {
  loading.setProgress(1);
  await loading.ready('Enter');
  await app.device.tryImmersive(document.documentElement);
  loading.hide();
  app.start();
}

void boot();
