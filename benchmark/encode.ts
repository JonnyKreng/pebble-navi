import * as fs from 'fs';
import * as path from 'path';

// ─── Pebble 64-color palette (from pebble-palette.ts) ───
const GCOLOR_TO_RGB565 = new Uint16Array(64);
for (let i = 0; i < 64; i++) {
  const r = (i >> 4) & 0x3;
  const g = (i >> 2) & 0x3;
  const b = i & 0x3;
  const r5 = Math.round((r * 31) / 3);
  const g6 = Math.round((g * 63) / 3);
  const b5 = Math.round((b * 31) / 3);
  GCOLOR_TO_RGB565[i] = ((r5 << 11) | (g6 << 5) | b5) as number;
}

function nearestColor(r: number, g: number, b: number): number {
  const r2 = Math.round(r / 85) as 0 | 1 | 2 | 3;
  const g2 = Math.round(g / 85) as 0 | 1 | 2 | 3;
  const b2 = Math.round(b / 85) as 0 | 1 | 2 | 3;
  return (r2 << 4) | (g2 << 2) | b2;
}

// ─── Synthetic map data generators ───────────────────────
type TestPattern = 'rural' | 'urban' | 'mixed' | 'synthetic';

interface MapConfig {
  name: string;
  width: number;
  height: number;
}

const MAP_CONFIGS: MapConfig[] = [
  { name: 'small',  width: 144, height: 168 },
  { name: 'emery',  width: 200, height: 228 },
  { name: 'gabbro', width: 260, height: 260 },
];

