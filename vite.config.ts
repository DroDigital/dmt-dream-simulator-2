import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
  },
} as never);
