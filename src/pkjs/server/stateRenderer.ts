import { TILE_SIZE, getTile, worldPixel } from './osm.js';
import { fetchRoute, findNextStep, type RouteResult, type RouteStep } from './routing.js';
import { renderMap } from './renderer.js';
import { quantizeToPebble, quantizeToPebble2Bit } from './pebble-palette.js';

export interface MapState {
  currentPos: { lat: number; lng: number };
  bearing?: number;
  origin?: { lat: number; lng: number };
  dest?: { lat: number; lng: number };
  zoom: number;
  mode: string;
  width: number;
  height: number;
}

export interface RenderOutput {
  pixels: Uint8Array;
  route?: RouteResult;
  nextStep?: {
    step: RouteStep;
    remainingDist: number;
  };
}

export async function renderForState(
  s: MapState,
  existingRoute?: RouteResult,
  isFlint?: boolean,
): Promise<RenderOutput> {
  let center = s.currentPos || s.origin;

  const centerPx = worldPixel(center.lat, center.lng, s.zoom);
  const vl = centerPx.wx - s.width / 2;
  const vt = centerPx.wy - s.height / 2;

  const tx0 = Math.floor(vl / TILE_SIZE);
  const ty0 = Math.floor(vt / TILE_SIZE);
  const tx1 = Math.floor((vl + s.width - 1) / TILE_SIZE);
  const ty1 = Math.floor((vt + s.height - 1) / TILE_SIZE);

  const tilePromises: Promise<{ tx: number; ty: number; buffer: Uint8Array } | null>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      tilePromises.push(
        getTile(s.zoom, tx, ty).then((buf) => (buf ? { tx, ty, buffer: buf } : null)),
      );
    }
  }
  const tileResults = await Promise.all(tilePromises);
  const tiles = tileResults.filter(
    (t): t is { tx: number; ty: number; buffer: Uint8Array } => t !== null,
  );

  const route =
    existingRoute ??
    (s.dest && s.origin ? ((await fetchRoute(s.origin, s.dest, s.mode)) ?? undefined) : undefined);

  const rgba = renderMap({
    width: s.width,
    height: s.height,
    zoom: s.zoom,
    center,
    start: s.origin,
    dest: s.dest,
    currentPos: s.currentPos,
    bearing: s.bearing,
    route,
    tiles,
  });

  const pixels = isFlint
    ? quantizeToPebble2Bit(rgba, s.width, s.height).pixels
    : quantizeToPebble(rgba, s.width, s.height).pixels;

  let nextStep: { step: RouteStep; remainingDist: number } | undefined;
  if (route && s.currentPos) {
    const ns = findNextStep(route, s.currentPos);
    if (ns) nextStep = ns;
  }

  return {
    pixels,
    route,
    nextStep,
  };
}
