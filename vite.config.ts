import { defineConfig } from 'vitest/config';

// GitHub Pages 配信を想定して base を切り替える。
// ルート配信（Netlify / Cloudflare Pages）なら BASE_PATH=/ を渡す。
const base = process.env.BASE_PATH ?? '/';

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