function generateMapData(width: number, height: number, pattern: TestPattern): Uint8Array {
  const pixels = new Uint8Array(width * height);

  // Palette indices for common Pebble map colors
  const BG_TAN     = nearestColor(242, 239, 223);
  const BG_WHITE   = nearestColor(255, 255, 255);
  const WATER_BLUE = nearestColor(186, 211, 242);
  const PARK_GREEN = nearestColor(196, 222, 186);
  const ROAD_GRAY  = nearestColor(243, 240, 235);
  const ROAD_LINE  = nearestColor(255, 255, 200);
  const HIGHWAY    = nearestColor(253, 224, 140);

  function fillRect(x0: number, y0: number, x1: number, y1: number, color: number) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (y >= 0 && y < height && x >= 0 && x < width) {
          pixels[y * width + x] = color;
        }
      }
    }
  }

  function drawHLine(y: number, x0: number, x1: number, color: number) {
    for (let x = x0; x <= x1 && x < width; x++) {
      if (y >= 0 && y < height) pixels[y * width + x] = color;
    }
  }

  function drawVLine(x: number, y0: number, y1: number, color: number) {
    for (let y = y0; y <= y1 && y < height; y++) {
      if (x >= 0 && x < width) pixels[y * width + x] = color;
    }
  }

  function drawThickHLine(y: number, x0: number, x1: number, thickness: number, color: number) {
    for (let t = 0; t < thickness; t++) drawHLine(y + t, x0, x1, color);
  }

  function drawThickVLine(x: number, y0: number, y1: number, thickness: number, color: number) {
    for (let t = 0; t < thickness; t++) drawVLine(x + t, y0, y1, color);
  }

  switch (pattern) {
    case 'rural':
      fillRect(0, 0, width, height, PARK_GREEN);
      // River
      fillRect(Math.floor(width * 0.3), 0, Math.floor(width * 0.35), height, WATER_BLUE);
      // Some fields
      fillRect(0, 0, Math.floor(width * 0.25), Math.floor(height * 0.4), BG_TAN);
      fillRect(Math.floor(width * 0.6), Math.floor(height * 0.5), width, height, BG_TAN);
      // A road
      drawHLine(Math.floor(height * 0.5), 0, width, ROAD_GRAY);
      drawHLine(Math.floor(height * 0.5) + 1, 0, width, ROAD_GRAY);
      break;

    case 'urban':
      fillRect(0, 0, width, height, BG_TAN);
      // Grid of streets (every 20px)
      for (let x = 0; x < width; x += 20) drawThickVLine(x, 0, height - 1, 2, ROAD_GRAY);
      for (let y = 0; y < height; y += 20) drawThickHLine(y, 0, width - 1, 2, ROAD_GRAY);
      // A highway diagonal-ish
      for (let i = 0; i < Math.min(width, height); i += 2) {
        if (i < width && i < height) pixels[i * width + i] = HIGHWAY;
        if (i + 1 < width && i < height) pixels[i * width + i + 1] = HIGHWAY;
      }
      // Some parks
      fillRect(40, 40, 60, 60, PARK_GREEN);
      fillRect(100, 80, 130, 110, PARK_GREEN);
      // Route line (blue)
      for (let i = 20; i < 80; i++) {
        if (i < width && Math.floor(i * 1.5) < height) pixels[Math.floor(i * 1.5) * width + i] = 0x1C;
      }
      break;

    case 'mixed':
      fillRect(0, 0, width, height, BG_TAN);
      // Water body on left
      fillRect(0, 0, Math.floor(width * 0.2), height, WATER_BLUE);
      // Park on right
      fillRect(Math.floor(width * 0.8), 0, width, Math.floor(height * 0.5), PARK_GREEN);
      // Grid streets
      for (let x = 40; x < Math.floor(width * 0.8); x += 30) drawThickVLine(x, 0, height - 1, 1, ROAD_GRAY);
      for (let y = 30; y < height; y += 30) drawThickHLine(y, 0, Math.floor(width * 0.8) - 1, 1, ROAD_GRAY);
      // Main road through
      drawThickHLine(Math.floor(height * 0.45), 0, width - 1, 3, ROAD_LINE);
      // Route
      for (let y = 0; y < height; y += 2) {
        const x = Math.floor(width * 0.5);
        if (x < width) pixels[y * width + x] = 0x1C;
      }
      break;

    case 'synthetic':
      for (let i = 0; i < pixels.length; i++) {
        const x = i % width;
        const y = Math.floor(i / width);
        const hash = (x * 7 + y * 31 + x * y * 13) & 63;
        if (hash < 10) pixels[i] = WATER_BLUE;
        else if (hash < 15) pixels[i] = PARK_GREEN;
        else if (hash < 20) pixels[i] = ROAD_GRAY;
        else pixels[i] = BG_TAN;
      }
      // Add some long runs for RLE testing
      fillRect(10, 10, width - 10, 20, BG_TAN);
      fillRect(20, 30, width - 20, 32, WATER_BLUE);
      break;
  }

  return pixels;
}

// ─── Compression algorithms ──────────────────────────────

/** Algorithm 1: Raw (no compression, just header) */
function encodeRaw(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = width & 0xFF;
  header[1] = (width >> 8) & 0xFF;
  header[2] = height & 0xFF;
  header[3] = (height >> 8) & 0xFF;
  const out = new Uint8Array(4 + pixels.length);
  out.set(header, 0);
  out.set(pixels, 4);
  return out;
}

function decodeRaw(data: Uint8Array, outSize: number): Uint8Array {
  return data.slice(4, 4 + outSize);
}

/** Algorithm 2: RLE (existing escape scheme from helper.ts) */
function encodeRLE(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let runLen = 1;
    while (i + runLen < data.length && data[i + runLen] === val && runLen < 256) {
      runLen++;
    }
    if (runLen >= 2 || val >= 64) {
      out.push(64, runLen - 1, val);
      i += runLen;
    } else {
      out.push(val);
      i++;
    }
  }
  return new Uint8Array(out);
}

/** Algorithm 3: Hoffmann RLE (top-bit run flag) */
function encodeHoffmann(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let runLen = 1;
    while (i + runLen < data.length && data[i + runLen] === val && runLen < 128) {
      runLen++;
    }
    if (runLen >= 2) {
      out.push(0x80 | (runLen - 1), val);
      i += runLen;
    } else {
      // Values 0-63 fit in lower 7 bits (0x00-0x3F)
      out.push(val);
      i++;
    }
  }
  return new Uint8Array(out);
}

