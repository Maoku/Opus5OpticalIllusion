import './ui/styles.css';
import * as THREE from 'three';
import { App } from './core/App';
import { InputManager } from './core/input/InputManager';
import { Settings } from './core/Settings';
import { SPAWN } from './data/layout';
import { ExhibitManager, type ExhibitRecord } from './exhibits/ExhibitManager';
import { EXHIBITS } from './exhibits/registry';
import type { HintContent } from './exhibits/types';
import { I18n, resolveInitialLocale, type Dictionary, type Locale } from './i18n';
import { PlayerController } from './player/PlayerController';
import { ExhibitList } from './ui/ExhibitList';
import { HintPanel } from './ui/HintPanel';
import { Hud } from './ui/Hud';
import { LanguageSwitch } from './ui/LanguageSwitch';
import { LoadingScreen } from './ui/LoadingScreen';
import { OrientationGate } from './ui/OrientationGate';
import { SettingsMenu } from './ui/SettingsMenu';
import { TouchActionBar, type TouchActionSpec } from './ui/TouchActionBar';
import { ViewpointController } from './viewpoint/ViewpointController';
import { Museum } from './world/Museum';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const overlay = document.querySelector<HTMLElement>('#overlay');
if (!canvas || !overlay) throw new Error('required DOM nodes are missing');

// ------------------------------------------------------------------ systems

const app = new App({ canvas, overlayRoot: overlay });
const museum = new Museum(app);
app.add(museum);

const settings = new Settings();
const i18n = new I18n();
const input = new InputManager({ element: canvas, overlay, enableTouch: app.device.isTouch });
const player = new PlayerController(app.camera, museum.collision);
player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
museum.track(app.camera);

const viewpoint = new ViewpointController(app, player);
const exhibits = new ExhibitManager(app, museum.lighting, player, viewpoint);

// ----------------------------------------------------------------- overlays

const loading = new LoadingScreen(overlay);
app.assets.events.on('progress', ({ ratio }) => loading.setProgress(ratio * 0.9));

const hud = new Hud(overlay);
const hintPanel = new HintPanel(overlay, i18n.t, {
  onRevealChange(revealed) {
    const focused = exhibits.focused;
    if (focused) exhibits.setRevealed(focused.definition.id, revealed);
  },
});
const touchBar = new TouchActionBar(overlay, (action) => input.dispatch(action));
touchBar.setEnabled(app.device.isTouch);
const exhibitList = new ExhibitList(overlay, i18n.t, {
  onSelect: (record) => warpTo(record),
  isAvailable: (record) => record.definition.room !== 'opus' || museum.opusUnlocked,
  titleOf: (record) => contentFor(record).title,
});
const languageSwitch = new LanguageSwitch((locale) => void i18n.setLocale(locale));
const settingsMenu = new SettingsMenu(overlay, settings, i18n.t.settings, languageSwitch.el);
const orientationGate = new OrientationGate(overlay, i18n.t);
orientationGate.setEnabled(app.device.isMobileLike);

// --------------------------------------------------------------------- i18n

function contentFor(record: ExhibitRecord): HintContent {
  return i18n.t.exhibits[record.definition.textKey];
}

i18n.subscribe((t: Dictionary, locale: Locale) => {
  hud.setDictionary(t);
  hintPanel.setDictionary(t);
  exhibitList.setDictionary(t);
  settingsMenu.setLabels(t.settings);
  orientationGate.setDictionary(t);
  languageSwitch.setLocale(locale);
  hud.setRoomName(museum.currentArea ? t.rooms[museum.currentArea.room] : null);
  // ワールド内の 3D テキストを作り直す（§5.4）
  exhibits.setLocaleContent(contentFor);
  const focused = exhibits.focused;
  hintPanel.setContent(focused ? contentFor(focused) : null, focused?.definition.id ?? null);
});

