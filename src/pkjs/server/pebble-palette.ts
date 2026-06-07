const GCOLOR_TO_RGB565: Uint16Array = new Uint16Array(64);

for (let i = 0; i < 64; i++) {
  const r = (i >> 4) & 0x3;
  const g = (i >> 2) & 0x3;
  const b = i & 0x3;
  const r5 = Math.round((r * 31) / 3);
  const g6 = Math.round((g * 63) / 3);
  const b5 = Math.round((b * 31) / 3);
  GCOLOR_TO_RGB565[i] = ((r5 << 11) | (g6 << 5) | b5) as number;
}

export const pebblePalette: Uint16Array = GCOLOR_TO_RGB565;

export function nearestColor(r: number, g: number, b: number): number {
  const r2 = Math.round(r / 85) as 0 | 1 | 2 | 3;
  const g2 = Math.round(g / 85) as 0 | 1 | 2 | 3;
  const b2 = Math.round(b / 85) as 0 | 1 | 2 | 3;
  return (r2 << 4) | (g2 << 2) | b2;
}

export function quantizeToPebble(
  rgba: Uint8Array,
  width: number,
  height: number,
): {
  pixels: Uint8Array;
  palette: Uint16Array;
} {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    pixels[i] = nearestColor(r, g, b);
  }
  return { pixels, palette: pebblePalette };
}

export function quantizeToPebble2Bit(
  rgba: Uint8Array,
  width: number,
  height: number,
): { pixels: Uint8Array } {
  const numPixels = width * height;
  const packedLen = Math.ceil(numPixels / 4);
  const packed = new Uint8Array(packedLen);
  for (let i = 0; i < numPixels; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const gray = Math.round((r + g + b) / 3 / 85);
    const idx = i >> 2;
    const shift = (3 - (i & 3)) << 1;
    packed[idx] = (packed[idx] & ~(3 << shift)) | ((gray & 3) << shift);
  }
  return { pixels: packed };
}