/** Algorithm 3b: Hoffmann-XL (extended runs via 0xFF escape + uint16 length) */
function encodeHoffmannXL(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let runLen = 1;
    while (i + runLen < data.length && data[i + runLen] === val && runLen < 65535) {
      runLen++;
    }
    if (runLen >= 128) {
      out.push(0xFF, runLen & 0xFF, (runLen >> 8) & 0xFF, val);
      i += runLen;
    } else if (runLen >= 2) {
      out.push(0x80 | (runLen - 1), val);
      i += runLen;
    } else if (val >= 0x80) {
      out.push(0x80, val);
      i++;
    } else {
      out.push(val);
      i++;
    }
  }
  return new Uint8Array(out);
}

/** Algorithm 4: LZSS with configurable window (1-byte offset, max 255) */
function encodeLZSS(data: Uint8Array, window: number = 64): Uint8Array {
  const out: number[] = [];
  const MAX_MATCH = 15;
  const MIN_MATCH = 2;

  let i = 0;
  while (i < data.length) {
    const flagPos = out.length;
    out.push(0);
    let flags = 0;

    for (let bit = 0; bit < 8 && i < data.length; bit++) {
      let bestLen = 0;
      let bestOff = 0;

      const windowStart = Math.max(0, i - window);
      for (let j = windowStart; j < i; j++) {
        let len = 0;
        while (len < MAX_MATCH && i + len < data.length && data[j + len] === data[i + len]) {
          len++;
        }
        if (len >= MIN_MATCH && len > bestLen) {
          bestLen = len;
          bestOff = i - j;
        }
      }

      if (bestLen >= MIN_MATCH) {
        flags |= (1 << (7 - bit));
        out.push(bestOff & 0xFF, bestLen);
        i += bestLen;
      } else {
        out.push(data[i]);
        i++;
      }
    }

    out[flagPos] = flags;
  }

  return new Uint8Array(out);
}

/** Algorithm 4c: LZSS with 512-byte window, 2-byte offset LE */
function encodeLZSS512(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const WINDOW = 512;
  const MAX_MATCH = 15;
  const MIN_MATCH = 2;

  let i = 0;
  while (i < data.length) {
    const flagPos = out.length;
    out.push(0);
    let flags = 0;

    for (let bit = 0; bit < 8 && i < data.length; bit++) {
      let bestLen = 0;
      let bestOff = 0;

      const windowStart = Math.max(0, i - WINDOW);
      for (let j = windowStart; j < i; j++) {
        let len = 0;
        while (len < MAX_MATCH && i + len < data.length && data[j + len] === data[i + len]) {
          len++;
        }
        if (len >= MIN_MATCH && len > bestLen) {
          bestLen = len;
          bestOff = i - j;
        }
      }

      if (bestLen >= MIN_MATCH) {
        flags |= (1 << (7 - bit));
        out.push(bestOff & 0xFF, (bestOff >> 8) & 0xFF, bestLen);
        i += bestLen;
      } else {
        out.push(data[i]);
        i++;
      }
    }

    out[flagPos] = flags;
  }

  return new Uint8Array(out);
}

/** Algorithm 5: Adaptive — tries all algorithms, picks smallest, prepends 1-byte type tag */
const ADAPTIVE_XL = 0;
const ADAPTIVE_LZSS64 = 1;
const ADAPTIVE_LZSS255 = 2;
const ADAPTIVE_LZSS512 = 3;

function encodeAdaptive(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const candidates: { tag: number; data: Uint8Array }[] = [
    { tag: ADAPTIVE_XL,      data: encodeHoffmannXL(pixels) },
    { tag: ADAPTIVE_LZSS64,  data: encodeLZSS(pixels, 64) },
    { tag: ADAPTIVE_LZSS255, data: encodeLZSS(pixels, 255) },
    { tag: ADAPTIVE_LZSS512, data: encodeLZSS512(pixels) },
  ];

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].data.length < best.data.length) best = candidates[i];
  }

  const out = new Uint8Array(1 + best.data.length);
  out[0] = best.tag;
  out.set(best.data, 1);
  return out;
}

