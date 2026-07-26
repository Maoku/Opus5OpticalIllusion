import './ui/styles.css';
import * as THREE from 'three';
import { App } from './core/App';
import { AudioBus } from './core/AudioBus';
import { InputManager } from './core/input/InputManager';
import { Settings } from './core/Settings';
import { SPAWN } from './data/layout';
import { ExhibitManager, type ExhibitRecord } from './exhibits/ExhibitManager';
import { EXHIBITS } from './exhibits/registry';
import type { HintContent } from './exhibits/types';
import { I18n, resolveInitialLocale, type Dictionary, type Locale } from './i18n';
import { PlayerController } from './player/PlayerController';
import { ExhibitList } from './ui/ExhibitList';
import { focusScene, setSceneElement } from './ui/focus';
import { HintPanel } from './ui/HintPanel';
import { Hud, type KeyHint } from './ui/Hud';
import { LanguageSwitch } from './ui/LanguageSwitch';
import { LoadingScreen } from './ui/LoadingScreen';
import { OrientationGate } from './ui/OrientationGate';
import { SettingsMenu, type ControlsHelp } from './ui/SettingsMenu';
import { TouchActionBar, type TouchActionSpec } from './ui/TouchActionBar';
import { ViewpointController } from './viewpoint/ViewpointController';
import { Museum } from './world/Museum';
import { Signage } from './world/Signage';

const canvasNode = document.querySelector<HTMLCanvasElement>('#scene');
const overlayNode = document.querySelector<HTMLElement>('#overlay');
if (!canvasNode || !overlayNode) throw new Error('required DOM nodes are missing');
const canvas: HTMLCanvasElement = canvasNode;
const overlay: HTMLElement = overlayNode;

// UI を閉じたときの戻し先。canvas は既定でフォーカスを受けないので登録時に
// tabindex="-1" が付く（§9a）。
setSceneElement(canvas);

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
const audio = new AudioBus();
const exhibits = new ExhibitManager(
  app,
  museum.lighting,
  player,
  viewpoint,
  museum.collision,
  audio,
);

// ----------------------------------------------------------------- overlays

// §12a: 3D 空間に残る文字は扉上の部屋名だけ。説明文は全て UI へ移した
const signage = new Signage(app.scene, i18n.t);

/**
 * ヴィネット。DOM の重ね合わせなので描画コストはゼロ。
 * ViewSpot にロック中、または明度・色が成立条件の展示を見ている間は外す。
 * 隅を暗くする処理は、明度の比較を要求する展示（チェッカーシャドウ・D6・
 * ホロウマスク）の判定を汚しうるため（§8 リスク表）。
 */
const vignette = document.createElement('div');
vignette.className = 'vignette';
overlay.appendChild(vignette);

const loading = new LoadingScreen(overlay);
app.assets.events.on('progress', ({ ratio }) => loading.setProgress(ratio * 0.9));

const hud = new Hud(overlay);
const hintPanel = new HintPanel(overlay, i18n.t, {
  onRevealChange(revealed) {
    const focused = exhibits.focused;
    if (focused) exhibits.setRevealed(focused.definition.id, revealed);
  },
  onStageChange(stage) {
    if (stage !== 'hidden') audio.ui(stage === 'explanation' ? 1040 : 880, 0.09);
  },
});
const touchBar = new TouchActionBar(overlay, (action) => input.dispatch(action));
touchBar.setEnabled(app.device.isTouch);
const exhibitList = new ExhibitList(overlay, i18n.t, {
  onSelect: (record) => warpTo(record),
  titleOf: (record) => contentFor(record).title,
});
const languageSwitch = new LanguageSwitch((locale) => void i18n.setLocale(locale));
const settingsMenu = new SettingsMenu(overlay, settings, i18n.t.settings, languageSwitch.el);
// タイトル画面の言語切替（§5.6）。同じ DOM は二か所に置けないので実体を別に持つ。
// 設定メニューは入場後しか開けないため、最初の画面でも選べるようにする。
const titleLanguageSwitch = new LanguageSwitch((locale) => void i18n.setLocale(locale));
loading.setLanguageControl(titleLanguageSwitch.el);
const orientationGate = new OrientationGate(overlay, i18n.t);
orientationGate.setEnabled(app.device.isMobileLike);

// --------------------------------------------------------------------- i18n

/**
 * 注視中の展示名。HUD に小さく出す唯一の在庫（§12a）。
 *
 * i18n.subscribe() は購読と同時に一度呼ばれるので、宣言はその前に置くこと。
 * 後ろに置くと TDZ で起動そのものが落ちる。
 */
let focusedTitle: string | null = null;

function contentFor(record: ExhibitRecord): HintContent {
  const entry = i18n.t.exhibits[record.definition.textKey];
  const key = record.definition.noticeTextKey;
  return key ? { ...entry, notice: i18n.t.ui[key] } : entry;
}

