import { expect, test } from '@playwright/test';

declare global { interface Window { __lab: any } }

test.describe('M2G Glyph Suite', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('edge test: >= 90% of silhouette cells use a matching edge glyph', async ({ page }) => {
    await page.goto('/glyph-lab?webgl&nopanel&manual&test=cube');
    await page.waitForFunction(() => window.__lab, null, { timeout: 90_000 });
    const r = await page.evaluate(() => window.__lab.edgeTest());
    console.log('edge', JSON.stringify(r));
    expect(r.total).toBeGreaterThan(50);
    expect(r.share).toBeGreaterThanOrEqual(0.9);
  });

  test('stability + photosensitivity over a 120-frame slow pan', async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto('/glyph-lab?webgl&nopanel&manual');
    await page.waitForFunction(() => window.__lab, null, { timeout: 90_000 });
    const on = await page.evaluate(() => window.__lab.stability(120));
    const off = await page.evaluate(() => window.__lab.stability(120, { hysteresis: 0, holdFrames: 0 }));
    console.log('stability', JSON.stringify({ on, off }));
    expect(on.changeRate).toBeLessThan(0.03);
    expect(off.changeRate).toBeGreaterThan(on.changeRate * 3);
    expect(on.maxFlipsPerSec).toBeLessThanOrEqual(3);
    expect(off.maxFlipsPerSec).toBeLessThanOrEqual(3); // the flip limit holds even without hysteresis
  });
});

test.describe('M2G preset snapshots', () => {
  test.use({ viewport: { width: 960, height: 540 } });
  test('one screenshot per preset matches its approved baseline', async ({ page }) => {
    test.setTimeout(900_000);
    await page.goto('/glyph-lab?webgl&nopanel&manual');
    await page.waitForFunction(() => window.__lab, null, { timeout: 90_000 });
    const ids: string[] = await page.evaluate(() => window.__lab.shotPresets());
    expect(ids.length).toBeGreaterThanOrEqual(16);
    for (const id of ids) {
      await page.evaluate((id) => { window.__lab.setPreset(id, { ripples: false }); for (let i = 0; i < 6; i++) window.__lab.frame(5 + i / 60); }, id);
      await expect(page).toHaveScreenshot(`preset-${id}.png`, { maxDiffPixelRatio: 0.03 });
    }
  });
});
