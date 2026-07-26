import * as THREE from 'three';
import { createCanvasTexture, drawNoise } from './common/CanvasTexture';
import { placeOnEyeRay } from './common/eyeProjection';
import type { BuildContext, ExhibitDefinition, ExhibitInstance } from './types';

/**
 * エイムズの部屋（Adelbert Ames Jr., 1946）—— 最難関。
 *
 * 逆算の考え方:
 *   「こう見えてほしい直方体」（理想の部屋）を先に決め、その各頂点を
 *   視点からのレイに沿って別々の距離へ押し出す（placeOnEyeRay）。
 *   左奥を遠くへ、右奥を手前へ置くと、実体は台形だが視点からは直方体に見える。
 *
 * テクスチャについて:
 *   理想の直方体の UV をそのまま実体の頂点に貼る。実面への投影も理想面への投影も
 *   「同じ四隅へ写す射影変換」なので、見かけは完全に一致する。
 *   壁の格子が歪んで見えないことは、この錯視の成立条件のひとつ。
 *
 * 人形は 2 体とも同じ寸法。左奥は右奥の約 2 倍の距離にあるため、
 * 「直方体の部屋である」という前提のもとで大きさが逆算され、小人と巨人に見える。
 */

/** 目の高さ（この展示の ViewSpot は覗き穴なので固定） */
const EYE_HEIGHT = 1.6;
/** 理想の部屋（見えてほしい直方体）。原点は覗き穴の足元 */
const IDEAL = {
  halfWidth: 1.1,
  floorY: 0.62,
  ceilingY: 2.7,
  frontZ: -1.6,
  backZ: -5.6,
};
/** 左奥をどれだけ遠くへ / 右奥をどれだけ手前へ置くか */
const FAR_SCALE = 1.6;
const NEAR_SCALE = 0.66;

const POSITION = { x: 18, y: 0, z: -1.5 };
/**
 * 歪んだ部屋の床の広がり（§10b）。
 *
 * 左奥は FAR_SCALE 倍、右奥は NEAR_SCALE 倍の距離へ押し出されるので、
 * 左右非対称になる。左奥 (−1.76, −8.96) / 右奥 (0.73, −3.70) / 手前 ±1.1。
 */
const FOOTPRINT = {
  minX: POSITION.x - 1.85,
  maxX: POSITION.x + 1.2,
  minZ: POSITION.z - 9.1,
  maxZ: POSITION.z - 1.5,
};

type V3 = THREE.Vector3;

function wallTexture(): THREE.CanvasTexture {
  return createCanvasTexture({ width: 512, height: 512, repeat: [1, 1] }, (ctx, w, h) => {
    ctx.fillStyle = '#d8d2c4';
    ctx.fillRect(0, 0, w, h);
    // 格子。歪みなく見えることが「直方体だ」という判断を支える
    ctx.strokeStyle = '#9a9282';
    ctx.lineWidth = 4;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * w;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }
    drawNoise(ctx, w, h, 0.02, 3);
  });
}

function floorTexture(): THREE.CanvasTexture {
  return createCanvasTexture({ width: 512, height: 512 }, (ctx, w, h) => {
    const n = 6;
    const cell = w / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#8e8577' : '#5f594e';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    drawNoise(ctx, w, h, 0.03, 11);
  });
}

