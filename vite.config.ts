import { defineConfig } from 'vitest/config';

// 既定は相対パス出力。dist/ をルートに置いても GitHub Pages のような
// サブパスに置いても、同じ成果物がそのまま動く。
// 絶対パスが必要な配信先では BASE_PATH=/ などを渡して上書きする。
const base = process.env.BASE_PATH ?? './';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
