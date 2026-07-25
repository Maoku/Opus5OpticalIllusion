import * as THREE from 'three';

export interface CanvasTextureOptions {
  width: number;
  height?: number;
  /** THREE.SRGBColorSpace（色）か NoColorSpace（データ）か */
  colorSpace?: THREE.ColorSpace;
  repeat?: [number, number];
  wrap?: THREE.Wrapping;
  anisotropy?: number;
  /** 画素の境目を残したい錯視（カフェウォール等）では 'nearest' にする */
  filter?: 'linear' | 'nearest';
  generateMipmaps?: boolean;
}

/**
 * 手続き的テクスチャ生成の共通ヘルパ。
 *
 * §9「総アセット 5MB 以下」のため、本作の画像は原則ここで生成する。
 * 画像ファイルを増やさずに済むうえ、解像度を quality に応じて変えられる。
 */
export function createCanvasTexture(
  options: CanvasTextureOptions,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): THREE.CanvasTexture {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height ?? width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  draw(ctx, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
  const wrap = options.wrap ?? THREE.RepeatWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  if (options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1]);
  if (options.filter === 'nearest') {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = options.generateMipmaps === false ? THREE.NearestFilter : THREE.NearestMipmapLinearFilter;
  }
  if (options.generateMipmaps === false) texture.generateMipmaps = false;
  texture.anisotropy = options.anisotropy ?? 8;
  texture.needsUpdate = true;
  return texture;
}

/** 微細なノイズを重ねる。単色の床/壁が「のっぺり」しないようにする用途。 */
export function drawNoise(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number,
  seed = 1,
): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  let s = seed >>> 0 || 1;
  const rand = (): number => {
    // xorshift32: 決定的なので見た目が毎回同じになる
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (let i = 0; i < data.length; i += 4) {
    const n = rand() * amount * 255;
    data[i] = clampByte(data[i]! + n);
    data[i + 1] = clampByte(data[i + 1]! + n);
    data[i + 2] = clampByte(data[i + 2]! + n);
  }
  ctx.putImageData(image, 0, 0);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 塗りつぶし + ノイズ、という最頻出パターン */
export function createSurfaceTexture(
  size: number,
  color: string,
  noise = 0.03,
  seed = 1,
): THREE.CanvasTexture {
  return createCanvasTexture({ width: size }, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    if (noise > 0) drawNoise(ctx, w, h, noise, seed);
  });
}
