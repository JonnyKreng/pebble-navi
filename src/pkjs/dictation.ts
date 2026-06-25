import { haversine } from './server/routing';
import { loadUnits } from './helper';
import { MapHandler } from './map-handler';

export interface DictationResult {
  lat: number;
  lng: number;
  name: string;
  distance: string;
}

export let dictationResults: DictationResult[] = [];

function formatDistance(meters: number): string {
  const units = loadUnits();
  if (units === 'imperial') {
    const mi = meters / 1609.344;
    if (mi >= 0.1) return `${mi.toFixed(1)} mi`;
    return `${Math.round(meters / 0.3048)} ft`;
  } else {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  }
}

function sendDictateResult(i: number): void {
  if (i >= dictationResults.length) return;
  const r = dictationResults[i];
  Pebble.sendAppMessage(
    {
      DICTATE_RESULT_INDEX: i,
      DICTATE_RESULT_NAME: r.name,
      DICTATE_RESULT_DISTANCE: r.distance,
    },
    () => sendDictateResult(i + 1),
    (err) => console.error('Dictate result send failed: ' + err.error),
  );
}

export async function dictateSearch(query: string, mapHandler: MapHandler): Promise<void> {
  const pos = mapHandler.getCurrentPosition();
  if (!pos) {
    Pebble.sendAppMessage({ DICTATE_RESULTS_TOTAL: 0 });
    return;
  }

  try {
    const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(query) + '&lat=' + pos.lat + '&lon=' + pos.lng + '&limit=6';
    const res = await fetch(url);
    const data = await res.json();

    if (!data.features || data.features.length === 0) {
      Pebble.sendAppMessage({ DICTATE_RESULTS_TOTAL: 0 });
      return;
    }

    dictationResults = data.features.map((item: any) => {
      const [lng, lat] = item.geometry.coordinates;
      const p = item.properties;
      const dist = haversine(pos.lat, pos.lng, lat, lng);
      const displayName = p.name || query;
      return {
        lat,
        lng,
        name: displayName,
        distance: formatDistance(dist),
      };
    });

    Pebble.sendAppMessage(
      { DICTATE_RESULTS_TOTAL: dictationResults.length },
      () => sendDictateResult(0),
      (err) => console.error('Dictate total send failed: ' + err.error),
    );
  } catch (e) {
    console.error('Dictation search failed:', e);
    Pebble.sendAppMessage({ DICTATE_RESULTS_TOTAL: 0 });
  }
}
