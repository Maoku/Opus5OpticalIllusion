import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { damp } from '../../utils/math';

/**
 * 舞台照明の灯体と、その光の通り道（ボリューメトリック風のビーム）。
 *
 * D5「嘘つきの影」の 2 灯に使う。あの展示は **光源を自分で動かせること**が
 * 成立条件なので、「どこから照らしているか」が読めないとダイヤルの手応えが無い。
 * 宙に浮いた明るさではなく、口・バンドア・ヨークを備えた機材を置き、
 * そこから空気が光って見えるようにする。
 *
 * 座標系: 原点は床、照射方向は −Z、光が出る点は (0, height, 0)。
 * ★ 実体はすべて z > 0（口より後ろ）に置く。口の前に物を置くと SpotLight の
 *   光路を塞ぎ、スクリーンに機材の影が混ざって作品が壊れる。唯一の例外が
 *   バンドアで、これは照射角の外側へ開いた位置に留める。
 */

export interface SpotFixtureOptions {
  /** 光が出る高さ。灯体の口の中心がここに来る */
  height: number;
  /** SpotLight.angle と同じ値。ビームの広がりが実際の照射とずれると嘘になる */
  angle: number;
  /** ビームの長さ。光が当たる面に届く手前で消えきる長さにする */
  throwDistance: number;
  /** 光の色。レンズとビームで共有する */
  color: number;
  /** ビームの濃さ。0 ならビームを作らない（low プリセット） */
  beamStrength: number;
}

export interface SpotFixture {
  /** 床に置くグループ。−Z が照射方向 */
  readonly group: THREE.Group;
  /** 毎フレーム呼ぶ。カメラのワールド座標で、ビームの近接フェードを更新する */
  update(dt: number, cameraWorld: THREE.Vector3): void;
  dispose(): void;
}

/** 灯体の胴の長さと半径。口の直径がバンドアの幅を決める */
const BODY_LENGTH = 0.3;
const BODY_RADIUS = 0.115;
/** バンドアが軸となす角。照射角より外に開いていないと光を切ってしまう */
const DOOR_ANGLE = THREE.MathUtils.degToRad(36);

const BEAM_VERT = /* glsl */ `
uniform float uLength;
varying float vDepth;
varying vec3 vNormalV;
varying vec3 vViewV;

void main() {
  vDepth = clamp(-position.z / uLength, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewV = mv.xyz;
  vNormalV = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;

/*
 * 円錐の殻を両面描いて足し合わせる。
 *
 * body: カメラを正面から受ける面ほど、その先に見通す空気が厚い＝明るい。
 *   輪郭で 0 に落ちるので、殻の縁が線として出ない（ここを Fresnel で
 *   逆向きにすると、光の柱ではなく「筒の見えるガラス」になる）。
 * along/ends: ★ 口の近くだけを濃くし、奥は早めに殺す。
 *   等濃度の柱にすると、照らされた面（D5 ならスクリーン）が
 *   ビーム越しに見えることになり、影の黒が持ち上がって作品が壊れる。
 *   末端を殺すのは、円錐の底が空中の円板として見えるのを防ぐためでもある。
 */
const BEAM_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uStrength;
varying float vDepth;
varying vec3 vNormalV;
varying vec3 vViewV;

void main() {
  vec3 n = normalize(vNormalV);
  float facing = abs(dot(n, normalize(-vViewV)));
  float body = pow(facing, 2.4);
  float along = mix(1.0, 0.1, vDepth);
  float ends = smoothstep(0.0, 0.05, vDepth) * smoothstep(0.85, 0.3, vDepth);
  float alpha = body * along * ends * uStrength;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}`;

/** 位置と回転を焼いてから返す。可動部が無いので全部ジオメトリ側に潰せる */
function place(
  geometry: THREE.BufferGeometry,
  pos: readonly [number, number, number],
  rot?: readonly [number, number, number],
): THREE.BufferGeometry {
  if (rot) {
    geometry.rotateX(rot[0]);
    geometry.rotateY(rot[1]);
    geometry.rotateZ(rot[2]);
  }
  geometry.translate(pos[0], pos[1], pos[2]);
  return geometry;
}

