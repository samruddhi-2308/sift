import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@sift/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@sift/db': path.resolve(__dirname, './packages/db/src/index.ts'),
      '@sift/queue': path.resolve(__dirname, './packages/queue/src/index.ts'),
      '@sift/embeddings': path.resolve(__dirname, './packages/embeddings/src/index.ts'),
      '@sift/search': path.resolve(__dirname, './packages/search/src/index.ts'),
    },
  },
});
