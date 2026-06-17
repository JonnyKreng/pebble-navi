import type { Destination } from './index';
import {
  loadDestinations,
  loadUnits,
  saveDestinations,
  saveUnits,
  loadTelemetryEnabled,
  saveTelemetryEnabled,
  loadExperimentalEnabled,
  saveExperimentalEnabled,
  loadSettings,
} from './helper';
import { SETTINGS_HTML } from './settings-template';

export function buildSettings(userLat?: number, userLng?: number): string {
  const destinations = loadDestinations();
  const units = loadUnits();
  const telemetry = loadTelemetryEnabled();
  const experimental = loadExperimentalEnabled();

  let html = SETTINGS_HTML;
  html = html.replace('__DESTINATIONS__', JSON.stringify(destinations));
  html = html.replace('__UNITS_METRIC_CHECKED__', units === 'metric' ? ' checked' : '');
  html = html.replace('__UNITS_IMPERIAL_CHECKED__', units === 'imperial' ? ' checked' : '');
  html = html.replace('__TELEMETRY_CHECKED__', telemetry ? ' checked' : '');
  html = html.replace('__EXPERIMENTAL_CHECKED__', experimental ? ' checked' : '');
  html = html.replace('__ROUTING_MODE__', loadSettings().mode);
  html = html.replace('__USER_LAT__', userLat !== undefined ? String(userLat) : 'undefined');
  html = html.replace('__USER_LNG__', userLng !== undefined ? String(userLng) : 'undefined');
  html = html.replace('__HAS_USER_POS__', userLat !== undefined ? 'true' : 'false');
  return html;
}

export function saveSettings(response: string): Destination[] {
  try {
    const data = JSON.parse(decodeURIComponent(response));
    if (data.destinations) {
      saveDestinations(data.destinations);
    }
    if (data.units) {
      saveUnits(data.units);
    }
    if (data.telemetry_enabled !== undefined) {
      saveTelemetryEnabled(data.telemetry_enabled);
    }
    if (data.experimental_enabled !== undefined) {
      saveExperimentalEnabled(data.experimental_enabled);
    }
  } catch (err) {
    console.log('Config parse error: ' + err);
  }
  return [];
}