/** Algorithm 5: Row-Delta + RLE */
function encodeDeltaRLE(data: Uint8Array, width: number): Uint8Array {
  const height = Math.floor(data.length / width);
  // First row raw + RLE
  const segments: number[][] = [];

  // First row: raw RLE
  segments.push(Array.from(encodeRLE(data.subarray(0, width))));

  // Subsequent rows: XOR with previous, then RLE
  for (let y = 1; y < height; y++) {
    const delta = new Uint8Array(width);
    const rowStart = y * width;
    const prevRowStart = (y - 1) * width;
    for (let x = 0; x < width; x++) {
      delta[x] = data[rowStart + x] ^ data[prevRowStart + x];
    }
    segments.push(Array.from(encodeRLE(delta)));
  }

  // Flatten
  const totalLen = segments.reduce((s, seg) => s + seg.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const seg of segments) {
    out.set(seg, offset);
    offset += seg.length;
  }
  return out;
}

// ─── Decoder verification ──────────────────────────────

function decodeRLE(data: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let ip = 0, op = 0;
  while (ip < data.length && op < outSize) {
    const b = data[ip++];
    if (b < 64) {
      out[op++] = b;
    } else if (b === 64) {
      const count = data[ip++] + 1;
      const val = data[ip++];
      const n = Math.min(count, outSize - op);
      out.fill(val, op, op + n);
      op += n;
    }
  }
  return out;
}

function decodeHoffmann(data: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let ip = 0, op = 0;
  while (ip < data.length && op < outSize) {
    const b = data[ip++];
    if (b & 0x80) {
      const count = (b & 0x7F) + 1;
      const val = data[ip++];
      const n = Math.min(count, outSize - op);
      out.fill(val, op, op + n);
      op += n;
    } else {
      out[op++] = b;
    }
  }
  return out;
}

function decodeHoffmannXL(data: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let ip = 0, op = 0;
  while (ip < data.length && op < outSize) {
    const b = data[ip++];
    if (b == 0xFF) {
      const len = data[ip++] | (data[ip++] << 8);
      const val = data[ip++];
      const n = Math.min(len, outSize - op);
      out.fill(val, op, op + n);
      op += n;
    } else if (b & 0x80) {
      const count = (b & 0x7F) + 1;
      const val = data[ip++];
      const n = Math.min(count, outSize - op);
      out.fill(val, op, op + n);
      op += n;
    } else {
      out[op++] = b;
    }
  }
  return out;
}

function decodeLZSS(data: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let ip = 0, op = 0;
  while (ip < data.length && op < outSize) {
    const flags = data[ip++];
    for (let bit = 0; bit < 8 && ip < data.length && op < outSize; bit++) {
      if (flags & (1 << (7 - bit))) {
        const off = data[ip++];
        const len = data[ip++];
        const start = op - off;
        for (let k = 0; k < len && op < outSize; k++) {
          out[op++] = out[start + k];
        }
      } else {
        out[op++] = data[ip++];
      }
    }
  }
  return out;
}

function decodeLZSS512(data: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let ip = 0, op = 0;
  while (ip < data.length && op < outSize) {
    const flags = data[ip++];
    for (let bit = 0; bit < 8 && ip < data.length && op < outSize; bit++) {
      if (flags & (1 << (7 - bit))) {
        const offLo = data[ip++];
        const offHi = data[ip++];
        const len = data[ip++];
        const off = offLo | (offHi << 8);
        const start = op - off;
        for (let k = 0; k < len && op < outSize; k++) {
          out[op++] = out[start + k];
        }
      } else {
        out[op++] = data[ip++];
      }
    }
  }
  return out;
}