i18n.subscribe((t: Dictionary, locale: Locale) => {
  hud.setDictionary(t);
  hintPanel.setDictionary(t);
  exhibitList.setDictionary(t);
  settingsMenu.setLabels(t.settings);
  orientationGate.setDictionary(t);
  languageSwitch.setLocale(locale);
  titleLanguageSwitch.setLocale(locale);
  titleLanguageSwitch.setLabel(t.settings.language);
  settingsMenu.setControlsHelp(controlsHelp(t));
  input.touch?.pad.setLabels(t.ui.padMoveLabel, t.ui.padLookLabel);
  hud.setRoomName(museum.currentArea ? t.rooms[museum.currentArea.room] : null);
  // ワールド内の 3D テキストを作り直す（§5.4）
  signage.setDictionary(t);
  loading.setIntro(t.ui.entranceTitle, t.ui.entranceBody);
  // 入場ボタンが出た後に切り替えられても文言を残さない
  loading.setEnterLabel(t.meta.enter);
  exhibits.setLocaleContent(contentFor);
  const focused = exhibits.focused;
  focusedTitle = focused ? contentFor(focused).title : null;
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
  exhibits.flags.shrinkingRoom = s.shrinkingRoom && !reducedMotion;
  exhibits.flags.mobile = app.device.isMobileLike;
  audio.muted = s.muted;
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

museum.onAreaChange((area) => {
  hud.setRoomName(area ? i18n.t.rooms[area.room] : null);
  // 明順応の落差を予告する（§12c-3）。アルコーブだけ極端に暗い
  if (area?.id === 'roomDAlcove') hud.showToast(i18n.t.ui.darkRoomAhead, 4500);
});
exhibits.events.on('focusChanged', (record) => {
  const content = record ? contentFor(record) : null;
  focusedTitle = content?.title ?? null;
  hintPanel.setContent(content, record?.definition.id ?? null);
});
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

/**
 * UI を開いた瞬間にカーソルを返す（§9b-2/3）。
 *
 * 閉じても自動では再ロックしない。ユーザーがキャンバスをクリックしたときだけ
 * 視点操作へ戻る。勝手に奪い返すと「カーソルが消える理由が分からない」に戻る。
 */
let uiWasOpen = false;
function syncPointerLock(uiOpen: boolean): void {
  if (uiOpen && !uiWasOpen) input.releasePointer();
  uiWasOpen = uiOpen;
}

function frame(dt: number, elapsed: number): void {
  input.suspended = anyModalOpen();
  const uiOpen = anyModalOpen() || hintPanel.isOpen;
  syncPointerLock(uiOpen);
  const state = input.poll(dt);

  // ポインタロックが外れた直後の cancel は捨てる。Chrome の Esc は
  // ロック解除に消費されるが、届く環境では「解除 ＋ ヒントを閉じる」の
  // 二重動作になる（§9b-4）。あわせて戻り方を告知する。
  const justUnlocked = input.consumePointerRelease();
  if (justUnlocked && !uiOpen && input.activeSource === 'keyboardMouse') {
    hud.showToast(i18n.t.controls.clickToLook, 3200);
  }

  // --- モーダル ---------------------------------------------------------
  if (state.pressed.has('settings')) settingsMenu.toggle();
  if (state.pressed.has('list')) exhibitList.toggle(exhibits.list);
  if (state.pressed.has('cancel') && !justUnlocked) {
    if (settingsMenu.isOpen) settingsMenu.close();
    else if (exhibitList.isOpen) exhibitList.close();
    else if (hintPanel.isOpen) hintPanel.close();
    else if (viewpoint.isEngaged) viewpoint.exit();
  }

  player.update(dt, state);

  // --- ViewSpot ---------------------------------------------------------
  // 決定は「ViewSpot へ入る」が最優先。入らなかったぶんだけ仕掛けへ回す。
  const wantsInteract = !anyModalOpen() && state.pressed.has('interact');
  const spotToEnter = wantsInteract && !viewpoint.isEngaged ? viewpoint.candidate : null;
  if (spotToEnter) {
    viewpoint.enter(spotToEnter);
    app.device.vibrate(15);
    audio.ui(660);
  }
  viewpoint.update(dt, state);
  exhibits.update(dt, elapsed);

  // --- ワールド内の仕掛け（D4 の音声ボタンなど）---------------------------
  // ロック中も押せること。ロック位置は ViewSpot の反応半径の中なので
  // candidate は残り続ける。それを弾く条件にすると台上のボタンへ永久に
  // 届かない（プロンプトだけ出て何も起きない）。
  if (wantsInteract && !spotToEnter) {
    exhibits.interact(exhibits.focused ?? exhibits.pickAt(state));
  }

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
  hud.setPrompt(promptFor(t, focused));
  hud.setKeyHints(keyHintsFor(t, uiOpen, hintAvailable));
  // 展示名だけを小さく出す。全文はヒントを開くと読める（§12a）
  hud.setExhibitName(uiOpen ? null : focusedTitle);
  if (app.device.isTouch) {
    // ヒントを開いている間は文脈ボタンを引っ込める。パネルの上に重なると
    // 解説が読めなくなる（横持ちスマホは高さが 375px しかない）
    touchBar.setEnabled(!anyModalOpen() && !hintPanel.isOpen);
    touchBar.setActions(buildTouchActions(t, hintAvailable, focused));
  }
  orientationGate.setPortrait(app.device.viewport.portrait);

  // --- 演出 -------------------------------------------------------------
  const brightnessSensitive =
    viewpoint.isEngaged || focused?.definition.brightnessCritical === true;
  vignette.classList.toggle('is-off', brightnessSensitive);
  updateFootsteps();
  keepFocusOnScene();
}

/**
 * 保険（§9a-4）。何も開いていないのにオーバーレイ上のコントロールへ
 * フォーカスが残っていると、Space / Enter がそちらへ吸われる。操作面へ戻す。
 */
function keepFocusOnScene(): void {
  if (anyModalOpen() || hintPanel.isOpen) return;
  const active = document.activeElement;
  if (!active || active === document.body || !overlay.contains(active)) return;
  if (active.closest('[role="dialog"]')) return;
  focusScene();
}

/** 歩いた距離に応じて足音を鳴らす。歩幅は目線の高さに連動する（D2） */
let footstepDistance = 0;
const lastFootstepAt = new THREE.Vector3();
function updateFootsteps(): void {
  const stride = 0.78 * player.moveSpeedScale;
  footstepDistance += player.position.distanceTo(lastFootstepAt);
  lastFootstepAt.copy(player.position);
  if (footstepDistance < stride) return;
  footstepDistance = 0;
  audio.footstep();
}
app.add({ update: frame });

/**
 * 決定キーで今なにが起きるか。ViewSpot への進入が最優先。
 *
 * タッチのときは同じ内容が文脈ボタンに出るので、中央のプロンプトは出さない
 * （§4.1: active source を見て「[F] …」かボタンかを出し分ける）。
 */
function promptFor(t: Dictionary, focused: ExhibitRecord | null): string | null {
  if (anyModalOpen() || input.activeSource === 'touch') return null;
  if (!viewpoint.isEngaged && viewpoint.candidate) return t.ui.standHere;
  const key = focused?.definition.interactTextKey;
  return key ? t.ui[key] : null;
}

/**
 * 画面下端の常設キーガイド（§9b-1）。
 *
 * ポインタロック中はカーソルが消え、UI がキーで操作できることが伝わらない。
 * 状況に応じて出し分ける。タッチが active のときは Hud 側で伏せられる。
 */
function keyHintsFor(t: Dictionary, uiOpen: boolean, hintAvailable: boolean): KeyHint[] {
  if (uiOpen) return [{ key: 'Esc', label: t.controls.close }];
  if (viewpoint.isEngaged) {
    const hints: KeyHint[] = [];
    if (hintAvailable) hints.push({ key: 'H', label: t.controls.hint });
    if (hintPanel.stage === 'appearance') hints.push({ key: 'R', label: t.controls.reveal });
    hints.push({ key: 'Esc', label: t.controls.leaveView });
    return hints;
  }
  const hints: KeyHint[] = [];
  if (hintAvailable) hints.push({ key: 'H', label: t.controls.hint });
  hints.push({ key: 'Tab', label: t.controls.list }, { key: 'O', label: t.controls.settings });
  if (input.pointerLocked) hints.push({ key: 'Esc', label: t.controls.cursor });
  return hints;
}

/** 設定メニューの「操作方法」。撤去する案内板の受け皿（§9b-5 / §12a） */
function controlsHelp(t: Dictionary): ControlsHelp {
  const c = t.controls;
  const rows: Array<[string, string]> = app.device.isTouch
    ? [
        [c.move, c.touchMove],
        [c.look, c.touchLook],
        [c.interact, c.actionKeys],
      ]
    : [
        [c.move, c.moveKeys],
        [c.look, c.lookKeys],
        [c.interact, c.actionKeys],
      ];
  return { heading: c.heading, rows };
}

/** 文脈ボタン。ヒントボタンは HintPanel が右下に常設するのでここには積まない。 */
function buildTouchActions(
  t: Dictionary,
  hintAvailable: boolean,
  focused: ExhibitRecord | null,
): TouchActionSpec[] {
  const actions: TouchActionSpec[] = [];
  if (!viewpoint.isEngaged && viewpoint.candidate) {
    actions.push({ action: 'interact', label: t.ui.standHere, primary: true });
  } else if (focused?.definition.interactTextKey) {
    actions.push({ action: 'interact', label: t.ui[focused.definition.interactTextKey] });
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
    audio,
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
  // 板は load() で生まれるので、辞書の配信をもう一度回して文字を焼く
  exhibits.setLocaleContent(contentFor);
  loading.setProgress(1);
  await loading.ready(i18n.t.meta.enter);
  // 入場を全画面化の成否に待たせない。§4.3 の方針どおり「試すだけ」にして、
  // 結果を待たずに始める（await すると非対応環境で入場ボタンが効かなくなる）
  loading.hide();
  app.start();
  // 入場クリックはユーザー操作。ここで autoplay ポリシーを解禁しておく（§4.3 / D4）
  void audio.resume().then((ok) => {
    if (ok) audio.startAmbience();
  });
  void app.device.tryImmersive(document.documentElement);
}

void boot();