// ----------------------------------------------------------------- settings

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
  if (app.camera.fov !== s.fov && !viewpoint.isEngaged) {
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

// ------------------------------------------------------------------- wiring

museum.onAreaChange((area) => hud.setRoomName(area ? i18n.t.rooms[area.room] : null));
exhibits.events.on('focusChanged', (record) =>
  hintPanel.setContent(record ? contentFor(record) : null, record?.definition.id ?? null),
);
input.events.on('activeSourceChanged', (source) => hud.setActiveSource(source));
hud.setActiveSource(input.activeSource);

/** 展示一覧からのワープ（§8c: 歩行不要で全展示に到達できる導線） */
function warpTo(record: ExhibitRecord): void {
  // ワープ前に身体改変を必ず巻き戻す（ROOM_D §2.3 のワープ経路）
  player.releaseAllOverrides();
  if (viewpoint.isEngaged) viewpoint.exit();
  if (record.spots.length > 0) {
    viewpoint.focusExhibit(record.definition.id, 0);
    return;
  }
  const p = record.definition.position;
  player.warpTo(p.x, p.z + 3, Math.PI);
}

function anyModalOpen(): boolean {
  return settingsMenu.isOpen || exhibitList.isOpen;
}

function frame(dt: number, elapsed: number): void {
  input.suspended = anyModalOpen();
  const state = input.poll(dt);

  // --- モーダル ---------------------------------------------------------
  if (state.pressed.has('settings')) settingsMenu.toggle();
  if (state.pressed.has('list')) exhibitList.toggle(exhibits.list);
  if (state.pressed.has('cancel')) {
    if (settingsMenu.isOpen) settingsMenu.close();
    else if (exhibitList.isOpen) exhibitList.close();
    else if (hintPanel.isOpen) hintPanel.close();
    else if (viewpoint.isEngaged) viewpoint.exit();
  }

  player.update(dt, state);

  // --- ViewSpot ---------------------------------------------------------
  if (
    !anyModalOpen() &&
    state.pressed.has('interact') &&
    !viewpoint.isEngaged &&
    viewpoint.candidate
  ) {
    viewpoint.enter(viewpoint.candidate);
    app.device.vibrate(15);
  }
  viewpoint.update(dt, state);
  exhibits.update(dt, elapsed);

  // --- ヒント -----------------------------------------------------------
  // ボタンが出るのは「ViewSpot にロック中」か「展示のそばにいる」ときだけ
  const focused = exhibits.focused;
  const hintAvailable =
    !anyModalOpen() && !!focused && (viewpoint.current !== null || focused.distance < 6);
  hintPanel.setAvailable(hintAvailable);
  if (state.pressed.has('hint')) hintPanel.toggle();
  if (state.pressed.has('reveal') && hintPanel.stage === 'appearance') hintPanel.advance();

  // --- HUD / タッチ UI --------------------------------------------------
  const t = i18n.t;
  hud.setPrompt(
    !anyModalOpen() && !viewpoint.isEngaged && viewpoint.candidate ? t.ui.standHere : null,
  );
  if (app.device.isTouch) {
    touchBar.setEnabled(!anyModalOpen());
    touchBar.setActions(buildTouchActions(t, hintAvailable));
  }
  orientationGate.setPortrait(app.device.viewport.portrait);
}
app.add({ update: frame });

/** 文脈ボタン。ヒントボタンは HintPanel が右下に常設するのでここには積まない。 */
function buildTouchActions(t: Dictionary, hintAvailable: boolean): TouchActionSpec[] {
  const actions: TouchActionSpec[] = [];
  if (!viewpoint.isEngaged && viewpoint.candidate) {
    actions.push({ action: 'interact', label: t.ui.standHere, primary: true });
  }
  if (viewpoint.isEngaged) {
    actions.push({ action: 'cancel', label: t.ui.leaveView });
  }
  if (!hintAvailable) {
    actions.push({ action: 'list', label: t.ui.list });
  }
  return actions;
}

if (import.meta.env.DEV) {
  (globalThis as unknown as Record<string, unknown>).__museum = {
    app,
    museum,
    player,
    input,
    settings,
    viewpoint,
    exhibits,
    i18n,
    hintPanel,
    exhibitList,
    THREE,
    // rAF が絞られる環境で手動送りするための QA 用フック
    step: (frames = 1) => {
      for (let i = 0; i < frames; i++) {
        const dt = 1 / 60;
        museum.update(dt);
        frame(dt, i * dt);
      }
    },
  };
}

// --------------------------------------------------------------------- boot

async function boot(): Promise<void> {
  await i18n.setLocale(resolveInitialLocale());
  await exhibits.load(EXHIBITS);
  loading.setProgress(1);
  await loading.ready(i18n.t.meta.enter);
  // 入場を全画面化の成否に待たせない。§4.3 の方針どおり「試すだけ」にして、
  // 結果を待たずに始める（await すると非対応環境で入場ボタンが効かなくなる）
  loading.hide();
  app.start();
  void app.device.tryImmersive(document.documentElement);
}

void boot();
