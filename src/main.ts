import './ui/styles.css';
import * as THREE from 'three';
import { App } from './core/App';
import { InputManager } from './core/input/InputManager';
import { Settings } from './core/Settings';
import { PlayerController } from './player/PlayerController';
import { LoadingScreen } from './ui/LoadingScreen';
import { SettingsMenu, type SettingsLabels } from './ui/SettingsMenu';
import { Museum } from './world/Museum';
import { ViewpointController } from './viewpoint/ViewpointController';
import { ExhibitManager } from './exhibits/ExhibitManager';
import { EXHIBITS } from './exhibits/registry';
import { SPAWN } from './data/layout';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const overlay = document.querySelector<HTMLElement>('#overlay');
if (!canvas || !overlay) throw new Error('required DOM nodes are missing');

const app = new App({ canvas, overlayRoot: overlay });
const loading = new LoadingScreen(overlay);
app.assets.events.on('progress', ({ ratio }) => loading.setProgress(ratio * 0.9));

const museum = new Museum(app);
app.add(museum);

const settings = new Settings({ headBob: false });
const input = new InputManager({
  element: canvas,
  overlay,
  enableTouch: app.device.isTouch,
});
const player = new PlayerController(app.camera, museum.collision);
player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
museum.track(app.camera);

// Phase 5 で i18n 辞書に差し替える暫定ラベル
const PLACEHOLDER_LABELS: SettingsLabels = {
  title: 'Settings',
  fov: 'Field of view',
  mouseSensitivity: 'Mouse sensitivity',
  touchSensitivity: 'Touch sensitivity',
  invertY: 'Invert vertical look',
  headBob: 'Head bob',
  quality: 'Quality',
  qualityAuto: 'Auto',
  qualityLow: 'Low',
  qualityMid: 'Mid',
  qualityHigh: 'High',
  reducedMotion: 'Reduce motion',
  shrinkingRoom: 'Shrinking Room effect',
  muted: 'Mute',
  close: 'Close',
  language: 'Language',
};
const settingsMenu = new SettingsMenu(overlay, settings, PLACEHOLDER_LABELS);

const viewpoint = new ViewpointController(app, player);
const exhibits = new ExhibitManager(app, museum.lighting, player, viewpoint);

function applySettings(): void {
  const s = settings.value;
  input.setSettings({
    mouseSensitivity: s.mouseSensitivity,
    touchSensitivityDegPerPx: s.touchSensitivityDegPerPx,
    invertY: s.invertY,
  });
  player.tuning = { ...player.tuning, headBob: s.headBob };
  const reducedMotion = s.reducedMotion || app.device.prefersReducedMotion;
  viewpoint.reducedMotion = reducedMotion;
  exhibits.reducedMotion = reducedMotion;
  if (app.camera.fov !== s.fov) {
    app.camera.fov = s.fov;
    app.camera.updateProjectionMatrix();
  }
  if (s.quality === 'auto') {
    app.quality.autoDegrade = true;
  } else {
    app.quality.autoDegrade = false;
    app.quality.setLevel(s.quality);
  }
}
settings.events.on('changed', applySettings);
applySettings();

app.add({
  update(dt, elapsed) {
    const state = input.poll(dt);
    // 設定メニューが開いている間は歩かない。閉じる操作だけ通す。
    input.suspended = settingsMenu.isOpen;
    if (state.pressed.has('settings')) settingsMenu.toggle();
    if (state.pressed.has('cancel') && settingsMenu.isOpen) settingsMenu.close();

    player.update(dt, state);

    // ViewSpot への進入・解除。入力デバイスは問わない（§4.1）
    if (state.pressed.has('interact') && !viewpoint.isEngaged && viewpoint.candidate) {
      viewpoint.enter(viewpoint.candidate);
      app.device.vibrate(15);
    }
    if (state.pressed.has('cancel') && viewpoint.isEngaged) viewpoint.exit();
    viewpoint.update(dt, state);
    exhibits.update(dt, elapsed);
  },
});

if (import.meta.env.DEV) {
  (globalThis as unknown as Record<string, unknown>).__museum = {
    app,
    museum,
    player,
    input,
    settings,
    viewpoint,
    exhibits,
    THREE,
  };
}

async function boot(): Promise<void> {
  await exhibits.load(EXHIBITS);
  loading.setProgress(1);
  await loading.ready('Enter');
  await app.device.tryImmersive(document.documentElement);
  loading.hide();
  app.start();
}

void boot();
