# pebble-navi

Pebble smartwatch navigation app. C (watch) + TypeScript (phone JS).

## Build & run

```sh
npm run tsc          # TS compile only
npm run bundle       # esbuild bundle (after tsc)
npm run build        # tsc + pebble build (full)
npm run start        # build + install to emery emulator
npm run debug        # build + install + logs
npm run push         # build + install to phone
npm run format       # prettier --write src/**/*.ts
```

Prerequisites: Pebble SDK at `~/Library/Application Support/Pebble SDK/SDKs/current/`.

## Architecture

- **`src/c/`** — Watch C code (`main.c` entry, `navigation.c` map layer/bitmap rendering, `menu.c` menu overlay).
- **`src/pkjs/`** — Phone-side TypeScript, compiled to JS in the same directory (`.gitignore` ignores `src/**/*.js`). **`old_index.tsx` is the real working entrypoint**; `index.ts` is an incomplete rewrite.
- `server/` — OSM tile fetch, routing (OSRM), render to Pebble palette, localStorage cache.
- `build-pkjs.js` — esbuild bundles `src/pkjs/index.js` + Pebble SDK shared additions into `build/pebble-js-app.js`.

## Key quirks

- `tsconfig.json` uses `ignoreDeprecations: "6.0"` (TS 6.x + ES5 target).
- Message keys are defined in `package.json` `pebble.messageKeys`. `CMakeLists.txt` generates `message_keys.auto.h` from them (CLion IDE support only; real build uses `waf`).
- Targets: `emery`, `gabbro`.
- RLE-compressed bitmap chunks sent via `AppMessage`.
- No tests.
- Must use `npm run tsc` before `npm run bundle` (no `tsc` in bundle script).
