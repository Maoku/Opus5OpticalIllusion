import { describe, expect, it } from 'vitest';
import { ja } from '../src/i18n/ja';
import { en } from '../src/i18n/en';
import { EXHIBITS } from '../src/exhibits/registry';
import { pseudoLocalise } from '../src/i18n';
import { collectGlyphs, countCjk } from '../tools/subsetFont';

type Tree = { [key: string]: string | Tree };

function paths(value: Tree, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.push(path);
    else out.push(...paths(child, path));
  }
  return out.sort();
}

function at(value: Tree, path: string): string {
  let node: string | Tree = value;
  for (const part of path.split('.')) {
    node = (node as Tree)[part]!;
  }
  return node as string;
}

const jaTree = ja as unknown as Tree;
const enTree = en as unknown as Tree;

/**
 * D1「二つの真実」の例外（§5.4 / ROOM_D §1）。
 *
 * 字は英語版でも「真」「偽」のまま固定する確定方針なので、
 * 英語辞書に CJK が出るのはここだけ。逆に日本語版ではグロスを描かないので、
 * `ja.exhibits.twoTruths.glyphGloss` は「空文字であること」が仕様になる。
 */
const CJK_ALLOWED_IN_EN = new Set([
  'exhibits.twoTruths.explanation',
  'exhibits.twoTruths.glyphGloss',
]);
const EMPTY_ALLOWED_IN_JA = new Set(['exhibits.twoTruths.glyphGloss']);

// §5.2 / §9: 型で拾えない欠落・プレースホルダのずれをここで拾う
describe('dictionary parity', () => {
  it('has identical key structures', () => {
    expect(paths(enTree)).toEqual(paths(jaTree));
  });

  it('has no empty strings', () => {
    for (const path of paths(jaTree)) {
      if (!EMPTY_ALLOWED_IN_JA.has(path)) {
        expect(at(jaTree, path).trim(), `ja.${path}`).not.toBe('');
      }
      expect(at(enTree, path).trim(), `en.${path}`).not.toBe('');
    }
  });

  // §5.4: グロスは「日本語では描かない」ことが仕様。空文字がその指示にあたる
  it('leaves the Japanese glyph gloss empty on purpose', () => {
    expect(ja.exhibits.twoTruths.glyphGloss).toBe('');
    expect(en.exhibits.twoTruths.glyphGloss).toContain('true');
  });

  it('keeps placeholders consistent between languages', () => {
    const placeholder = /\{[a-zA-Z0-9_]+\}/g;
    for (const path of paths(jaTree)) {
      const a = (at(jaTree, path).match(placeholder) ?? []).sort();
      const b = (at(enTree, path).match(placeholder) ?? []).sort();
      expect(b, path).toEqual(a);
    }
  });

  it('leaves no Japanese in the English dictionary', () => {
    const cjk = /[぀-ヿ一-鿿]/;
    for (const path of paths(enTree)) {
      // D1「二つの真実」の字だけは意図的に日本語のまま残す（§5.4）。
      // それ以外に CJK が出たら訳し忘れである。
      if (CJK_ALLOWED_IN_EN.has(path)) continue;
      expect(cjk.test(at(enTree, path)), `en.${path}`).toBe(false);
    }
  });

  // 例外が「D1 の字を残すため」以外に広がっていないこと
  it('keeps the Japanese-in-English exception to the D1 glyphs', () => {
    for (const path of CJK_ALLOWED_IN_EN) {
      expect(at(enTree, path), path).toMatch(/[真偽]/);
    }
  });
});

describe('exhibit text keys', () => {
  it('resolves every registered exhibit in both languages', () => {
    for (const definition of EXHIBITS) {
      expect(ja.exhibits[definition.textKey], definition.id).toBeDefined();
      expect(en.exhibits[definition.textKey], definition.id).toBeDefined();
    }
  });

  it('gives every exhibit a title, appearance and explanation', () => {
    for (const [key, entry] of Object.entries(ja.exhibits)) {
      expect(entry.title, key).toBeTruthy();
      expect(entry.appearance, key).toBeTruthy();
      expect(entry.explanation, key).toBeTruthy();
    }
  });

  // §8 リスク表「解説文の正確さ」: 錯視の正式名称と提唱者を必ず明記する
  it('cites a reference for every exhibit', () => {
    for (const [key, entry] of Object.entries(ja.exhibits)) {
      expect(entry.reference, key).toBeTruthy();
    }
  });

  // §5.5: 英語圏で確立した正式名称を使う（直訳は誤り）
  it('uses the established English names', () => {
    expect(en.exhibits.cafeWall.title).toBe('Café Wall illusion');
    expect(en.exhibits.amesRoom.title).toBe('Ames room');
    expect(en.exhibits.hollowMask.title).toBe('Hollow-Face illusion');
    expect(en.exhibits.beuchetChair.title).toBe('Beuchet chair');
    expect(en.exhibits.penroseStairs.title).toBe('Penrose stairs');
    expect(en.exhibits.peripheralDrift.title).toBe('Rotating Snakes');
  });
});

// ------------------------------------------------------------- 疑似ロケール

describe('pseudoLocalise', () => {
  it('lengthens every string by roughly 60% and marks both ends', () => {
    const out = pseudoLocalise({ a: 'hello', nested: { b: 'x' } });
    expect(out.a.startsWith('«')).toBe(true);
    expect(out.a.endsWith('»')).toBe(true);
    expect(out.a.length).toBeGreaterThan('hello'.length * 1.5);
    expect(out.nested.b).toContain('x');
  });

  it('leaves the key structure untouched', () => {
    const source = ja as unknown as Tree;
    expect(paths(pseudoLocalise(source))).toEqual(paths(source));
  });
});

// --------------------------------------------------- フォントサブセット (§5.3)

describe('collectGlyphs', () => {
  it('collects every distinct character, sorted by code point', () => {
    const glyphs = collectGlyphs({ a: 'cab', b: { c: 'ba' } });
    expect(glyphs).toEqual(['a', 'b', 'c']);
  });

  it('counts CJK separately, since that is what drives the subset size', () => {
    expect(countCjk(collectGlyphs({ a: '錯視 illusion' }))).toBe(2);
  });

  it('keeps the museum inside a subset that can plausibly stay under 50 KB', () => {
    const glyphs = collectGlyphs(ja as unknown as Tree, en as unknown as Tree);
    // §5.3 は「使用グリフは数百字程度なので 50KB 以下に収まる」と見積もっている
    expect(countCjk(glyphs)).toBeLessThan(1200);
    expect(glyphs.length).toBeGreaterThan(200);
  });
});
