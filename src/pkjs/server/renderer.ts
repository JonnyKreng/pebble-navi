import UPNG from 'upng-js';
import { TILE_SIZE, worldPixel } from './osm.js';
import { type RouteResult } from './routing.js';

export interface RenderInput {
  width: number;
  height: number;
  zoom: number;
  center: { lat: number; lng: number };
  start?: { lat: number; lng: number };
  dest?: { lat: number; lng: number };
  route?: RouteResult;
  tiles: Array<{ buffer: Uint8Array; tx: number; ty: number }>;
  userOffsetY?: number;
}

function fillRect(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
  cr: number,
  cg: number,
  cb: number,
) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(w, x + rw);
  const y1 = Math.min(h, y + rh);
  for (let row = y0; row < y1; row++) {
    for (let col = x0; col < x1; col++) {
      const idx = (row * w + col) * 4;
      buf[idx] = cr;
      buf[idx + 1] = cg;
      buf[idx + 2] = cb;
      buf[idx + 3] = 255;
    }
  }
}

function setPixel(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  cr: number,
  cg: number,
  cb: number,
) {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const idx = (y * w + x) * 4;
  buf[idx] = cr;
  buf[idx + 1] = cg;
  buf[idx + 2] = cb;
  buf[idx + 3] = 255;
}

function drawThickLine(
  buf: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cr: number,
  cg: number,
  cb: number,
  thickness: number,
) {
  const half = Math.floor(thickness / 2);
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let cx = Math.round(x0);
  let cy = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  while (true) {
    for (let cy2 = -half; cy2 <= half; cy2++) {
      for (let cx2 = -half; cx2 <= half; cx2++) {
        if (cx2 * cx2 + cy2 * cy2 <= half * half) {
          setPixel(buf, w, h, cx + cx2, cy + cy2, cr, cg, cb);
        }
      }
    }
    if (cx === ex && cy === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
}

function drawPolyline(
  buf: Uint8Array,
  w: number,
  h: number,
  coords: [number, number][],
  zoom: number,
  vl: number,
  vt: number,
  cr: number,
  cg: number,
  cb: number,
  thickness: number,
) {
  if (coords.length < 2) return;
  let [plng, plat] = coords[0];
  let pp = worldPixel(plat, plng, zoom);
  let px = Math.round(pp.wx - vl);
  let py = Math.round(pp.wy - vt);
  for (let i = 1; i < coords.length; i++) {
    const [lng, lat] = coords[i];
    const p = worldPixel(lat, lng, zoom);
    const x = Math.round(p.wx - vl);
    const y = Math.round(p.wy - vt);
    const onScreen =
      (px >= 0 && px < w && py >= 0 && py < h) || (x >= 0 && x < w && y >= 0 && y < h);
    if (onScreen) {
      drawThickLine(buf, w, h, px, py, x, y, cr, cg, cb, thickness);
    }
    px = x;
    py = y;
  }
}

function drawFilledCircle(
  buf: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  cr: number,
  cg: number,
  cb: number,
) {
  const r = Math.round(radius);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) {
        setPixel(buf, w, h, Math.round(cx + x), Math.round(cy + y), cr, cg, cb);
      }
    }
  }
}

function drawCircleOutline(
  buf: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  cr: number,
  cg: number,
  cb: number,
) {
  const r = Math.round(radius);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const dist = Math.round(Math.sqrt(x * x + y * y));
      if (dist === r || dist === r - 1) {
        setPixel(buf, w, h, Math.round(cx + x), Math.round(cy + y), cr, cg, cb);
      }
    }
  }
}

function drawFilledDiamond(
  buf: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  size: number,
  cr: number,
  cg: number,
  cb: number,
) {
  const s = Math.round(size);
  for (let dy = -s; dy <= s; dy++) {
    const halfW = s - Math.abs(dy);
    for (let dx = -halfW; dx <= halfW; dx++) {
      setPixel(buf, w, h, Math.round(cx + dx), Math.round(cy + dy), cr, cg, cb);
    }
  }
}

