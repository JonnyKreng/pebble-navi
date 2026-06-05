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

export function callbackForAck(_e: PebbleKit.AppMessageEvent): void {
  // Do nothing by default
}

export function callbackForNack(e: PebbleKit.AppMessageEvent): void {
  console.error(e.error);
}
