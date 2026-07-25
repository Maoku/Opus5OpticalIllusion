// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** 日本語（ひらがな・カタカナ・漢字）を含む文字列リテラルを検出するセレクタ。
 *  §8「i18n を後付けする誘惑」への対策: 文言は必ず src/i18n/ 経由にする。 */
const CJK_LITERAL = 'Literal[value=/[\\u3040-\\u30ff\\u4e00-\\u9fff]/]';
const CJK_TEMPLATE = 'TemplateElement[value.raw=/[\\u3040-\\u30ff\\u4e00-\\u9fff]/]';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'temp/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // 文言のハードコード禁止。辞書 (src/i18n) とテストのみ例外。
    files: ['src/**/*.ts'],
    ignores: ['src/i18n/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: CJK_LITERAL,
          message: 'Japanese text must live in src/i18n dictionaries, not in code.',
        },
        {
          selector: CJK_TEMPLATE,
          message: 'Japanese text must live in src/i18n dictionaries, not in code.',
        },
      ],
    },
  },
  prettier,
);
