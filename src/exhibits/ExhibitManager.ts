import * as THREE from 'three';
import type { Updatable } from '../core/App';
import type { SceneHost } from '../core/SceneHost';
import { EventBus } from '../core/EventBus';
import type { InputState } from '../core/input/types';
import type { PlayerController, PlayerOverrideHandle } from '../player/PlayerController';
import { ViewSpot } from '../viewpoint/ViewSpot';
import { poseLookingAt, type ViewpointController } from '../viewpoint/ViewpointController';
import type { Lighting } from '../world/Lighting';
import { saturate } from '../utils/math';
import type { ExhibitDefinition, ExhibitId, ExhibitInstance, HintContent } from './types';

/** これより遠い展示は描画も update も止める（§Phase 4: LOD/カリング） */
export const CULL_DISTANCE = 20;
/** reveal 演出の進行時間 */
const REVEAL_DURATION = 1.1;

export interface ExhibitRecord {
  definition: ExhibitDefinition;
  instance: ExhibitInstance;
  spots: ViewSpot[];
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
  #focused: ExhibitRecord | null = null;
  #reducedMotion = false;

  constructor(
    private readonly app: SceneHost,
    private readonly lighting: Lighting,
    private readonly player: PlayerController,
    private readonly viewpoint: ViewpointController,
  ) {
    this.#group.name = 'exhibits';
    app.scene.add(this.#group);
  }

  set reducedMotion(v: boolean) {
    this.#reducedMotion = v;
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
      reducedMotion: this.#reducedMotion,
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
    this.viewpoint.removeByExhibit(id);
    for (const spot of record.spots) spot.dispose();
    record.instance.dispose();
    record.instance.root.removeFromParent();
    this.records.delete(id);
    if (this.#focused === record) this.#setFocus(null);
  }

  /** 言語切替。ワールド内の 3D テキストを作り直す（§5.4） */
  setLocaleContent(resolve: (record: ExhibitRecord) => HintContent): void {
    for (const record of this.records.values()) {
      record.instance.setLocale?.(resolve(record));
    }
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
      const angle = Math.atan2(offset.x, offset.z) + THREE.MathUtils.degToRad(72);
      const eye = new THREE.Vector3(
        centre.x + Math.sin(angle) * radius,
        spot.eye.y + radius * 0.14,
        centre.z + Math.cos(angle) * radius,
      );
      this.viewpoint.setRevealPose(poseLookingAt(eye, centre, spot.definition.fov), 2.4);
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
    const speed = dt / (this.#reducedMotion ? REVEAL_DURATION * 0.5 : REVEAL_DURATION);
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
