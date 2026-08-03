import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:8099/?debug', { waitUntil: 'networkidle' });

// Play properly: keep intensity up and actually dodge.
const until = Date.now() + 14000;
let n = 0;
while (Date.now() < until) {
  await p.keyboard.press('Space');
  await p.mouse.move(340 + (n % 5) * 140, 200 + (n % 4) * 110);
  await p.waitForTimeout(180);
  await p.keyboard.down('KeyC'); await p.waitForTimeout(160); await p.keyboard.up('KeyC');
  await p.mouse.move(980 - (n % 5) * 120, 260 + (n % 3) * 100);
  await p.waitForTimeout(200);
  n++;
}
console.log(JSON.stringify(await p.evaluate(() => {
  const w = window.__world;
  return { elapsed: +w.elapsed.toFixed(1), phase: w.phase.id, gap: +w.gap.toFixed(1),
    score: w.score, combo: w.combo, coins: w.coins.filter(c=>!c.taken).length,
    collected: w.coinsCollected, hits: w.hits, nearMisses: w.nearMisses,
    movements: w.movements, total: w.totalMovements, consoleScore: w.consoleScore };
}), null, 2));
await p.screenshot({ path: '/tmp/game-active.png' });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
