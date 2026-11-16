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
import { PhotoMode } from './ui/photo.ts';
import { loadGlyphFonts } from './render/glyph/atlas.ts';
import { loadSlot, saveSlot, DEFAULT_PROFILE, type JournalPage, type SaveData } from './core/saves.ts';
import { JournalUI, polaroidFromPixels } from './ui/journal.ts';
import { MorningMenu, encodeDreamCode } from './ui/morning.ts';
import { diaryFragment, makePoem } from './ui/poem.ts';
import { AfterimagePlayer } from './director/afterimage.ts';
import { AtlasUI } from './ui/atlas.ts';
import { tuning as tuningLive } from './core/tuning.ts';
import type { InputFrame } from './core/input.ts';

const params = new URLSearchParams(location.search);

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  await initPhysics();
  const view = await View.create(canvas, params.has('webgl'));
  const runSeed = params.has('seed') ? Number(params.get('seed')) : hashString(new Date().toDateString());
  const capture = params.has('capture');
  const slot = Number(params.get('slot') ?? 0);
  const save: SaveData | null = params.has('fresh') || capture ? null : await loadSlot(slot);
  let afterimage: AfterimagePlayer | null = null;
  let game: Game;
  if (params.has('afterimage') && save?.lastNight && !save.lastNight.erased) {
    afterimage = new AfterimagePlayer(save.lastNight);
    game = afterimage.game;
  } else {
    game = new Game({
      runSeed: save?.household.runSeed ?? runSeed, household: save ? structuredClone(save.household) : undefined,
      players: Number(params.get('players') ?? 1), startRealm: capture ? 'evening-suburb' : params.get('realm') ?? undefined,
      instantTransitions: params.has('instant'), drift: params.has('drift'),
    });
    if (save) game.eventCooldown = new Map(save.eventCooldown);
  }
  const journal: JournalPage[] = save?.journal ?? [];
  let lastNight = save?.lastNight ?? null;
  const profiles = save?.profiles ?? [structuredClone(DEFAULT_PROFILE)];
  const persist = () => saveSlot(slot, {
    household: game.household, eventCooldown: [...game.eventCooldown.entries()], profiles, lastNight, journal, unlocked: [],
  });
  game.diaryKeywords = diaryFragment(game.runSeed, game.night).keywords;
  view.attach(game);
  const prewarm = new Prewarmer(game);
  await loadGlyphFonts();
  const photo = new PhotoMode(game, view, ui, canvas);
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
      if (photo.active) return; // the dream is frozen
      const frames = script ? script(game) : input.sample(dt, first);
      first = false;
      game.step(frames);
    },
    render: (alpha, frameDt) => {
      first = true;
      photo.update(frameDt);
      view.render(game, photo.active ? 1 : alpha, frameDt);
      photo.afterRender();
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
    game, view, loop, input, telemetry, tuning: tuningLive,
    setScript(fn: typeof script) { script = fn; },
  };

  if (capture) script = setupCapture(game);

  // ---- journal, morning menu, saves ----
  const journalUI = new JournalUI(ui);
  const atlasUI = new AtlasUI(ui);
  const morning = new MorningMenu(ui, {
    code: (c) => { game.codeNight = c; telemetry.track('dream_code_entered', {}); },
    afterimage: () => { location.search = `?afterimage&slot=${slot}`; },
    canAfterimage: () => game.night >= 20 && !!lastNight && !lastNight.erased,
    currentCode: () => encodeDreamCode(game.codeNight ?? { runSeed: game.runSeed, night: game.night, laws: [] }),
  });
  game.events.on('nightEnd', () => {
    if (afterimage) return; // reliving a night writes nothing
    const night = game.night; // still tonight's number at this moment
    const h = game.household;
    const photos = game.dreamers.map((d) => view.bestFrames[d.index]).filter((x): x is NonNullable<typeof x> => !!x).map((b) => polaroidFromPixels(b.px, 192, 108));
    const dots = game.dreamers.map((d) => ({ dreamer: d.index, x: d.chart[0], y: d.chart[1] }));
    const gx = dots.reduce((a, d) => a + d.x, 0) / dots.length, gy = dots.reduce((a, d) => a + d.y, 0) / dots.length;
    const page: JournalPage = {
      night, photos, poem: makePoem(game.nightSeed, game.tagsTonight), laws: [...game.laws], dots, group: [gx, gy],
      realms: [...new Set(game.dreamers.flatMap((d) => d.links))], diary: diaryFragment(game.runSeed, night).text,
    };
    queueMicrotask(() => {
      journal.push(page);
      lastNight = game.lastNight;
      game.diaryKeywords = diaryFragment(game.runSeed, game.night).keywords;
      void persist();
      setTimeout(() => {
        const hist = h.groupDots.map(([x, y], i) => ({ x, y, age: h.groupDots.length - 1 - i }));
        journalUI.show(page, hist);
        document.exitPointerLock?.();
      }, 1600);
    });
  });
  game.events.on('place', () => { if (game.mode === 'morning' && !afterimage) void persist(); });
  window.addEventListener('keydown', (e) => {
    if (journalUI.open && e.code !== 'F3') { journalUI.hide(); return; }
    if (atlasUI.open) { atlasUI.hide(); return; }
    if (e.code === 'KeyA' && game.mode === 'morning' && e.shiftKey) { atlasUI.show(game.household.atlas ?? {}); document.exitPointerLock?.(); }
    if (e.code === 'Tab' && game.mode === 'morning') { e.preventDefault(); morning.toggle(); }
    if (e.code === 'KeyJ' && game.mode === 'morning' && journal.length) {
      const h = game.household;
      journalUI.show(journal[journal.length - 1], h.groupDots.map(([x, y], i) => ({ x, y, age: h.groupDots.length - 1 - i })));
    }
    if (e.code === 'F4') {
      // playtest export: local telemetry ring buffer as JSON (never sent anywhere)
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([telemetry.exportJson()], { type: 'application/json' }));
      a.download = `dmt-telemetry-${new Date().toISOString().slice(0, 19)}.json`;
      a.click();
      e.preventDefault();
    }
  });
  if (afterimage) {
    view.postcards.build(view.renderer, game);
    const player = afterimage;
    script = (g) => {
      const live: InputFrame[] = input.sample(1 / 60, false);
      return player.frames(live.length ? live : undefined).slice(0, g.dreamers.length);
    };
    telemetry.track('afterimage_start', {});
  }
  void tuningLive;
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
