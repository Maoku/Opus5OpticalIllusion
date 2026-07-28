/**
 * happy-dom の <canvas> は 2D コンテキストを持たない（getContext('2d') が null）。
 *
 * §9 の方針で本作の画像はすべて Canvas から手続き的に焼くので、
 * それを使う展示は build した時点で落ちる。描画命令を捨てるだけの最小実装を
 * 差し込んで、**形状とロジック**をテストできるようにする。
 * 絵そのものの検証は目視の担当で、ここでは扱わない。
 */

interface StubContext {
  canvas: { width: number; height: number };
}

function createStubContext(width: number, height: number): StubContext {
  const noop = (): void => {};
  return {
    canvas: { width, height },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    strokeText: noop,
    drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    // 折り返しの計算に使われる。1 文字 8px の等幅とみなす
    measureText: (text: string) => ({ width: text.length * 8 }),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: noop,
  } as unknown as StubContext;
}

/** happy-dom 環境のテストで、build 時に呼ぶ前に一度だけ実行する */
export function stubCanvas2D(): void {
  const canvasClass = (globalThis as { HTMLCanvasElement?: { prototype: object } })
    .HTMLCanvasElement;
  if (!canvasClass) throw new Error('HTMLCanvasElement が無い（environment: happy-dom が必要）');
  const prototype = canvasClass.prototype as {
    getContext(kind: string): StubContext | null;
    width?: number;
    height?: number;
  };
  prototype.getContext = function (this: { width: number; height: number }, kind: string) {
    return kind === '2d' ? createStubContext(this.width, this.height) : null;
  };
}
