# DMT: Dream Simulator

*Dream Memory Transit* — a first-person playable dream for 1–4 local players on one screen.
No engine: TypeScript + three (WebGPU / TSL) + Rapier + bitecs + Tone.js.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the game (Vite dev server) |
| `npm test` | Vitest unit + determinism tests |
| `npm run test:e2e` | Playwright visual / e2e tests |
| `npm run build:web` | Static web build in `dist/` |
| `npm run import` | `assets/raw/<pack>` → `assets/built/<pack>` (weld, simplify, palette-quantise, Meshopt, KTX2, sidecars, manifest) |
| `npm run make-test-pack` | Writes a procedural CC0 test pack into `assets/raw/` |
| `npm run realmgen -- --realm evening-suburb --count 100` | Generate + validate realm layouts, write metrics |
| `npm run validate-data` | Validate `data/` and realm kits against JSON Schemas |

## Layout

See `docs/` and the build brief. `src/core` loop/rng/input, `src/director` night & visit systems,
`src/realms/<realm>/{kit,rules,fixed}.json`, `src/render` lo-fi pipeline, `tools/` content pipeline.
