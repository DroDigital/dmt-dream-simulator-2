import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] },
  },
  webServer: { command: 'npx vite --port 5174 --strictPort', port: 5174, reuseExistingServer: true, timeout: 60_000 },
  snapshotPathTemplate: 'tests/e2e/baselines/{arg}{ext}',
});
