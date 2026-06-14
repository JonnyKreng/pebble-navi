# Store listsings
https://apps.rebble.io/en_US/application/6a2ec9ab000bc200090963fc
https://apps.repebble.com/e5e4d6c0ecbd44b980379456

# Navi App

Turn-by-turn navigation for Pebble smartwatches.

![emery](screenshots/emery1.png)
![emery](screenshots/emery2.png)
![emery](screenshots/emery3.png)
![emery](screenshots/emery4.png)
![emery](screenshots/emery5.png)

![gabbro](screenshots/gabbro1.png)
![gabbro](screenshots/gabbro2.png)
![gabbro](screenshots/gabbro3.png)
![gabbro](screenshots/gabbro4.png)
![gabbro](screenshots/gabbro5.png)

![chalk](screenshots/chalk1.png)
![chalk](screenshots/chalk2.png)
![chalk](screenshots/chalk3.png)
![chalk](screenshots/chalk4.png)
![chalk](screenshots/chalk5.png)

![basalt](screenshots/basalt1.png)
![basalt](screenshots/basalt2.png)
![basalt](screenshots/basalt3.png)
![basalt](screenshots/basalt4.png)
![basalt](screenshots/basalt5.png)

![aplite/diorite/flint](screenshots/aplite_diorite_flint1.png)
![aplite/diorite/flint](screenshots/aplite_diorite_flint2.png)
![aplite/diorite/flint](screenshots/aplite_diorite_flint3.png)
![aplite/diorite/flint](screenshots/aplite_diorite_flint4.png)
![aplite/diorite/flint](screenshots/aplite_diorite_flint5.png)

## Features

- Turn-by-turn navigation on your wrist
- Map rendering with OpenStreetMap tiles
- Destination selection from saved locations
- Save current location
- Rotation mode — follow your heading
- Supports Pebble Time 2 (emery), Pebble Time Round (gabbro/chalk), Pebble Time/Time Steel (basalt), and Pebble 2/Classic (aplite/diorite/flint)

## Architecture

- **`src/c/`** — Watch C code
  - `main.c` — App entry point, message handling, routing state
  - `navigation.c` / `navigation.h` — Map layer rendering, bitmap management, rotation
  - `menu.c` / `menu.h` — Menu overlay for destination selection
- **`src/pkjs/`** — Phone-side TypeScript (compiled to JS in-place)
  - `index.ts` — App lifecycle, Pebble AppMessage handling
  - `map-handler.ts` — Tile coordinate fetch, render-to-chunks pipeline
  - `destionations.ts` — Destination list management
  - `message-queue.ts` — Serialized AppMessage delivery with ack/nack tracking
  - `helper.ts` — Settings persistence, RLE encoding, ASCII normalization
  - `settings.ts` — Settings page (destinations, units)
  - `server/` — OSM tile fetch, routing (OSRM), Pebble-palette rendering, localStorage cache
    - `osm.ts` — Tile URL construction and coordinate math
    - `routing.ts` — OSRM route request and response parsing
    - `renderer.ts` — Tile compositing and route overlay
    - `stateRenderer.ts` — Full map state → bitmap render pipeline
    - `pebble-palette.ts` — Image quantization to Pebble's 64-color palette
    - `tile-cache.ts` — LocalStorage tile caching with LRU eviction
    - `polyfills.ts` — ES5 compatibility shims

RLE-compressed bitmap chunks are sent to the watch via `AppMessage`.

## Build

```sh
npm run tsc          # TypeScript compile only
npm run build        # tsc + pebble build (full)
npm run start        # build + install to emery emulator
npm run push         # build + install to phone
npm run format       # prettier --write "src/**/*.ts"
```

Requires the [Pebble SDK](https://developer.rebble.io/)

## Getting Started

```sh
# Clone and install dependencies
git clone https://github.com/jonny/pebble-navi
cd pebble-navi
npm install

# Run on the emery (Pebble Time 2) emulator
npm run start

# Run on gabbro (Pebble Time Round) emulator
npm run debug-round-2

# Build and install to a phone via Pebble app
npm run push

# Debug (build + install + logs)
npm run debug-time-2   # emery
npm run debug-round-2  # gabbro
npm run debug-duo      # flint
```

Before running, start the Pebble emulator from the Pebble SDK, or connect your phone with the Pebble app.

## Phone Settings

Once installed, open the app in the Pebble mobile app and tap the gear icon to configure:

- **Saved Destinations** — Add locations by address or raw `lat,lng` coordinates; delete existing ones
- **Units** — Metric or imperial

Settings are persisted in the phone's `localStorage`.

## Key Details

-   `tsconfig.json` uses `ignoreDeprecations: "6.0"` (TS 6.x, ES5 target).
-   Message keys are defined in `package.json` `pebble.messageKeys`. `CMakeLists.txt` generates `message_keys.auto.h` for CLion IDE support; the real build uses `waf`.
-   Targets: `emery`, `gabbro`, `chalk`, `basalt`, `aplite`, `diorite`, `flint`.

## Data Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org) contributors (ODbL).
Routing via [OSRM](http://project-osrm.org/).
See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for details.

## License

[GNU General Public License v3.0](LICENSE)