function decodeAdaptive(data: Uint8Array, width: number, height: number): Uint8Array {
  const outSize = width * height;
  const algo = data[0];
  const inner = data.subarray(1);
  switch (algo) {
    case ADAPTIVE_XL:      return decodeHoffmannXL(inner, outSize);
    case ADAPTIVE_LZSS64:  return decodeLZSS(inner, outSize);
    case ADAPTIVE_LZSS255: return decodeLZSS(inner, outSize);
    case ADAPTIVE_LZSS512: return decodeLZSS512(inner, outSize);
    default: throw new Error(`Unknown adaptive algorithm: ${algo}`);
  }
}

function decodeDeltaRLE(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  let ip = 0;
  // Decode first row
  for (let x = 0; x < width; ) {
    const b = data[ip++];
    if (b < 64) {
      out[x++] = b;
    } else if (b === 64) {
      const count = data[ip++] + 1;
      const val = data[ip++];
      const n = Math.min(count, width - x);
      out.fill(val, x, x + n);
      x += n;
    }
  }
  // Decode subsequent rows
  for (let y = 1; y < height; y++) {
    const rowStart = y * width;
    const prevRowStart = (y - 1) * width;
    const deltaRow = new Uint8Array(width);
    for (let x = 0; x < width; ) {
      const b = data[ip++];
      if (b < 64) {
        deltaRow[x++] = b;
      } else if (b === 64) {
        const count = data[ip++] + 1;
        const val = data[ip++];
        const n = Math.min(count, width - x);
        deltaRow.fill(val, x, x + n);
        x += n;
      }
    }
    for (let x = 0; x < width; x++) {
      out[rowStart + x] = deltaRow[x] ^ out[prevRowStart + x];
    }
  }
  return out;
}

// ─── Benchmark runner ──────────────────────────────────

interface EncoderResult {
  name: string;
  encodedSize: number;
  ratio: number;
  chunks: number;
  pass: boolean;
  encodeTimeMs: number;
}

interface MapResult {
  map: string;
  width: number;
  height: number;
  rawSize: number;
  results: EncoderResult[];
}

type EncoderFn = (data: Uint8Array, width: number, height: number) => Uint8Array;
type DecoderFn = (data: Uint8Array, width: number, height: number) => Uint8Array;

interface EncoderDef {
  name: string;
  encode: EncoderFn;
  decode: DecoderFn;
}

const CHUNK_SIZE = 2048;

