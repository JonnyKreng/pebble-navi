import { TILE_SIZE, getTile, worldPixel } from './osm.js';
import {
  fetchRoute,
  findNextStep,
  bearingTo,
  routeProgress,
  type RouteResult,
  type RouteStep,
} from './routing.js';
import { renderMap } from './renderer.js';
import { quantizeToPebble, quantizeToPebble2Bit } from './pebble-palette.js';

let lastBearing: number | undefined;

export const USER_Y_OFFSET = 0.85;

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
  brightness?: number;
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
  isBw: boolean = false,
  userVerticalOffset: number = USER_Y_OFFSET,
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

  if (s.bearing != null) {
    lastBearing = s.bearing;
  }

  let mapRotation: number | undefined;
  if (s.rotationMode) {
    if (nextStep && s.currentPos) {
      mapRotation = -bearingTo(s.currentPos, nextStep.step.location);
    } else if (s.bearing != null) {
      mapRotation = -s.bearing;
    } else if (lastBearing != null) {
      mapRotation = -lastBearing;
    }
  }

  const outUserOffsetY = mapRotation != null ? s.width * userVerticalOffset : undefined;

  let renderW = s.width,
    renderH = s.height;
  if (mapRotation != null) {
    const cosA = Math.abs(Math.cos((mapRotation * Math.PI) / 180));
    const sinA = Math.abs(Math.sin((mapRotation * Math.PI) / 180));
    const maxDY =
      outUserOffsetY != null ? Math.max(outUserOffsetY, s.height - outUserOffsetY) : s.height / 2;
    renderW = Math.ceil(s.width * cosA + 2 * maxDY * sinA) + 1;
    renderH = Math.ceil(s.width * sinA + 2 * maxDY * cosA) + 1;
  }

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

  let renderRoute = route;
  if (route && s.currentPos) {
    const prog = routeProgress(route.coordinates, s.currentPos);
    if (prog.segIdx >= 0) {
      const ahead = route.coordinates.slice(prog.segIdx + 1);
      if (ahead.length >= 2) {
        renderRoute = { ...route, coordinates: ahead, distance: route.distance - prog.cumDist, duration: route.duration * ((route.distance - prog.cumDist) / route.distance) };
      }
    }
  }

  const rgba = renderMap({
    width: renderW,
    height: renderH,
    outputWidth: mapRotation != null ? s.width : undefined,
    outputHeight: mapRotation != null ? s.height : undefined,
    outputUserOffsetY: outUserOffsetY,
    zoom: s.zoom,
    center,
    start: s.origin,
    dest: s.dest,
    currentPos: s.currentPos,
    bearing: s.bearing,
    route: renderRoute,
    tiles,
    userOffsetY: renderH / 2,
    rotation: mapRotation,
    isBw: isBw,
  });

  const pixels = isBw
    ? quantizeToPebble2Bit(rgba, s.width, s.height, s.brightness).pixels
    : quantizeToPebble(rgba, s.width, s.height).pixels;

  return {
    pixels,
    route,
    nextStep,
  };
}