function drawDiamondOutline(
  buf: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  size: number,
  cr: number,
  cg: number,
  cb: number,
) {
  const s = Math.round(size);
  for (let dy = -s; dy <= s; dy++) {
    const halfW = s - Math.abs(dy);
    const outerW = halfW;
    const innerW = halfW - 1;
    setPixel(buf, w, h, Math.round(cx + outerW), Math.round(cy + dy), cr, cg, cb);
    setPixel(buf, w, h, Math.round(cx - outerW), Math.round(cy + dy), cr, cg, cb);
    if (innerW >= 0) {
      setPixel(buf, w, h, Math.round(cx + innerW), Math.round(cy + dy), cr, cg, cb);
      setPixel(buf, w, h, Math.round(cx - innerW), Math.round(cy + dy), cr, cg, cb);
    }
  }
}

function markerPixel(lat: number, lng: number, zoom: number, vl: number, vt: number) {
  const p = worldPixel(lat, lng, zoom);
  return { x: p.wx - vl, y: p.wy - vt };
}

function renderMapNormal(input: RenderInput): Uint8Array {
  const { width, height } = input;
  const buf = new Uint8Array(width * height * 4);

  fillRect(buf, width, height, 0, 0, width, height, 0xf8, 0xf8, 0xf8);

  const center = worldPixel(input.center.lat, input.center.lng, input.zoom);
  const offsetX = width / 2;
  const offsetY = input.userOffsetY ?? height / 2;
  const vl = center.wx - offsetX;
  const vt = center.wy - offsetY;

  for (const tile of input.tiles) {
    try {
      const decoded = UPNG.decode(tile.buffer.buffer as ArrayBuffer);
      const rgbaArr = UPNG.toRGBA8(decoded)[0];
      const rgba = new Uint8Array(rgbaArr);
      const tileX = tile.tx * TILE_SIZE;
      const tileY = tile.ty * TILE_SIZE;
      const screenX = Math.round(tileX - vl);
      const screenY = Math.round(tileY - vt);
      for (let ty = 0; ty < TILE_SIZE; ty++) {
        for (let tx = 0; tx < TILE_SIZE; tx++) {
          const sx = screenX + tx;
          const sy = screenY + ty;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            const srcIdx = (ty * TILE_SIZE + tx) * 4;
            const dstIdx = (sy * width + sx) * 4;
            buf[dstIdx] = rgba[srcIdx];
            buf[dstIdx + 1] = rgba[srcIdx + 1];
            buf[dstIdx + 2] = rgba[srcIdx + 2];
            buf[dstIdx + 3] = 255;
          }
        }
      }
    } catch {
      /* skip failed tile */
    }
  }

  if (input.route) {
    const coords = input.route.coordinates;
    if (coords.length > 0) {
      drawPolyline(buf, width, height, coords, input.zoom, vl, vt, 255, 255, 255, 6);
      drawPolyline(buf, width, height, coords, input.zoom, vl, vt, 51, 102, 255, 4);
    }
  }

  if (input.start) {
    const origin = markerPixel(input.start.lat, input.start.lng, input.zoom, vl, vt);
    drawCircleOutline(buf, width, height, origin.x, origin.y, 6, 255, 255, 255);
    drawFilledCircle(buf, width, height, origin.x, origin.y, 5, 34, 204, 102);
    drawCircleOutline(buf, width, height, origin.x, origin.y, 5, 255, 255, 255);
  }

  if (input.dest) {
    const d = markerPixel(input.dest.lat, input.dest.lng, input.zoom, vl, vt);
    drawDiamondOutline(buf, width, height, d.x, d.y, 8, 255, 255, 255);
    drawFilledDiamond(buf, width, height, d.x, d.y, 7, 255, 51, 51);
    drawDiamondOutline(buf, width, height, d.x, d.y, 7, 255, 255, 255);
  }

  return buf;
}

export function renderMap(input: RenderInput): Uint8Array {
  return renderMapNormal(input);
}
