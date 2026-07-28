/**
 * D5「嘘つきの影」の visual hull を生成する（ROOM_D §1 / §2.4）。
 *
 *   node --experimental-strip-types tools/buildShadowHull.ts [options]
 *
 *     --pair <name>       シルエットの組み合わせ（既定 bird-fish）
 *     --resolution <n>    ボクセル解像度（既定 96）
 *     --out <path>        出力先（既定 public/models/shadowHull.glb）
 *     --preview           影の ASCII プレビューを出す
 *     --all               全ペアの成績だけを出して書き出さない
 *     --dry               書き出さずに成績だけ出す
 *
 * ROOM_D §5 のリスク表いわく「visual hull が痩せて影が読めない」。
 * 対策として求められているのが **先にスクリプトを作り、シルエットの
 * 組み合わせを複数試せるようにすること**なので、書き出しより先に
 * 「影がシルエットをどれだけ満たすか（coverage）」を必ず表示する。
 *
 * 幾何もシルエットも `src/exhibits/common/shadowHullSpec.ts` から引く。
 * 展示側のライト位置と食い違うと影が意味を失うので、定数は共有する。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BUILD_RESOLUTION,
  SILHOUETTE_PAIRS,
  buildHullField,
  type SilhouettePair,
} from '../src/exhibits/common/shadowHullSpec.ts';
import {
  fieldToMesh,
  shadowCoverage,
  type Grid,
  type ShadowView,
} from '../src/exhibits/common/visualHull.ts';

interface Report {
  pair: string;
  voxels: number;
  coverage: number[];
  triangles: number;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key?.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key.slice(2)] = next;
      i++;
    } else {
      out[key.slice(2)] = '1';
    }
  }
  return out;
}

/** 影を文字で描く。数値だけでは「鳥に見えるか」は判断できない */
function previewShadow(view: ShadowView, field: Float32Array, grid: Grid, columns = 56): string {
  const size = view.mask.size;
  const step = Math.max(1, Math.floor(size / columns));
  const rows: string[] = [];
  // 端末の文字は縦長なので、行だけ 2 倍に間引く
  for (let py = 0; py < size; py += step * 2) {
    let row = '';
    for (let px = 0; px < size; px += step) {
      const wanted = view.mask.data[py * size + px] === 1;
      const shadowed = shadowedAt(view, field, grid, px, py);
      row += wanted ? (shadowed ? '#' : '.') : shadowed ? '!' : ' ';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/** 1 画素ぶんの影判定。coverage と同じ計算を 1 点だけ行う */
function shadowedAt(
  view: ShadowView,
  field: Float32Array,
  grid: Grid,
  px: number,
  py: number,
): boolean {
  const single: ShadowView = {
    ...view,
    mask: { size: 1, data: Uint8Array.from([1]) },
    centre: [
      view.centre[0] + (((px + 0.5) / view.mask.size) * 2 - 1) * view.half,
      view.centre[1] + (1 - ((py + 0.5) / view.mask.size) * 2) * view.half,
    ],
    half: view.half / view.mask.size,
  };
  return shadowCoverage(single, field, grid).covered === 1;
}

async function evaluate(
  pair: SilhouettePair,
  resolution: number,
  preview: boolean,
): Promise<{ report: Report; mesh: Awaited<ReturnType<typeof fieldToMesh>>; grid: Grid }> {
  const { field, grid, views } = buildHullField(resolution, pair);
  let voxels = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i]! >= 0.5) voxels++;
  }
  const coverage = views.map((view) => shadowCoverage(view, field, grid).ratio);
  const mesh = await fieldToMesh(field, grid, 0.5, 400000);

  if (preview) {
    for (let i = 0; i < views.length; i++) {
      console.warn(`\n--- shadow ${i + 1} (# = 影あり / . = 欠け / ! = はみ出し) ---`);
      console.warn(previewShadow(views[i]!, field, grid));
    }
  }
  return { report: { pair: pair.name, voxels, coverage, triangles: mesh.triangles }, mesh, grid };
}

function formatReport(report: Report): string {
  const coverage = report.coverage.map((c) => `${(c * 100).toFixed(1)}%`).join(' / ');
  return `${report.pair.padEnd(12)} voxels ${String(report.voxels).padStart(7)}  coverage ${coverage}  triangles ${report.triangles}`;
}

// ------------------------------------------------------------------ glTF 出力

