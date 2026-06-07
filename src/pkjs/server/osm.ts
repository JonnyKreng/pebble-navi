export const TILE_SIZE = 256;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const UA = 'pebble-map-renderer/1.0';

export function worldPixel(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom;
  const x = (lng + 180) / 360;
  const y =
    (1 -
      Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
    2;
  return { wx: x * n * TILE_SIZE, wy: y * n * TILE_SIZE };
}

export async function getTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const url = TILE_URL.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
