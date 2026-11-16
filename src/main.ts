/** Entry point: boots physics + renderer, runs the fixed 60 Hz loop, wires input and the View. */
import { initPhysics } from './core/physics.ts';
import { InputSystem } from './core/input.ts';
import { FixedLoop } from './core/loop.ts';
import { telemetry } from './core/telemetry.ts';
import { hashString } from './core/rng.ts';
import { Game } from './director/game.ts';
import { View } from './render/view.ts';
import { showTitle } from './ui/title.ts';
import { setupCapture } from './dev/capture.ts';
import { DT } from './core/tuning.ts';
import { score } from './audio/score.ts';
import { Prewarmer } from './realms/prewarm.ts';

const params = new URLSearchParams(location.search);

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  await initPhysics();
  const view = await View.create(canvas, params.has('webgl'));
  const runSeed = params.has('seed') ? Number(params.get('seed')) : hashString(new Date().toDateString());
  const capture = params.has('capture');
  const game = new Game({
    runSeed, players: Number(params.get('players') ?? 1), startRealm: capture ? 'evening-suburb' : params.get('realm') ?? undefined,
    instantTransitions: params.has('instant'), drift: params.has('drift'),
  });
  view.attach(game);
  const prewarm = new Prewarmer(game);
  const input = new InputSystem();
  input.attach(canvas);
  for (let i = 0; i < game.dreamers.length; i++) input.addPlayer(i === 0 ? 'kbm' : `pad${i - 1}`);
  window.addEventListener('resize', () => view.resize());

  const debug = document.createElement('div');
  debug.className = 'debug';
  debug.style.display = params.has('debug') ? 'block' : 'none';
  ui.appendChild(debug);
  window.addEventListener('keydown', (e) => { if (e.code === 'F3') { debug.style.display = debug.style.display === 'none' ? 'block' : 'none'; e.preventDefault(); } });

  let first = true;
  /** Scripted input source (tests, bots). When set, replaces devices. */
  let script: ((g: Game) => import('./core/input.ts').InputFrame[]) | null = null;
  const loop = new FixedLoop({
    step: (dt) => {
      const frames = script ? script(game) : input.sample(dt, first);
      first = false;
      game.step(frames);
    },
    render: (alpha, frameDt) => {
      first = true;
      view.render(game, alpha, frameDt);
      score.update(game);
      prewarm.update();
      if (debug.style.display !== 'none') {
        const d = game.dreamers[0];
        const s = view.stats();
        debug.textContent = `${view.backend}  ${view.fps.toFixed(0)} fps  calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
          `night ${game.night}  ${game.mode}  breath ${game.breath.toFixed(0)}s  realm ${d.visit.realm}\n` +
          `pos ${d.body.x.toFixed(1)} ${d.body.y.toFixed(1)} ${d.body.z.toFixed(1)}  lucidity ${d.lucidity.toFixed(0)}  links ${game.linkLog.length}`;
      }
    },
  });
  if (params.has('nopause')) { window.removeEventListener('blur', () => {}); }

  // test hook
  (window as unknown as Record<string, unknown>).__dmt = {
    game, view, loop, input, telemetry,
    setScript(fn: typeof script) { script = fn; },
  };

  if (capture) script = setupCapture(game);
  // join: in the Flat, any button on an unassigned device adds a dreamer (lie down on a free futon)
  const joinCheck = () => {
    if (game.mode !== 'morning') return;
    for (const dev of input.joinRequests) {
      if (dev === 'kbm') continue;
      const d = game.addDreamer();
      if (d) input.addPlayer(dev);
    }
  };
  setInterval(joinCheck, 100);

  // deterministic frame stepping for headless capture: advance n sim ticks then render one frame
  (window as unknown as Record<string, unknown>).__advance = (ticks: number) => {
    loop.stop();
    for (let i = 0; i < ticks; i++) game.step(script ? script(game) : input.sample(DT, i === 0));
    view.render(game, 1, ticks * DT);
  };

  const start = () => { score.attach(game); if (!params.has('mute')) score.start().catch(() => {}); loop.start(); input.requestPointerLock(); telemetry.track('session_start', { seed: runSeed }); };
  if (params.has('autostart')) start();
  else showTitle(ui, start);
  window.addEventListener('beforeunload', () => telemetry.track('session_end', {}));
}

const labRoute = location.pathname.endsWith('/glyph-lab') || new URLSearchParams(location.search).has('glyph-lab');
const entry = labRoute && import.meta.env.DEV
  ? import('./dev/glyphlab.ts').then((m) => m.bootGlyphLab(document.getElementById('view') as HTMLCanvasElement, document.getElementById('ui')!))
  : boot();
entry.catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;padding:1em">${String(e?.stack ?? e)}</pre>`);
});
