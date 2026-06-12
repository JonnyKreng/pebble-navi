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
  currentPos?: { lat: number; lng: number };
  bearing?: number;
  route?: RouteResult;
  tiles: Array<{ buffer: Uint8Array; tx: number; ty: number }>;
  userOffsetY?: number;
  rotation?: number;
  outputWidth?: number;
  outputHeight?: number;
  outputUserOffsetY?: number;
  isBw: boolean;
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

function drawArrow(
  buf: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  angle: number,
  cr: number,
  cg: number,
  cb: number,
) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const tip = 15;
  const back = 9;
  const wing = 9;
  const pts: [number, number][] = [
    [0, -tip],
    [-wing, back],
    [0, 5],
    [wing, back],
  ];
  const rotated = pts.map(
    ([px, py]) =>
      [Math.round(cx + px * cosA - py * sinA), Math.round(cy + px * sinA + py * cosA)] as [
        number,
        number,
      ],
  );

  const minY = Math.min(...rotated.map((p) => p[1]));
  const maxY = Math.max(...rotated.map((p) => p[1]));
  const minX = Math.min(...rotated.map((p) => p[0]));
  const maxX = Math.max(...rotated.map((p) => p[0]));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (
        pointInTriangle(x, y, rotated[0], rotated[1], rotated[2]) ||
        pointInTriangle(x, y, rotated[0], rotated[2], rotated[3])
      ) {
        setPixel(buf, w, h, x, y, cr, cg, cb);
      }
    }
  }
}

function pointInTriangle(
  px: number,
  py: number,
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  const d1 = sign(px, py, a, b);
  const d2 = sign(px, py, b, c);
  const d3 = sign(px, py, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(px: number, py: number, a: [number, number], b: [number, number]): number {
  return (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
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
      if (input.isBw) {
        drawPolyline(buf, width, height, coords, input.zoom, vl, vt, 0, 0, 0, 4);
      } else {
        drawPolyline(buf, width, height, coords, input.zoom, vl, vt, 51, 102, 255, 4);
      }
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

  if (input.currentPos) {
    const p = markerPixel(input.currentPos.lat, input.currentPos.lng, input.zoom, vl, vt);
    if (input.bearing != null) {
      drawArrow(buf, width, height, p.x, p.y, (input.bearing * Math.PI) / 180, 0x00, 0xcc, 0xff);
      const halfArrow = 9;
      for (let dy = -halfArrow; dy <= halfArrow; dy++) {
        for (let dx = -halfArrow; dx <= halfArrow; dx++) {
          if (
            Math.abs(dx) <= halfArrow - Math.abs(dy) &&
            (Math.abs(dx) <= 1 || Math.abs(dy) <= 1)
          ) {
            const nx = Math.round(p.x + dx);
            const ny = Math.round(p.y + dy);
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const idx = (ny * width + nx) * 4;
              if (buf[idx] === 0xf8 && buf[idx + 1] === 0xf8 && buf[idx + 2] === 0xf8) {
                setPixel(buf, width, height, nx, ny, 0xff, 0xcc, 0x00);
              }
            }
          }
        }
      }
    } else {
      drawFilledCircle(buf, width, height, p.x, p.y, 5, 0, 0xcc, 0xff);
      drawCircleOutline(buf, width, height, p.x, p.y, 5, 0, 0, 0);
    }
  }

  return buf;
}

function renderMapRotated(input: RenderInput): Uint8Array {
  const outW = input.outputWidth ?? input.width;
  const outH = input.outputHeight ?? input.height;
  const rotRad = (input.rotation! * Math.PI) / 180;

  const cosA = Math.abs(Math.cos(rotRad));
  const sinA = Math.abs(Math.sin(rotRad));
  const outCY = input.outputUserOffsetY ?? outH / 2;
  const maxDY =
    input.outputUserOffsetY != null
      ? Math.max(input.outputUserOffsetY, outH - input.outputUserOffsetY)
      : outH / 2;
  const expW = Math.ceil(outW * cosA + 2 * maxDY * sinA) + 1;
  const expH = Math.ceil(outW * sinA + 2 * maxDY * cosA) + 1;

  const unrotated = renderMapNormal({
    ...input,
    width: expW,
    height: expH,
    userOffsetY: expH / 2,
    rotation: undefined,
  });

  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const expCX = expW / 2;
  const expCY = expH / 2;
  const outCX = outW / 2;
  const buf = new Uint8Array(outW * outH * 4);
  const bgR = 0xf8,
    bgG = 0xf8,
    bgB = 0xf8;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const dx = x - outCX;
      const dy = y - outCY;
      const sx = Math.round(expCX + dx * cosR + dy * sinR);
      const sy = Math.round(expCY - dx * sinR + dy * cosR);

      const dstIdx = (y * outW + x) * 4;
      if (sx >= 0 && sx < expW && sy >= 0 && sy < expH) {
        const srcIdx = (sy * expW + sx) * 4;
        buf[dstIdx] = unrotated[srcIdx];
        buf[dstIdx + 1] = unrotated[srcIdx + 1];
        buf[dstIdx + 2] = unrotated[srcIdx + 2];
        buf[dstIdx + 3] = 255;
      } else {
        buf[dstIdx] = bgR;
        buf[dstIdx + 1] = bgG;
        buf[dstIdx + 2] = bgB;
        buf[dstIdx + 3] = 255;
      }
    }
  }

  return buf;
}

export function renderMap(input: RenderInput): Uint8Array {
  if (input.rotation != null && input.rotation !== 0) {
    return renderMapRotated(input);
  }
  return renderMapNormal(input);
}
