/**
 * 日本語フォントのグリフサブセット化（§5.3）。
 *
 *   node --experimental-strip-types tools/subsetFont.ts [--font <path>] [--out <path>]
 *
 * 現状の位置づけ:
 *   本作の文字は DOM の UI もワールド内の板（TextPlate）も **システムフォント**で
 *   描いている。Canvas 2D にシステムフォントで焼くので、**配信するフォントは 0 バイト**。
 *   §5.3 の表でいう「DOM の UI 文字 → システムフォント」を、3D テキストにも
 *   広げた形になっている。
 *
 *   したがって現時点でこのツールの出番は無い。
 *   それでも用意してあるのは、見出しだけ独自書体を当てたくなったときに
 *   「必要なグリフ数と概算サイズ」を即答できるようにしておくため。
 *   フォントを渡さずに実行すると、辞書に出現する全文字とその数を報告して終わる。
 */
import { ja } from '../src/i18n/ja.ts';
import { en } from '../src/i18n/en.ts';

type Tree = { [key: string]: string | Tree };

/** 辞書に出現する全文字を集める。順序は安定させる（差分を読みやすくするため） */
export function collectGlyphs(...dictionaries: Tree[]): string[] {
  const set = new Set<string>();
  const walk = (node: Tree): void => {
    for (const value of Object.values(node)) {
      if (typeof value === 'string') {
        for (const ch of value) set.add(ch);
      } else {
        walk(value);
      }
    }
  };
  for (const dictionary of dictionaries) walk(dictionary);
  return [...set].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}

/** CJK（ひらがな・カタカナ・漢字）だけを数える。サブセットの重さはほぼこれで決まる */
export function countCjk(glyphs: readonly string[]): number {
  return glyphs.filter((ch) => /[぀-ヿ㐀-鿿]/.test(ch)).length;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key?.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1] ?? '';
    i++;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const glyphs = collectGlyphs(ja as unknown as Tree, en as unknown as Tree);
  const text = glyphs.join('');
  const cjk = countCjk(glyphs);

  console.warn(`glyphs: ${glyphs.length} (CJK ${cjk})`);
  console.warn(text);

  if (!args.font) {
    console.warn(
      '\nno --font given: nothing to subset.\n' +
        'Captions are drawn with system fonts, so the build currently ships 0 bytes of font data.\n' +
        'Pass --font <ttf/otf/woff2> to produce a subset for a custom face.',
    );
    return;
  }

  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  // 未インストールでも型検査を通すため、指定子は実行時に組み立てる
  const specifier: string = 'subset-font';
  let subsetFont: (buffer: Buffer, text: string, options: object) => Promise<Buffer>;
  try {
    const module = (await import(specifier)) as { default: typeof subsetFont };
    subsetFont = module.default;
  } catch {
    console.error('subset-font is not installed. Run: npm install -D subset-font');
    process.exitCode = 1;
    return;
  }

  const source = await readFile(args.font);
  const result = await subsetFont(source, text, { targetFormat: 'woff2' });
  const out = args.out ?? 'public/fonts/subset.woff2';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, result);
  console.warn(`\n${out}: ${(result.byteLength / 1024).toFixed(1)} KB`);
}

// 直接実行されたときだけ走らせる（テストからは collectGlyphs だけを使う）
if (process.argv[1]?.endsWith('subsetFont.ts')) {
  void main();
}
