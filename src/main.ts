import './ui/styles.css';
import * as THREE from 'three';
import { App } from './core/App';
import { LoadingScreen } from './ui/LoadingScreen';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const overlay = document.querySelector<HTMLElement>('#overlay');
if (!canvas || !overlay) throw new Error('required DOM nodes are missing');

const app = new App({ canvas, overlayRoot: overlay });
const loading = new LoadingScreen(overlay);
app.assets.events.on('progress', ({ ratio }) => loading.setProgress(ratio * 0.9));

// --- Phase 1 の検証用シーン（Phase 2 の Museum で置き換える） -------------
const scene = app.scene;
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30281f, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 6, 4);
scene.add(key);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x9fb6d1, roughness: 0.5, metalness: 0.05 }),
);
cube.position.set(0, 1.6, 0);
scene.add(cube);

app.add({
  update(dt) {
    cube.rotation.x += dt * 0.6;
    cube.rotation.y += dt * 0.9;
  },
});
// -------------------------------------------------------------------------

async function boot(): Promise<void> {
  // 実アセットが増えるまでは即完了。進捗表示の導線だけ通しておく。
  loading.setProgress(1);
  await loading.ready('Enter');
  await app.device.tryImmersive(document.documentElement);
  loading.hide();
  app.start();
}

void boot();
