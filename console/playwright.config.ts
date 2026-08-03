import { defineConfig } from '@playwright/test';

/**
 * Browser-level checks that vitest cannot make.
 *
 * The unit suite proves the recognisers are correct given frames; this suite
 * proves frames actually arrive — that getUserMedia, the MediaPipe WASM fileset,
 * the model download and the inference loop all work in a real browser. That
 * integration is the part most likely to break silently on an upgrade.
 *
 * Chrome's fake capture device supplies a synthetic video stream, so this runs
 * with no webcam and nobody in the room.
 */
/**
 * Software GL makes headless runs reproducible, but it also makes inference
 * roughly two orders of magnitude slower than real hardware. Set
 * PRIMAL_REAL_GPU=1 to drop these and measure honest performance.
 */
const SOFTWARE_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const useRealGpu = process.env.PRIMAL_REAL_GPU === '1';
const port = process.env.PRIMAL_E2E_PORT ?? '5173';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        ...(useRealGpu ? [] : SOFTWARE_GL_ARGS),
      ],
    },
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: port === '5173',
    timeout: 60_000,
  },
});
