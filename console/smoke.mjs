import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto('http://localhost:8099/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);   // let the sim run and obstacles spawn

// Play a bit: jump, duck, lean, reach.
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await page.keyboard.down('KeyC'); await page.waitForTimeout(150); await page.keyboard.up('KeyC');
  await page.keyboard.down('KeyD'); await page.waitForTimeout(350); await page.keyboard.up('KeyD');
  await page.mouse.move(300 + i * 90, 250 + (i % 3) * 90);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/game-playing.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
