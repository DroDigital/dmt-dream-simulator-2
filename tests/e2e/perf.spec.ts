import { expect, test } from '@playwright/test';

declare global { interface Window { __dmt: any } }

/**
 * Performance capture (§11): per-pane draw calls and triangles on a scripted walk through several
 * realms (hardware-independent budget: < 300 draw calls, < 400k triangles per pane). Frame times are
 * logged too, but this container renders in software (SwiftShader), so they are not the 60 fps target.
 */
const RUNS: [number, string][] = [[1, ''], [2, ''], [4, ''], [1, 'lantern-market'], [1, 'fractal-reef'], [1, 'static-field']];
for (const [players, realm] of RUNS) {
  test(`budget per pane with ${players} player(s) ${realm}`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto(`/?autostart&seed=21&webgl&fresh&mute&players=${players}${realm ? `&realm=${realm}` : ''}`);
    await page.waitForFunction(() => window.__dmt, null, { timeout: 90_000 });
    await page.evaluate(() => {
      window.__dmt.setScript((g: any) => g.dreamers.map((d: any, i: number) => (g.mode === 'morning'
        ? { mx: 0, mz: 0, lx: 0, ly: 0, buttons: d.state === 'lying' ? 0 : 16 }
        : { mx: 0.2 * (i % 2 ? 1 : -1), mz: 1, lx: 0.004, ly: 0, buttons: 0 })));
      (window as any).__perfLog = [];
      setInterval(() => {
        const v = window.__dmt.view;
        (window as any).__perfLog.push({ fps: v.fps, panes: v.panes.map((p: any) => ({ ...p.pipe.stats })), realms: window.__dmt.game.dreamers.map((d: any) => d.visit.realm) });
      }, 1000);
    });
    await page.waitForFunction(() => window.__dmt.game.mode === 'night', null, { timeout: 180_000 });
    await page.waitForTimeout(25_000);
    const log = await page.evaluate(() => (window as any).__perfLog.filter((x: any) => x.panes.length));
    const maxCalls = Math.max(...log.flatMap((x: any) => x.panes.map((p: any) => p.drawCalls)));
    const maxTris = Math.max(...log.flatMap((x: any) => x.panes.map((p: any) => p.triangles)));
    console.log(`players ${players}: max draw calls/pane ${maxCalls}, max triangles/pane ${maxTris}, realms ${[...new Set(log.flatMap((x: any) => x.realms))].join(',')}, software fps ~${log[log.length - 1]?.fps?.toFixed(1)}`);
    expect(maxCalls).toBeGreaterThan(0);
    expect(maxCalls).toBeLessThan(300);
    expect(maxTris).toBeLessThan(400_000);
  });
}
