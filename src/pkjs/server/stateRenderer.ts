import { TILE_SIZE, getTile, worldPixel } from './osm.js';
import { fetchRoute, findNextStep, type RouteResult, type RouteStep } from './routing.js';
import { renderMap } from './renderer.js';
import { quantizeToPebble, quantizeToPebble2Bit } from './pebble-palette.js';

export const EXPAND_FACTOR = 1.3;

export interface MapState {
  currentPos: { lat: number; lng: number };
  bearing?: number;
  origin?: { lat: number; lng: number };
  dest?: { lat: number; lng: number };
  zoom: number;
  mode: string;
  width: number;
  height: number;
  rotationMode: boolean;
}

export interface RenderOutput {
  pixels: Uint8Array;
  route?: RouteResult;
  nextStep?: {
    step: RouteStep;
    remainingDist: number;
  };
  mapTopLeftX: number;
  mapTopLeftY: number;
  mapWidth: number;
  mapHeight: number;
}

export async function renderForState(
  s: MapState,
  existingRoute?: RouteResult,
  isFlint?: boolean,
): Promise<RenderOutput> {
  let center = s.currentPos || s.origin;

  const route =
    existingRoute ??
    (s.dest && s.origin ? ((await fetchRoute(s.origin, s.dest, s.mode)) ?? undefined) : undefined);

  let nextStep: { step: RouteStep; remainingDist: number } | undefined;
  if (route && s.currentPos) {
    const ns = findNextStep(route, s.currentPos);
    if (ns) nextStep = ns;
  }

  const renderW = Math.ceil(s.width * EXPAND_FACTOR);
  const renderH = Math.ceil(s.height * EXPAND_FACTOR);

  const centerPx = worldPixel(center.lat, center.lng, s.zoom);
  const vl = centerPx.wx - renderW / 2;
  const vt = centerPx.wy - renderH / 2;

  const tx0 = Math.floor(vl / TILE_SIZE);
  const ty0 = Math.floor(vt / TILE_SIZE);
  const tx1 = Math.floor((vl + renderW - 1) / TILE_SIZE);
  const ty1 = Math.floor((vt + renderH - 1) / TILE_SIZE);

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

  const rgba = renderMap({
    width: renderW,
    height: renderH,
    zoom: s.zoom,
    center,
    start: s.origin,
    dest: s.dest,
    route,
    tiles,
    userOffsetY: renderH / 2,
  });

  const pixels = isFlint
    ? quantizeToPebble2Bit(rgba, renderW, renderH).pixels
    : quantizeToPebble(rgba, renderW, renderH).pixels;

  return {
    pixels,
    route,
    nextStep,
    mapTopLeftX: vl,
    mapTopLeftY: vt,
    mapWidth: renderW,
    mapHeight: renderH,
  };
}
