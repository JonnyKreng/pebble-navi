import { Destination } from './index';
import { ENABLE_LOGS, TEST_DESTINATIONS } from './test-data';

const DESTINATIONS_KEY = 'destinations';
const UNITS_KEY = 'units';
const SETTINGS_KEY = 'nav_settings';
const TELEMETRY_KEY = 'telemetry_enabled';
const EXPERIMENTAL_KEY = 'experimental_enabled';
const BRIGHTNESS_KEY = 'brightness_value';
const SHOW_DESTINATION_HINT_KEY = 'show_destination_hint';
const MINIMUM_UPDATE_TIME_KEY = 'minimum_update_time';

export interface NavSettings {
  zoom: number;
  mode: string;
  rotationMode: boolean;
}

export function loadSettings(): NavSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {}
  return { zoom: 16, mode: 'walking', rotationMode: false };
}

export function saveSettings(settings: NavSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadUnits(): string {
  return localStorage.getItem(UNITS_KEY) || 'metric';
}

export function saveUnits(units: string): void {
  localStorage.setItem(UNITS_KEY, units);
}

export function loadTelemetryEnabled(): boolean {
  return localStorage.getItem(TELEMETRY_KEY) === 'true';
}

export function saveTelemetryEnabled(enabled: boolean): void {
  localStorage.setItem(TELEMETRY_KEY, enabled ? 'true' : 'false');
}

export function loadExperimentalEnabled(): boolean {
  return localStorage.getItem(EXPERIMENTAL_KEY) === 'true';
}

export function saveExperimentalEnabled(enabled: boolean): void {
  localStorage.setItem(EXPERIMENTAL_KEY, enabled ? 'true' : 'false');
}

export function loadBrightness(): number {
  const saved = localStorage.getItem(BRIGHTNESS_KEY);
  if (saved !== null) {
    const parsed = parseInt(saved, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return 40;
}

export function saveBrightness(brightness: number): void {
  localStorage.setItem(BRIGHTNESS_KEY, String(brightness));
}

export function loadShowDestinationHint(): boolean {
  const saved = localStorage.getItem(SHOW_DESTINATION_HINT_KEY);
  return saved !== 'false';
}

export function saveShowDestinationHint(enabled: boolean): void {
  localStorage.setItem(SHOW_DESTINATION_HINT_KEY, enabled ? 'true' : 'false');
}

export function loadMinimumUpdateTime(): number {
  const saved = localStorage.getItem(MINIMUM_UPDATE_TIME_KEY);
  if (saved !== null) {
    const parsed = parseInt(saved, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function saveMinimumUpdateTime(time: number): void {
  localStorage.setItem(MINIMUM_UPDATE_TIME_KEY, String(time));
}

export function loadDestinations(): Destination[] {
  try {
    const saved = localStorage.getItem(DESTINATIONS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {}
  return TEST_DESTINATIONS;
}

export function saveDestinations(destinations: Destination[]): void {
  try {
    localStorage.setItem(DESTINATIONS_KEY, JSON.stringify(destinations));
  } catch (e) {}
}

export function encodeLZSS(data: Uint8Array, window: number): Uint8Array {
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
        flags |= 1 << (7 - bit);
        out.push(bestOff & 0xff, bestLen);
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

export function encodeAdaptive(pixels: Uint8Array): Uint8Array {
  if (ENABLE_LOGS) console.time('encodeHoffmannXL');
  const hxl = encodeHoffmannXL(pixels);
  if (ENABLE_LOGS) console.timeEnd('encodeHoffmannXL');
  if (ENABLE_LOGS) console.time('encodeLZSS');
  const lzss = encodeLZSS(pixels, 255);
  if (ENABLE_LOGS) console.timeEnd('encodeLZSS');
  const useHxl = hxl.length <= lzss.length;
  const data = useHxl ? hxl : lzss;
  const algo = useHxl ? 0 : 1;
  const out = new Uint8Array(1 + data.length);
  out[0] = algo;
  out.set(data, 1);
  return out;
}

export function encodeHoffmannXL(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let runLen = 1;
    while (i + runLen < data.length && data[i + runLen] === val && runLen < 65535) {
      runLen++;
    }
    if (runLen >= 128) {
      out.push(0xff, runLen & 0xff, (runLen >> 8) & 0xff, val);
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

const charMap: Record<string, string> = {
  ä: 'a',
  ö: 'o',
  ü: 'u',
  Ä: 'A',
  Ö: 'O',
  Ü: 'U',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  É: 'E',
  à: 'a',
  â: 'a',
  ã: 'a',
  å: 'a',
  À: 'A',
  Â: 'A',
  Ã: 'A',
  Å: 'A',
  ç: 'c',
  Ç: 'C',
  ñ: 'n',
  Ñ: 'N',
  ó: 'o',
  ò: 'o',
  ô: 'o',
  õ: 'o',
  Ó: 'O',
  Ò: 'O',
  Ô: 'O',
  Õ: 'O',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  Í: 'I',
  Ì: 'I',
  Î: 'I',
  Ï: 'I',
  ú: 'u',
  ù: 'u',
  û: 'u',
  Ú: 'U',
  Ù: 'U',
  Û: 'U',
  ý: 'y',
  ÿ: 'y',
  Ý: 'Y',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
};

function IsAscii(c: string): boolean {
  return c.length === 1 && c >= " c >= ' " && c <= '~';
}

export function asciiNormalize(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const mapped = charMap[c];
    if (mapped) {
      out += mapped;
    } else if (IsAscii(c)) {
      out += c;
    }
  }
  return out.trim();
}
