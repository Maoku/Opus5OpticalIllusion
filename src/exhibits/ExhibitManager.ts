import * as THREE from 'three';
import type { Updatable } from '../core/App';
import type { SceneHost } from '../core/SceneHost';
import { EventBus } from '../core/EventBus';
import type { InputState } from '../core/input/types';
import type { PlayerController, PlayerOverrideHandle } from '../player/PlayerController';
import { ViewSpot } from '../viewpoint/ViewSpot';
import { poseLookingAt, type ViewpointController } from '../viewpoint/ViewpointController';
import type { Lighting } from '../world/Lighting';
import type { Collision } from '../world/Collision';
import type { AudioBus } from '../core/AudioBus';
import { saturate } from '../utils/math';
import { createTextPlate, type TextPlate } from '../world/TextPlate';
import type {
  ExhibitDefinition,
  ExhibitFlags,
  ExhibitId,
  ExhibitInstance,
  HintContent,
} from './types';

/** これより遠い展示は描画も update も止める（§Phase 4: LOD/カリング） */
export const CULL_DISTANCE = 20;
/** reveal 演出の進行時間 */
const REVEAL_DURATION = 1.1;

export interface ExhibitRecord {
  definition: ExhibitDefinition;
  instance: ExhibitInstance;
  spots: ViewSpot[];
  /** 展示名とキャプションを刻んだワールド内の板 */
  plate: TextPlate | null;
  override: PlayerOverrideHandle;
  distance: number;
  visible: boolean;
  inZone: boolean;
  revealed: boolean;
  revealProgress: number;
}

export interface ExhibitEvents extends Record<string, unknown> {
  /** 注視・接近している展示。null は「どの展示にも向き合っていない」 */
  focusChanged: ExhibitRecord | null;
  zoneEntered: ExhibitRecord;
  zoneExited: ExhibitRecord;
  revealChanged: { record: ExhibitRecord; revealed: boolean };
}

/**
 * 展示の生成・更新・破棄・フォーカス管理。
 *
 * ゾーン型展示（ROOM_D §2.2）の退出時と dispose 時に playerOverride を必ず
 * 巻き戻す責任を負う。ここが漏れると他の全展示の錯視が壊れる。
 */
export class ExhibitManager implements Updatable {
  readonly events = new EventBus<ExhibitEvents>();
  readonly records = new Map<ExhibitId, ExhibitRecord>();

  readonly #group = new THREE.Group();
  readonly #raycaster = new THREE.Raycaster();
  readonly #ndc = new THREE.Vector2();
  readonly #plateposts: THREE.Mesh[] = [];
  #focused: ExhibitRecord | null = null;

  /** 展示が参照を持ち続ける。値の差し替えではなく中身の書き換えで伝える */
  readonly flags: ExhibitFlags = { reducedMotion: false, shrinkingRoom: true, mobile: false };

