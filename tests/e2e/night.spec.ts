import { expect, test } from '@playwright/test';

declare global { interface Window { __dmt: any } }

const LIE = 16;

test('M1: flat -> lie down -> evening suburb renders with the lo-fi pass', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?autostart&seed=1&webgl');
  await page.waitForFunction(() => window.__dmt, null, { timeout: 60_000 });
  await page.evaluate((LIE) => {
    window.__dmt.setScript((g: any) => g.dreamers.map((d: any) => (g.mode === 'morning'
      ? { mx: 0, mz: 0, lx: 0, ly: 0, buttons: d.state === 'lying' ? 0 : LIE }
      : { mx: 0, mz: 1, lx: 0.003, ly: 0, buttons: 0 })));
  }, LIE);
  await page.waitForFunction(() => window.__dmt.game.mode === 'night', null, { timeout: 120_000 });
  expect(await page.evaluate(() => window.__dmt.game.dreamers[0].visit.realm)).toBe('evening-suburb');
  await page.waitForTimeout(3000);
  // the low-res scene target is 480 wide at 16:9 (vertex snap + upscale active)
  const low = await page.evaluate(() => [window.__dmt.view.panes[0].pipe.lowW, window.__dmt.view.panes[0].pipe.lowH]);
  expect(low).toEqual([480, 270]);
  const shot = await page.screenshot();
  expect(shot.byteLength).toBeGreaterThan(50_000); // not a blank frame
  expect(errors).toEqual([]);
});
