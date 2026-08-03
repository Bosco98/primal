import { expect, test } from '@playwright/test';

/**
 * Phase 0 acceptance: the pose pipeline runs in a real browser.
 *
 * Chrome's fake device streams a synthetic pattern rather than a person, so no
 * pose is detected and no reps are counted — that is expected and not what this
 * checks. What it does check is that the camera opens, the WASM fileset and the
 * 5.7MB model load, and `detectForVideo` is called every frame without
 * throwing.
 */
test('starts the camera and runs inference without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /your body is the controller/i })).toBeVisible();

  await page.getByRole('button', { name: /enable camera/i }).click();

  // Model download plus WASM init is the slow part of a cold start.
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible({ timeout: 60_000 });

  const stat = (label: string) =>
    page.locator('.stats dt', { hasText: new RegExp(`^${label}$`) }).locator('+ dd');

  // A delegate is only assigned once the landmarker is constructed.
  await expect(stat('Delegate')).toHaveText(/GPU|CPU/);

  // Frames must actually be flowing, not merely initialised.
  //
  // The bar is deliberately low. Headless Chromium renders through SwiftShader,
  // a software GL implementation, where inference costs an order of magnitude
  // more than on real hardware — single-digit FPS here says nothing about the
  // frame budget on a user's machine. This asserts the loop is alive; the real
  // performance number comes from running this suite headed
  // (`npm run test:e2e:headed`), which uses the actual GPU.
  await expect
    .poll(async () => Number(await stat('Pose FPS').innerText()), { timeout: 30_000 })
    .toBeGreaterThan(1);

  console.log(
    `[pipeline] delegate=${await stat('Delegate').innerText()} ` +
      `fps=${await stat('Pose FPS').innerText()} ` +
      `inference=${await stat('Inference').innerText()} ` +
      `dropped=${await stat('Dropped').innerText()}`,
  );

  expect(consoleErrors.filter((text) => !isBenign(text))).toEqual([]);
});

test('asks the player to step into frame when nobody is detected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /enable camera/i }).click();
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible({ timeout: 60_000 });

  // The synthetic stream contains no person, so calibration must stall here
  // rather than inventing a baseline from noise.
  await expect(page.locator('.banner')).toContainText(/step into view/i);
  await expect(page.locator('.count')).toHaveText('0');
});

test('records and downloads a pose sample from the camera overlay', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'primal.baseline.v3',
      JSON.stringify({
        standingHipY: 0.52,
        standingShoulderY: 0.29,
        standingKneeAngle: 172,
        torsoLength: 0.23,
        shoulderWidth: 0.18,
        centerX: 0.5,
        ankleY: 0.92,
        standingAnkleSpread: 0.45,
        standingWristRise: -1,
        capturedAt: 1,
      }),
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: /enable camera/i }).click();
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible({ timeout: 60_000 });

  const preview = page.locator('.preview');
  const record = preview.getByRole('button', { name: 'Export debug sample' });
  await expect(record).toBeEnabled();
  await record.click();
  await expect(preview.getByText(/Recording · \d+s/)).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Download debug sample' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Download debug sample' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^primal-squat-\d+\.pose\.json$/);
  await expect(preview.getByText(/Saved primal-squat-/)).toBeVisible();
});

test('starts and cancels hands-free exercise calibration beside the camera', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'primal.baseline.v3',
      JSON.stringify({
        standingHipY: 0.52,
        standingShoulderY: 0.29,
        standingKneeAngle: 172,
        torsoLength: 0.23,
        shoulderWidth: 0.18,
        centerX: 0.5,
        ankleY: 0.92,
        standingAnkleSpread: 0.45,
        standingWristRise: -1,
        capturedAt: 1,
      }),
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: /enable camera/i }).click();
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible({ timeout: 60_000 });

  const preview = page.locator('.preview');
  await preview.getByRole('button', { name: 'Learn my Squat' }).click();
  await expect(preview.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(preview.getByRole('status')).toContainText(/ready position|hold/i);
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview.getByText(/using the default movement range/i)).toBeVisible();
});

/** Noise from the graphics stack and the fake device, not from our code. */
function isBenign(text: string): boolean {
  return (
    /SwiftShader|swiftshader|WebGL|GPU stall|Automatic fallback|deprecated/i.test(text) ||
    text.includes('Failed to load resource: net::ERR_FAILED') === false && text.trim() === ''
  );
}
