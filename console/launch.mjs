import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ permissions: ['camera'], viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('https://bosco98.github.io/primal/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.locator('button.primary').click();
await p.waitForTimeout(8000);

const card = p.locator('.library__card');
console.log('card title:', await card.locator('strong').textContent());
await card.locator('button').click();

// The bug: this used to sit on "Connecting to the game…" forever.
for (let i = 0; i < 14; i++) {
  await p.waitForTimeout(1500);
  const curtain = await p.locator('.game-stage__curtain p').textContent().catch(() => null);
  if (curtain === null) { console.log(`t+${(i+1)*1.5}s: curtain GONE -> running`); break; }
  console.log(`t+${(i+1)*1.5}s: "${curtain}"`);
}
await p.screenshot({ path: '/tmp/live-launch.png' });
console.log('errors:', errs.length ? errs.slice(0,4) : 'none');
await b.close();