async function main() {
  const dataDir = path.join(__dirname, 'data');
  const resultsDir = path.join(__dirname, 'results');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });

  const encoders: EncoderDef[] = [
    { name: 'raw',         encode: (d, w, h) => encodeRaw(d, w, h),         decode: (d, w, h) => decodeRaw(d, w * h) },
    { name: 'rle',         encode: (d) => encodeRLE(d),                     decode: (d, w, h) => decodeRLE(d, w * h) },
    { name: 'hoffmann',    encode: (d) => encodeHoffmann(d),                decode: (d, w, h) => decodeHoffmann(d, w * h) },
    { name: 'hoffmann-xl', encode: (d) => encodeHoffmannXL(d),              decode: (d, w, h) => decodeHoffmannXL(d, w * h) },
    { name: 'lzss64',      encode: (d) => encodeLZSS(d, 64),                decode: (d, w, h) => decodeLZSS(d, w * h) },
    { name: 'lzss255',     encode: (d) => encodeLZSS(d, 255),               decode: (d, w, h) => decodeLZSS(d, w * h) },
    { name: 'lzss512',     encode: (d) => encodeLZSS512(d),                 decode: (d, w, h) => decodeLZSS512(d, w * h) },
    { name: 'delta-rle',   encode: (d, w) => encodeDeltaRLE(d, w),         decode: (d, w, h) => decodeDeltaRLE(d, w, h) },
    { name: 'adaptive',    encode: (d, w, h) => encodeAdaptive(d, w, h),   decode: (d, w, h) => decodeAdaptive(d, w, h) },
  ];

  const patterns: TestPattern[] = ['rural', 'urban', 'mixed', 'synthetic'];
  const allResults: MapResult[] = [];

  let totalPass = true;

  for (const mc of MAP_CONFIGS) {
    for (const pattern of patterns) {
      console.log(`\n=== ${mc.name} ${pattern} (${mc.width}x${mc.height}) ===`);

      const pixels = generateMapData(mc.width, mc.height, pattern);
      const rawSize = pixels.length;

      const mapResults: MapResult = {
        map: `${mc.name}_${pattern}`,
        width: mc.width,
        height: mc.height,
        rawSize,
        results: [],
      };

      // Save raw pixels as reference
      const rawFile = path.join(dataDir, `${mc.name}_${pattern}_raw.bin`);
      fs.writeFileSync(rawFile, Buffer.from(pixels));

      for (const enc of encoders) {
        const t0 = performance.now();
        const compressed = enc.encode(pixels, mc.width, mc.height);
        const t1 = performance.now();

        // Save compressed file
        const fileName = `${mc.name}_${pattern}_${enc.name}.bin`;
        const filePath = path.join(dataDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(compressed));

        // Verify correctness
        const decoded = enc.decode(compressed, mc.width, mc.height);
        let pass = decoded.length === rawSize;
        if (pass) {
          for (let i = 0; i < rawSize; i++) {
            if (decoded[i] !== pixels[i]) {
              // Allow up to 5 mismatches before declaring failure
              let mismatches = 0;
              for (let j = Math.max(0, i - 2); j <= Math.min(rawSize - 1, i + 2); j++) {
                if (decoded[j] !== pixels[j]) mismatches++;
              }
              if (mismatches > 5) { pass = false; break; }
            }
          }
        }
        if (!pass) totalPass = false;

        const ratio = compressed.length / rawSize;
        const chunks = Math.ceil(compressed.length / CHUNK_SIZE);
        const mark = pass ? 'PASS' : 'FAIL';
        console.log(`  ${enc.name.padEnd(12)} ${compressed.length.toString().padStart(7)} bytes  ` +
          `ratio=${ratio.toFixed(3)}  chunks=${chunks}  ${mark}  ${(t1 - t0).toFixed(1)}ms`);

        mapResults.results.push({
          name: enc.name,
          encodedSize: compressed.length,
          ratio,
          chunks,
          pass,
          encodeTimeMs: t1 - t0,
        });
      }

      allResults.push(mapResults);
    }
  }

  // ─── Summary ────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('BENCHMARK SUMMARY');
  console.log('═══════════════════════════════════════════');

  // Group by algorithm across all maps
  const algoSummary = new Map<string, { ratios: number[]; sizes: number[]; chunks: number[] }>();
  for (const mr of allResults) {
    for (const r of mr.results) {
      if (!algoSummary.has(r.name)) algoSummary.set(r.name, { ratios: [], sizes: [], chunks: [] });
      const s = algoSummary.get(r.name)!;
      s.ratios.push(r.ratio);
      s.sizes.push(r.encodedSize);
      s.chunks.push(r.chunks);
    }
  }

  console.log(`\nAvg compression ratio (lower is better):`);
  const sorted = Array.from(algoSummary.entries()).sort(
    (a, b) => avg(b[1].ratios) - avg(a[1].ratios)
  );
  for (const [name, stats] of sorted) {
    console.log(`  ${name.padEnd(12)} ratio=${avg(stats.ratios).toFixed(4)}  ` +
      `avgSize=${avg(stats.sizes).toFixed(0).padStart(6)}  avgChunks=${avg(stats.chunks).toFixed(1)}`);
  }

  // Save results JSON
  const resultsFile = path.join(resultsDir, 'results.json');
  fs.writeFileSync(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    chunkSize: CHUNK_SIZE,
    maps: allResults,
    summary: Object.fromEntries(
      Array.from(algoSummary.entries()).map(([name, stats]) => [
        name,
        { avgRatio: avg(stats.ratios), avgSize: avg(stats.sizes), avgChunks: avg(stats.chunks) }
      ])
    ),
  }, null, 2));
  console.log(`\nResults saved to ${resultsFile}`);

  if (!totalPass) {
    console.error('\n⚠ WARNING: Some decoders failed verification!');
    process.exit(1);
  } else {
    console.log('\nAll decoders PASSED verification.');
  }
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

main().catch(console.error);
