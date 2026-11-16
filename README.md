# DMT: Dream Simulator

*Dream Memory Transit*: a first-person playable dream for 1–4 local players on one screen.
No engine: TypeScript + three (WebGPU / TSL, WebGL 2 fallback) + Rapier + bitecs + Tone.js.

Each night is a short dream. Walk through strange low-poly realms; touching almost anything carries
you to another realm. Notice the dream's oddities, become lucid, steer where you go, carry one
souvenir home and arrange it in your room to shape tomorrow's dream.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
```

URL options: `?seed=N`, `?players=1..4`, `?realm=<id>` (start realm), `?webgl` (force WebGL 2),
`?fresh` (ignore the save), `?slot=0..2`, `?drift`, `?instant`, `?debug` (F3 overlay), `?capture`
(the §4 capture scenario). Dev only: `/glyph-lab` (Glyph Suite lab with Tweakpane).

## Controls

| | Keyboard + mouse | Gamepad |
|---|---|---|
| Walk / drift | WASD, Shift | Left stick, L3 |
| Look | Mouse | Right stick |
| Blink (hold at Clear: free-link ring) | Right mouse | B |
| Interact (souvenirs, hands, phones, lantern) | Left mouse | X |
| Float | Hold Space | Hold A |
| Lie down (sleep / wake) | Hold C 2 s | Hold D-pad down 2 s |
| Quick turn | Q / E | LB / RB |
| Photo mode | P | View |

In the Lantern Flat (morning): **Tab** dream code / Daily Dream / Afterimage, **J** last journal page,
**Shift+A** Atlas, **O** settings, **F4** export local telemetry (never sent anywhere).
Extra players join by pressing a button on a gamepad in the Flat.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the game (Vite dev server) |
| `npm test` | Vitest: RNG, realmgen + validator, determinism, Afterimage replay, systems, Watcher, co-op, glyph math, content, 20-night bot playtest |
| `npm run test:e2e` | Playwright: night loop, Glyph Suite edge/stability/flip tests + preset baselines, per-pane budgets |
| `npm run build:web` | Static web build in `dist/` |
| `npm run build:desktop` | Electron packages (needs `electron` + `@electron/packager`, see below) |
| `npm run import` | `assets/raw/<pack>` → `assets/built/<pack>` (licence gate, weld/simplify, palette-quantise + Bayer, Meshopt, KTX2, sidecars, manifest) |
| `npm run make-test-pack` | Writes a procedural CC0 test pack into `assets/raw/` |
| `npm run realmgen -- --realm <id> --count 100` | Generate + validate realm layouts, write metrics |
| `npm run validate-data` | Validate `data/` and realm kits against JSON Schemas |

## Layout

```
src/core       loop, rng (PCG32), input, physics (Rapier wrapper), saves, telemetry, platform
src/director   Game sim, visits, Director (anomalies, events, Lanternfolk), household + night plan,
               resonance chart, Afterimage, dream codes, visions
src/realms     one folder per realm (kit/rules/fixed JSON), WFC + validator, Flat + special realms
src/entities   bitecs components, Watcher, creatures (drifters, book-fish, moths)
src/gameplay   movement, linking, lucidity
src/render     lo-fi materials, per-pane pipeline, realm views, Glyph Suite, Paper ports, visions
src/audio      generative score (Tone.js)
src/ui         title, journal, morning menu, atlas, settings, credits, photo mode
data/          laws, events, souvenirs, sets, diary, phrases, visions, glyph styles, tuning, schemas
tools/         import, realmgen (+ kit generator), content generator, validate-data
docs/media     captures (the §4 shot, the M2G glyph capture)
```