/** 四隅（周回順）から、UV 付きの面を作る */
function quad(a: V3, b: V3, c: V3, d: V3): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const corners = [a, b, c, d];
  const uvCorners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const [i, j, k] of [
    [0, 1, 2],
    [0, 2, 3],
  ] as const) {
    for (const index of [i, j, k]) {
      const p = corners[index]!;
      positions.push(p.x, p.y, p.z);
      uvs.push(uvCorners[index]![0]!, uvCorners[index]![1]!);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function doll(height: number, color: number): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const bodyHeight = height * 0.72;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(height * 0.14, bodyHeight - height * 0.28, 6, 12),
    material,
  );
  body.position.y = bodyHeight / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(height * 0.15, 16, 12), material);
  head.position.y = bodyHeight + height * 0.14;
  for (const mesh of [body, head]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function build(ctx: BuildContext): ExhibitInstance {
  const root = new THREE.Group();
  const eye = new THREE.Vector3(0, EYE_HEIGHT, 0);

  const ideal = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
  const push = (p: V3, scale: number): V3 => placeOnEyeRay(eye, p, eye.distanceTo(p) * scale);

  // 手前の四隅はそのまま（覗き口の枠）
  const fbl = ideal(-IDEAL.halfWidth, IDEAL.floorY, IDEAL.frontZ);
  const fbr = ideal(IDEAL.halfWidth, IDEAL.floorY, IDEAL.frontZ);
  const ftl = ideal(-IDEAL.halfWidth, IDEAL.ceilingY, IDEAL.frontZ);
  const ftr = ideal(IDEAL.halfWidth, IDEAL.ceilingY, IDEAL.frontZ);

  // 奥の四隅は視線に沿って別々の距離へ押し出す
  const bbl = push(ideal(-IDEAL.halfWidth, IDEAL.floorY, IDEAL.backZ), FAR_SCALE);
  const btl = push(ideal(-IDEAL.halfWidth, IDEAL.ceilingY, IDEAL.backZ), FAR_SCALE);
  const bbr = push(ideal(IDEAL.halfWidth, IDEAL.floorY, IDEAL.backZ), NEAR_SCALE);
  const btr = push(ideal(IDEAL.halfWidth, IDEAL.ceilingY, IDEAL.backZ), NEAR_SCALE);

  const wallMap = wallTexture();
  const floorMap = floorTexture();
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: wallMap,
    roughness: 0.95,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorMap,
    roughness: 0.95,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    map: wallMap,
    roughness: 1,
    side: THREE.DoubleSide,
    transparent: true,
  });

  const surfaces: Array<{ mesh: THREE.Mesh; fadeOnReveal: number }> = [];
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    fadeOnReveal: number,
  ): void => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    surfaces.push({ mesh, fadeOnReveal });
    root.add(mesh);
  };

  add(quad(fbl, fbr, bbr, bbl), floorMaterial, 0);
  add(quad(bbl, bbr, btr, btl), wallMaterial, 0.35);
  add(quad(fbl, bbl, btl, ftl), wallMaterial, 0.35);
  add(quad(fbr, ftr, btr, bbr), wallMaterial, 0.35);
  add(quad(ftl, btl, btr, ftr), ceilingMaterial, 1);

  // 覗き口の枠。外から見たときにジオラマとして成立させる
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.8 });
  const frameGeometries: THREE.BufferGeometry[] = [];
  const frameWidth = 0.5;
  const outerL = -IDEAL.halfWidth - frameWidth;
  const outerR = IDEAL.halfWidth + frameWidth;
  const outerB = IDEAL.floorY - frameWidth;
  const outerT = IDEAL.ceilingY + frameWidth;
  const framePieces: Array<[number, number, number, number]> = [
    [outerL, outerR, outerT - frameWidth, outerT],
    [outerL, outerR, outerB, outerB + frameWidth],
    [outerL, outerL + frameWidth, outerB, outerT],
    [outerR - frameWidth, outerR, outerB, outerT],
  ];
  for (const [x0, x1, y0, y1] of framePieces) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.12);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, IDEAL.frontZ);
    frameGeometries.push(g);
    const mesh = new THREE.Mesh(g, frameMaterial);
    // 枠の影が室内の壁を横切ると、部屋の形の手がかりになってしまう
    mesh.castShadow = false;
    root.add(mesh);
  }

  // 同じ寸法の人形を 2 体。左奥は約 2 倍の距離にあるため半分の大きさに見える。
  // 位置は床の四辺形上の双線形補間で取る。奥行き方向にずらすと壁を突き抜けてしまう。
  const onFloor = (u: number, v: number): V3 =>
    fbl.clone().lerp(fbr, u).lerp(bbl.clone().lerp(bbr, u), v);
  const dollHeight = 0.62;
  const left = doll(dollHeight, 0xd4694a);
  const leftHome = onFloor(0.14, 0.86);
  left.position.copy(leftHome);
  const right = doll(dollHeight, 0x4a7fd4);
  const rightHome = onFloor(0.86, 0.86);
  right.position.copy(rightHome);
  root.add(left, right);

  /**
   * 種明かしで左の人形を運ぶ先（§11b-1）。
   *
   * 真上から見せるだけでは「奥行きの差＝距離の差」に見えてしまい、
   * 同じ大きさである証明にならない。右の隣へ並べる。
   * 床が台形なので、同じ u でも v によって奥行きが変わる。右の人形と
   * **同じ奥行き**に来る v を解いて、真上から見て横並びにする。
   */
  const leftBesideU = 0.62;
  const zAt = (v: number): number => onFloor(leftBesideU, v).z;
  const z0 = zAt(0);
  const z1 = zAt(1);
  const leftBeside = onFloor(
    leftBesideU,
    THREE.MathUtils.clamp((rightHome.z - z0) / (z1 - z0), 0, 1),
  );

  /**
   * 元の位置に残す半透明のゴースト（§11b-2）。
   * 「動かしただけで縮んでいない」ことを担保する。
   *
   * 部屋の中は暗いので、陰影のつく材質では俯瞰でまったく見えない。
   * 発光しない代わりに照明の影響を受けない MeshBasicMaterial にする。
   */
  const ghost = doll(dollHeight, 0xd4694a);
  ghost.position.copy(leftHome);
  ghost.visible = false;
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0xd4694a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  ghost.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    (mesh.material as THREE.Material).dispose();
    mesh.material = ghostMaterial;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // 半透明の壁と前後を争わないよう、必ず後に描く
    mesh.renderOrder = 5;
  });
  root.add(ghost);

  /**
   * 実寸の物差し（§11b-3）。
   *
   * **1 つの BufferGeometry を 2 本で共有し、スケールも変えない。**
   * コードを読んだだけで「同一寸法」が保証される形にしてある。
   *
   * 立てるのではなく床に寝かせる。俯瞰の種明かしでは垂直の棒は端から
   * 見ることになり、ほとんど長さを持たない。寝かせれば「同じ長さの棒が
   * 2 本」として plan view でそのまま読める。
   */
  const barGeometry = new THREE.BoxGeometry(0.022, 0.022, dollHeight);
  const barMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd2b0,
    transparent: true,
    opacity: 0,
  });
  barMaterial.toneMapped = false;
  const bars = [left, right].map(() => {
    const bar = new THREE.Mesh(barGeometry, barMaterial);
    bar.visible = false;
    bar.renderOrder = 5;
    root.add(bar);
    return bar;
  });
  /**
   * 人形の脇に物差しを置く。奥行き方向へ寝かせるのは、床が傾いていて
   * 手前へずらすと床に潜ってしまうため（同じ z なら足元の高さも同じ）。
   */
  const placeBar = (bar: THREE.Mesh, at: V3, side: number): void => {
    // 床は前後にも左右にも傾いている。棒の端が潜らないよう少し浮かせる
    // （真上から見るぶんには 0.1m の浮きは見えない）
    bar.position.set(at.x + side * 0.19, at.y + 0.1, at.z);
  };

  const origin = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const removeSpot = ctx.lighting.addSpot({
    position: origin.clone().add(new THREE.Vector3(0, 3.4, -3.2)),
    target: origin.clone().add(new THREE.Vector3(0, 1.2, -6.0)),
    color: 0xfff1dc,
    intensity: 46,
    angle: 0.7,
    penumbra: 0.85,
    distance: 16,
    // 影は落とさない。壁を横切る影は「この部屋は直方体ではない」手がかりになる
    shadow: false,
  });

  return {
    root,
    setRevealed(_revealed, progress) {
      // 天井と壁を透過させ、真上からの視点（ExhibitManager が担当）で
      // 本当の台形が見えるようにする
      for (const { mesh, fadeOnReveal } of surfaces) {
        const material = mesh.material as THREE.Material;
        material.opacity = 1 - fadeOnReveal * progress;
        material.depthWrite = material.opacity > 0.98;
      }

      // 左の人形を右の隣へ運ぶ。並べば同一寸法が一目で分かる（§11b）
      left.position.lerpVectors(leftHome, leftBeside, progress);
      const showing = progress > 0.001;
      ghost.visible = showing;
      ghostMaterial.opacity = progress * 0.55;
      for (const bar of bars) bar.visible = showing;
      barMaterial.opacity = progress * 0.9;
      placeBar(bars[0]!, left.position, -1);
      placeBar(bars[1]!, rightHome, 1);
    },
    dispose() {
      removeSpot();
      for (const { mesh } of surfaces) mesh.geometry.dispose();
      for (const g of frameGeometries) g.dispose();
      wallMaterial.dispose();
      floorMaterial.dispose();
      ceilingMaterial.dispose();
      frameMaterial.dispose();
      wallMap.dispose();
      floorMap.dispose();
      for (const group of [left, right, ghost]) {
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
          if (mesh.material) (mesh.material as THREE.Material).dispose();
        });
      }
      barGeometry.dispose();
      barMaterial.dispose();
      ghostMaterial.dispose();
    },
  };
}

export const amesRoom: ExhibitDefinition = {
  id: 'amesRoom',
  textKey: 'amesRoom',
  room: 'space',
  kind: 'object',
  order: 11,
  reveal: 'topDown',
  position: POSITION,
  rotationY: 0,
  footprint: FOOTPRINT,
  // 覗き穴が原点なので、真上からの演出はもっと奥を見る。並んだ 2 体
  //（局所 z ≈ −4.0）と台形の床（z −1.6 〜 −9.0）が同時に収まる中心（§11b-4）
  revealFocus: { x: -0.2, y: 0.3, z: -4.6 },
  viewSpots: [
    {
      standAt: { x: POSITION.x, y: 0, z: POSITION.z },
      eye: { x: POSITION.x, y: EYE_HEIGHT, z: POSITION.z },
      lookAt: { x: POSITION.x, y: EYE_HEIGHT, z: POSITION.z - 4 },
      // 覗き口いっぱいに見えるよう、理想の部屋の高さから逆算した画角
      fov: 65,
      radius: 1.0,
    },
  ],
  build,
};