  constructor(
    private readonly app: SceneHost,
    private readonly lighting: Lighting,
    private readonly player: PlayerController,
    private readonly viewpoint: ViewpointController,
    private readonly collision: Collision,
    private readonly audio: AudioBus,
  ) {
    this.#group.name = 'exhibits';
    app.scene.add(this.#group);
  }

  set reducedMotion(v: boolean) {
    this.flags.reducedMotion = v;
  }

  get reducedMotion(): boolean {
    return this.flags.reducedMotion;
  }

  get focused(): ExhibitRecord | null {
    return this.#focused;
  }

  get list(): ExhibitRecord[] {
    return [...this.records.values()].sort(
      (a, b) => (a.definition.order ?? 0) - (b.definition.order ?? 0),
    );
  }

  async load(definitions: readonly ExhibitDefinition[]): Promise<void> {
    for (const definition of definitions) {
      await this.add(definition);
    }
  }

  async add(definition: ExhibitDefinition): Promise<ExhibitRecord> {
    const spots = (definition.viewSpots ?? []).map(
      (spot, index) => new ViewSpot(definition.id, index, spot),
    );
    const override = this.player.createOverride(definition.id);

    const instance = await definition.build({
      assets: this.app.assets,
      quality: this.app.quality.level,
      eyes: spots.map((s) => s.eye.clone()),
      definition,
      playerOverride: override,
      lighting: this.lighting,
      collision: this.collision,
      audio: this.audio,
      flags: this.flags,
      reducedMotion: this.flags.reducedMotion,
    });

    instance.root.position.set(definition.position.x, definition.position.y, definition.position.z);
    instance.root.rotation.y = definition.rotationY;
    instance.root.name = `exhibit:${definition.id}`;
    this.#group.add(instance.root);

    for (const spot of spots) {
      this.#group.add(spot.mesh);
      this.viewpoint.add(spot);
    }

    const record: ExhibitRecord = {
      definition,
      instance,
      spots,
      plate: this.#createPlate(definition, spots),
      override,
      distance: Infinity,
      visible: true,
      inZone: false,
      revealed: false,
      revealProgress: 0,
    };
    this.records.set(definition.id, record);
    return record;
  }

  remove(id: ExhibitId): void {
    const record = this.records.get(id);
    if (!record) return;
    // ゾーンを出ないまま消えると身体改変が残る。必ず退出を通す。
    if (record.inZone) this.#exitZone(record);
    record.override.release();
    // 展示が立てた壁も一緒に片づける
    this.collision.removeByTag(id);
    this.viewpoint.removeByExhibit(id);
    for (const spot of record.spots) spot.dispose();
    record.plate?.dispose();
    record.plate?.root.removeFromParent();
    record.instance.dispose();
    record.instance.root.removeFromParent();
    this.records.delete(id);
    if (this.#focused === record) this.#setFocus(null);
  }

  /** 言語切替。ワールド内の 3D テキストを作り直す（§5.4） */
  setLocaleContent(resolve: (record: ExhibitRecord) => HintContent): void {
    for (const record of this.records.values()) {
      const content = resolve(record);
      record.instance.setLocale?.(content);
      record.plate?.setLines([
        { text: content.title, weight: 'title' },
        ...(content.caption ? [{ text: content.caption, weight: 'body' as const }] : []),
        ...(content.notice ? [{ text: content.notice, weight: 'note' as const }] : []),
      ]);
    }
  }

  /**
   * キャプションプレートは展示ごとに書かず、ここでまとめて立てる。
   * 置き場所は「視点マーカーに立ったとき、右手側に来る」位置。
   * ViewSpot を持たないゾーン型展示は、展示の中心の手前に置く。
   */
  #createPlate(definition: ExhibitDefinition, spots: ViewSpot[]): TextPlate | null {
    const plate = createTextPlate({ width: 0.7, height: 0.44, scale: 0.62 });
    const centre = new THREE.Vector3(
      definition.position.x,
      definition.position.y,
      definition.position.z,
    );
    const spot = spots[0];
    if (spot) {
      const toExhibit = centre.clone().sub(spot.standAt).setY(0).normalize();
      const right = new THREE.Vector3(-toExhibit.z, 0, toExhibit.x);
      plate.root.position
        .copy(spot.standAt)
        .addScaledVector(right, 0.95)
        .addScaledVector(toExhibit, 0.5);
      plate.root.position.y = 1.02;
      // 立ち位置のほうを向ける
      plate.root.rotation.y = Math.atan2(-right.x, -right.z);
    } else {
      plate.root.position.set(centre.x + 1.05, 1.02, centre.z + 3.4);
      plate.root.rotation.y = Math.PI * 0.85;
    }
    plate.root.rotation.x = -0.28;

    // 板を支える細い脚
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.026, 1.02, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.75 }),
    );
    post.position.set(plate.root.position.x, 0.51, plate.root.position.z);
    post.castShadow = true;
    this.#group.add(post);
    this.#plateposts.push(post);

    this.#group.add(plate.root);
    return plate;
  }

  setRevealed(id: ExhibitId, revealed: boolean): void {
    const record = this.records.get(id);
    if (!record || record.revealed === revealed) return;
    record.revealed = revealed;
    this.#applyCameraReveal(record, revealed);
    this.events.emit('revealChanged', { record, revealed });
  }

  /**
   * カメラを動かす種類の reveal（orbit / topDown）はここで駆動する。
   * 展示側からカメラを触らせると、ロック解除との整合が取れなくなるため。
   */
  #applyCameraReveal(record: ExhibitRecord, revealed: boolean): void {
    const kind = record.definition.reveal;
    if (kind !== 'orbit' && kind !== 'topDown') return;
    if (!this.viewpoint.isEngaged) return;
    if (!revealed) {
      this.viewpoint.setRevealPose(null, 1.4);
      return;
    }
    const spot = record.spots[0];
    if (!spot) return;
    const focus = record.definition.revealFocus;
    const centre = new THREE.Vector3(
      record.definition.position.x,
      record.definition.position.y,
      record.definition.position.z,
    );
    if (focus) {
      centre.add(
        new THREE.Vector3(focus.x, focus.y, focus.z).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          record.definition.rotationY,
        ),
      );
    }

    if (kind === 'orbit') {
      // 正解視点から 72° 回り込む。破綻（桁の切れ目）が見える角度。
      const offset = spot.eye.clone().sub(centre);
      const radius = offset.length();
      const base = Math.atan2(offset.x, offset.z);
      const poseAt = (degrees: number): ReturnType<typeof poseLookingAt> => {
        const angle = base + THREE.MathUtils.degToRad(degrees);
        const eye = new THREE.Vector3(
          centre.x + Math.sin(angle) * radius,
          spot.eye.y + radius * 0.14 * (degrees / 72),
          centre.z + Math.cos(angle) * radius,
        );
        return poseLookingAt(eye, centre, spot.definition.fov);
      };
      if (this.flags.reducedMotion) {
        // §8c: 段階送り。長いスイープの代わりに 2 段で送る
        this.viewpoint.setRevealSequence([
          { pose: poseAt(36), duration: 0.25, hold: 0.8 },
          { pose: poseAt(72), duration: 0.25, hold: 0 },
        ]);
      } else {
        this.viewpoint.setRevealPose(poseAt(72), 2.4);
      }
      return;
    }

    // topDown: 真上から本当の形を見せる。
    // 部屋の天井（下向きの単面）はカメラが上にあると裏面カリングで消えるため、
    // 天井より高い位置へ抜けても展示の中身が見える。
    const eye = new THREE.Vector3(centre.x, centre.y + 7.4, centre.z + 2.4);
    this.viewpoint.setRevealPose(poseLookingAt(eye, centre, 56), 2.4);
  }

  update(dt: number, elapsed: number): void {
    const p = this.player.position;
    for (const record of this.records.values()) {
      record.distance = record.instance.root.position.distanceTo(p);

      // §Phase 4: 20m 超は非表示にし update も止める
      const visible = record.distance <= CULL_DISTANCE || record.inZone;
      if (visible !== record.visible) {
        record.visible = visible;
        record.instance.root.visible = visible;
      }

      this.#updateZone(record, p);
      this.#updateReveal(record, dt);

      if (visible) record.instance.update?.(dt, elapsed);
    }
    this.#updateFocus();
  }

  dispose(): void {
    for (const id of [...this.records.keys()]) this.remove(id);
    for (const post of this.#plateposts.splice(0)) {
      post.geometry.dispose();
      (post.material as THREE.Material).dispose();
      post.removeFromParent();
    }
    // 保険: 何かが漏れていても身体改変は必ず巻き戻す
    this.player.releaseAllOverrides();
    this.#group.removeFromParent();
    this.events.clear();
  }

  // ------------------------------------------------------------- internals

  #updateZone(record: ExhibitRecord, p: THREE.Vector3): void {
    const zone = record.definition.zone;
    if (record.definition.kind !== 'zone' || !zone) return;
    const inside =
      p.x >= zone.min.x &&
      p.x <= zone.max.x &&
      p.y >= zone.min.y &&
      p.y <= zone.max.y &&
      p.z >= zone.min.z &&
      p.z <= zone.max.z;
    if (inside === record.inZone) return;
    if (inside) {
      record.inZone = true;
      record.instance.onZoneEnter?.();
      this.events.emit('zoneEntered', record);
    } else {
      this.#exitZone(record);
    }
  }

  #exitZone(record: ExhibitRecord): void {
    record.inZone = false;
    record.instance.onZoneExit?.();
    // 展示が巻き戻しを忘れていても、ここで確実に元へ戻す
    record.override.setEyeHeight(null);
    record.override.setMoveSpeedScale(null);
    this.events.emit('zoneExited', record);
  }

  #updateReveal(record: ExhibitRecord, dt: number): void {
    const target = record.revealed ? 1 : 0;
    if (record.revealProgress === target) return;
    const speed = dt / (this.flags.reducedMotion ? REVEAL_DURATION * 0.5 : REVEAL_DURATION);
    record.revealProgress = saturate(
      record.revealProgress + (target > record.revealProgress ? speed : -speed),
    );
    record.instance.setRevealed(record.revealed, record.revealProgress);
  }

  /**
   * フォーカス判定は「最寄り ViewSpot」と「画面中央（タッチはタップ位置）
   * からのレイキャスト」の併用（§Phase 4）。
   */
  #updateFocus(): void {
    const locked = this.viewpoint.current;
    if (locked) {
      this.#setFocus(this.records.get(locked.exhibitId) ?? null);
      return;
    }
    const candidate = this.viewpoint.candidate;
    if (candidate) {
      this.#setFocus(this.records.get(candidate.exhibitId) ?? null);
      return;
    }
    // ゾーン型展示の中にいるなら、それがフォーカス
    for (const record of this.records.values()) {
      if (record.inZone) {
        this.#setFocus(record);
        return;
      }
    }
    this.#setFocus(this.#raycastFocus());
  }

  /** レイキャスト対象は可視の展示のみ。NDC はタッチならタップ位置、PC なら中央 */
  #raycastFocus(ndc?: { x: number; y: number } | null): ExhibitRecord | null {
    this.#ndc.set(ndc?.x ?? 0, ndc?.y ?? 0);
    this.#raycaster.setFromCamera(this.#ndc, this.app.camera);
    this.#raycaster.far = 14;
    const roots: THREE.Object3D[] = [];
    for (const record of this.records.values()) {
      if (record.visible) roots.push(record.instance.root);
    }
    const hits = this.#raycaster.intersectObjects(roots, true);
    const hit = hits[0];
    if (!hit) return null;
    for (const record of this.records.values()) {
      if (isDescendant(hit.object, record.instance.root)) return record;
    }
    return null;
  }

  /** タップ位置からのレイキャスト（§4.1: クロスヘアは指で隠れる） */
  pickAt(input: InputState): ExhibitRecord | null {
    return this.#raycastFocus(input.pointerNdc);
  }

  /** ワールド内の仕掛け（D4 のボタンなど）を押す */
  interact(record: ExhibitRecord | null = this.#focused): boolean {
    if (!record?.definition.interactTextKey) return false;
    record.instance.onInteract?.();
    return true;
  }

  #setFocus(record: ExhibitRecord | null): void {
    if (record === this.#focused) return;
    this.#focused = record;
    this.events.emit('focusChanged', record);
  }
}

function isDescendant(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node === root) return true;
    node = node.parent;
  }
  return false;
}
