import { Destination } from './index';

const DESTINATIONS_KEY = 'destinations';

export function loadDestinations(): Destination[] {
  try {
    const saved = localStorage.getItem(DESTINATIONS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {}
  return [];
}

export function saveDestinations(destinations: Destination[]): void {
  try {
    localStorage.setItem(DESTINATIONS_KEY, JSON.stringify(destinations));
  } catch (e) {}
}

export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let runLen = 1;
    while (i + runLen < data.length && data[i + runLen] === val && runLen < 256) {
      runLen++;
    }
    if (runLen >= 2) {
      out.push(64, runLen - 1, val);
      i += runLen;
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