interface Welded {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * 同じ座標の頂点をまとめる。Marching Cubes の出力は三角形ごとに頂点が
 * 独立しているので、そのままだと glTF が 3 倍ほど太る。法線は平均する。
 */
function weld(positions: Float32Array, normals: Float32Array): Welded {
  const map = new Map<string, number>();
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const indices = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let index = map.get(key);
    if (index === undefined) {
      index = outPositions.length / 3;
      map.set(key, index);
      outPositions.push(x, y, z);
      outNormals.push(0, 0, 0);
    }
    outNormals[index * 3] = outNormals[index * 3]! + normals[i * 3]!;
    outNormals[index * 3 + 1] = outNormals[index * 3 + 1]! + normals[i * 3 + 1]!;
    outNormals[index * 3 + 2] = outNormals[index * 3 + 2]! + normals[i * 3 + 2]!;
    indices[i] = index;
  }
  for (let i = 0; i < outNormals.length / 3; i++) {
    const x = outNormals[i * 3]!;
    const y = outNormals[i * 3 + 1]!;
    const z = outNormals[i * 3 + 2]!;
    const length = Math.hypot(x, y, z) || 1;
    outNormals[i * 3] = x / length;
    outNormals[i * 3 + 1] = y / length;
    outNormals[i * 3 + 2] = z / length;
  }
  return {
    positions: Float32Array.from(outPositions),
    normals: Float32Array.from(outNormals),
    indices,
  };
}

/** 単一メッシュの GLB を組み立てる。エクスポータを積むほどの用事ではない */
function toGlb(mesh: Welded): Uint8Array {
  const positionBytes = mesh.positions.byteLength;
  const normalBytes = mesh.normals.byteLength;
  const indexBytes = mesh.indices.byteLength;
  const binaryLength = positionBytes + normalBytes + indexBytes;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]!);
    minY = Math.min(minY, mesh.positions[i + 1]!);
    minZ = Math.min(minZ, mesh.positions[i + 2]!);
    maxX = Math.max(maxX, mesh.positions[i]!);
    maxY = Math.max(maxY, mesh.positions[i + 1]!);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]!);
  }

  const json = {
    asset: { version: '2.0', generator: 'tools/buildShadowHull.ts' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'shadowHull' }],
    meshes: [
      {
        name: 'shadowHull',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: mesh.positions.length / 3,
        type: 'VEC3',
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: mesh.normals.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        componentType: 5125, // UNSIGNED_INT
        count: mesh.indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes, byteLength: normalBytes, target: 34962 },
      {
        buffer: 0,
        byteOffset: positionBytes + normalBytes,
        byteLength: indexBytes,
        target: 34963,
      },
    ],
    buffers: [{ byteLength: binaryLength }],
  };

  const encoder = new TextEncoder();
  let jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jsonPadding > 0) {
    const padded = new Uint8Array(jsonBytes.byteLength + jsonPadding);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.byteLength); // 空白で詰める
    jsonBytes = padded;
  }
  const binaryPadding = (4 - (binaryLength % 4)) % 4;

  const total = 12 + 8 + jsonBytes.byteLength + 8 + binaryLength + binaryPadding;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  bytes.set(jsonBytes, 20);

  const binaryOffset = 20 + jsonBytes.byteLength;
  view.setUint32(binaryOffset, binaryLength + binaryPadding, true);
  view.setUint32(binaryOffset + 4, 0x004e4942, true); // 'BIN'
  bytes.set(new Uint8Array(mesh.positions.buffer, 0, positionBytes), binaryOffset + 8);
  bytes.set(new Uint8Array(mesh.normals.buffer, 0, normalBytes), binaryOffset + 8 + positionBytes);
  bytes.set(
    new Uint8Array(mesh.indices.buffer, 0, indexBytes),
    binaryOffset + 8 + positionBytes + normalBytes,
  );
  return bytes;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const resolution = Number(args.resolution ?? BUILD_RESOLUTION);
  const preview = args.preview === '1';

  if (args.all === '1') {
    for (const pair of SILHOUETTE_PAIRS) {
      const { report } = await evaluate(pair, resolution, preview);
      console.warn(formatReport(report));
    }
    return;
  }

  const name = args.pair ?? SILHOUETTE_PAIRS[0]!.name;
  const pair = SILHOUETTE_PAIRS.find((p) => p.name === name);
  if (!pair) {
    console.error(
      `unknown pair: ${name}. known: ${SILHOUETTE_PAIRS.map((p) => p.name).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const { report, mesh } = await evaluate(pair, resolution, preview);
  console.warn(formatReport(report));
  if (report.coverage.some((c) => c < 0.9)) {
    console.warn(
      '\n⚠ coverage が 90% を下回っています。影が欠けて読めない可能性があります。\n' +
        '  シルエットを痩せさせるか、2 枚の矛盾を減らしてください（ROOM_D §5）。',
    );
  }

  if (args.dry === '1') return;

  const welded = weld(mesh.positions, mesh.normals);
  const glb = toGlb(welded);
  const out = args.out ?? 'public/models/shadowHull.glb';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, glb);
  console.warn(
    `\n${out}: ${(glb.byteLength / 1024).toFixed(1)} KB ` +
      `(vertices ${welded.positions.length / 3}, triangles ${welded.indices.length / 3})`,
  );
}

// 直接実行されたときだけ走らせる
if (process.argv[1]?.endsWith('buildShadowHull.ts')) {
  void main();
}