/** 支柱・ヨーク・胴・バンドア。すべて同じ黒い金属なので 1 メッシュに潰す */
function createHardware(height: number): THREE.BufferGeometry {
  const poleHeight = height - 0.32;
  const pieces: THREE.BufferGeometry[] = [
    // 床の台座。支柱が床から生えていると、置いた機材に見えない
    place(new THREE.CylinderGeometry(0.11, 0.13, 0.035, 16), [0, 0.018, 0]),
    place(new THREE.CylinderGeometry(0.035, 0.05, poleHeight, 12), [0, poleHeight / 2, 0]),
    // ヨーク（灯体を挟む U 字金具）
    place(new THREE.BoxGeometry(0.3, 0.028, 0.06), [0, poleHeight + 0.014, 0]),
    // 胴。口（z = 0）より後ろだけを占める
    place(
      new THREE.CylinderGeometry(BODY_RADIUS, BODY_RADIUS * 1.06, BODY_LENGTH, 20),
      [0, height, BODY_LENGTH / 2 + 0.02],
      [Math.PI / 2, 0, 0],
    ),
    // 後ろの絞りとケーブルの出口
    place(
      new THREE.CylinderGeometry(0.085, 0.055, 0.07, 16),
      [0, height, BODY_LENGTH + 0.055],
      [Math.PI / 2, 0, 0],
    ),
    // 口のリング。ここが光る縁になる
    place(new THREE.TorusGeometry(BODY_RADIUS, 0.014, 8, 24), [0, height, 0.018]),
  ];

  for (const side of [-1, 1]) {
    pieces.push(
      // ヨークの腕。口の高さまで伸ばして胴を挟む
      place(new THREE.BoxGeometry(0.024, 0.34, 0.055), [side * 0.146, height - 0.15, 0.12]),
      // 首振りのボルト
      place(
        new THREE.CylinderGeometry(0.028, 0.028, 0.03, 10),
        [side * 0.152, height, 0.12],
        [0, 0, Math.PI / 2],
      ),
    );
  }

  // バンドア 4 枚。口の縁から前へ開く。1 枚作って軸の周りに 4 回まわす
  for (let i = 0; i < 4; i++) {
    const door = place(
      new THREE.BoxGeometry(0.21, 0.006, 0.13),
      [0, BODY_RADIUS + 0.02 + Math.sin(DOOR_ANGLE) * 0.065, -Math.cos(DOOR_ANGLE) * 0.065],
      [DOOR_ANGLE, 0, 0],
    );
    door.rotateZ((i * Math.PI) / 2);
    door.translate(0, height, 0);
    pieces.push(door);
  }

  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('spotFixture: failed to merge geometry');
  merged.computeBoundingSphere();
  return merged;
}

export function createSpotFixture(options: SpotFixtureOptions): SpotFixture {
  const { height, angle, throwDistance, color, beamStrength } = options;
  const group = new THREE.Group();

  const hardwareGeometry = createHardware(height);
  const hardwareMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b2f36,
    roughness: 0.52,
    metalness: 0.62,
    // アルコーブは環境光を落としてあるので（Lighting の opus プロファイル）、
    // 素の金属だと真っ黒な塊になって機材だと分からない。輪郭が拾える程度に灯す
    emissive: 0x14171d,
  });
  const hardware = new THREE.Mesh(hardwareGeometry, hardwareMaterial);
  // 自分の光の中に立つ機材なので、影を落とさせると口の前が汚れる
  hardware.castShadow = false;
  hardware.receiveShadow = true;
  group.add(hardware);

  // レンズ。ここだけは灯っている面として描く（光源の位置を目で追えるように）
  const lensGeometry = new THREE.CircleGeometry(BODY_RADIUS - 0.008, 24);
  const lensMaterial = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
  lensMaterial.toneMapped = false;
  const lens = new THREE.Mesh(lensGeometry, lensMaterial);
  lens.position.set(0, height, 0.016);
  group.add(lens);

  let beam: THREE.Mesh | null = null;
  let beamGeometry: THREE.ConeGeometry | null = null;
  let beamMaterial: THREE.ShaderMaterial | null = null;
  if (beamStrength > 0) {
    beamGeometry = new THREE.ConeGeometry(
      Math.tan(angle) * throwDistance,
      throwDistance,
      36,
      1,
      true,
    );
    // 頂点を口に、底を照射方向（−Z）に持っていく
    beamGeometry.rotateX(Math.PI / 2);
    beamGeometry.translate(0, height, -throwDistance / 2);
    beamMaterial = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uStrength: { value: 0 },
        uLength: { value: throwDistance },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.renderOrder = 2;
    // 円錐の外接球は大きい。カリングを効かせるためにここで一度だけ確定させる
    beamGeometry.computeBoundingSphere();
    group.add(beam);
  }

  const local = new THREE.Vector3();
  let strength = 0;

  return {
    group,
    update(dt, cameraWorld) {
      if (!beamMaterial) return;
      // カメラが殻の上に乗ると、光の柱ではなく板が見える。近づいたら消す
      group.updateWorldMatrix(true, false);
      group.worldToLocal(local.copy(cameraWorld));
      local.y -= height;
      const along = THREE.MathUtils.clamp(-local.z, 0, throwDistance);
      const radial = Math.hypot(local.x, local.y);
      // 円錐面までの距離（母線に下ろした垂線）と、口そのものまでの距離
      const gap = Math.abs(radial - Math.tan(angle) * along) * Math.cos(angle);
      const clearance = Math.min(gap, local.length());
      const wanted = beamStrength * THREE.MathUtils.smoothstep(clearance, 0.18, 0.6);
      strength = THREE.MathUtils.lerp(strength, wanted, damp(6, dt));
      beamMaterial.uniforms.uStrength!.value = strength;
    },
    dispose() {
      hardwareGeometry.dispose();
      hardwareMaterial.dispose();
      lensGeometry.dispose();
      lensMaterial.dispose();
      beamGeometry?.dispose();
      beamMaterial?.dispose();
    },
  };
}
