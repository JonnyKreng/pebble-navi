import { VERSION } from './version';

const OTLP_ENDPOINT =
  'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp/v1/logs';
const OTLP_HEADERS: Record<string, string> = {
  Authorization:
    'Basic MTY5MDU4MTpnbGNfZXlKdklqb2lNVGd4TVRZNE1TSXNJbTRpT2lKdVlYWnBMV0Z3Y0NJc0ltc2lPaUpIWlRZNFYwYzNZemcwT1d0TWEwbExNVGxZTjAxd05Ia2lMQ0p0SWpwN0luSWlPaUp3Y205a0xXVjFMWGRsYzNRdE1pSjlmUT09',
};
const TELEMETRY_KEY = 'telemetry_enabled';
const FLUSH_INTERVAL_MS = 10000;
const BATCH_SIZE = 50;

interface LogEntry {
  time: string;
  severity: string;
  severityNumber: number;
  body: string;
}

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;

let watchInfo: { platform: string; model: string; firmware: string } | null = null;
const sessionId =
  Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);

function severityNumber(level: string): number {
  switch (level) {
    case 'ERROR':
      return 17;
    case 'WARN':
      return 13;
    case 'INFO':
      return 9;
    case 'DEBUG':
      return 5;
    default:
      return 9;
  }
}

export function isTelemetryEnabled(): boolean {
  try {
    return localStorage.getItem(TELEMETRY_KEY) === 'true';
  } catch {
    return false;
  }
}

function sendBatch(): void {
  while (buffer.length > 0) {
    const batch = buffer.splice(0, BATCH_SIZE);
    const body = JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'pebble-navi' } },
              { key: 'service.version', value: { stringValue: VERSION } },
              { key: 'session.id', value: { stringValue: sessionId } },
              ...(watchInfo
                ? [
                    { key: 'device.platform', value: { stringValue: watchInfo.platform } },
                    { key: 'device.model', value: { stringValue: watchInfo.model } },
                    { key: 'device.firmware', value: { stringValue: watchInfo.firmware } },
                  ]
                : []),
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'pebble-navi' },
              logRecords: batch.map((e) => ({
                timeUnixNano: e.time,
                severityNumber: e.severityNumber,
                severityText: e.severity,
                body: { stringValue: e.body },
              })),
            },
          ],
        },
      ],
    });
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', OTLP_ENDPOINT, true);
      for (const k of Object.keys(OTLP_HEADERS)) {
        xhr.setRequestHeader(k, OTLP_HEADERS[k]);
      }
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(body);
    } catch (_) {}
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    sendBatch();
    scheduleFlush();
  }, FLUSH_INTERVAL_MS);
}

export function setWatchInfo(info: {
  platform: string;
  model: string;
  firmware: { major: number; minor: number; versionString?: string };
}): void {
  watchInfo = {
    platform: info.platform,
    model: info.model,
    firmware: info.firmware.versionString || info.firmware.major + '.' + info.firmware.minor,
  };
}

export function flushTelemetry(): void {
  sendBatch();
}

export function initTelemetry(): void {
  if (hooked) return;
  hooked = true;

  const levels: [string, string][] = [
    ['log', 'INFO'],
    ['info', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERROR'],
    ['debug', 'DEBUG'],
  ];

  const orig: Record<string, (...args: any[]) => void> = {};
  const hookedMethods: [string, string][] = [];
  for (const [method, severity] of levels) {
    if (typeof (console as any)[method] !== 'function') continue;
    orig[method] = (console as any)[method].bind(console);
    hookedMethods.push([method, severity]);
  }

  for (const [method, severity] of hookedMethods) {
    (console as any)[method] = function (...args: any[]) {
      orig[method].apply(console, args);
      if (isTelemetryEnabled()) {
        const body = args
          .map((a: any) =>
            typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a),
          )
          .join(' ');
        buffer.push({
          time: String(Date.now()) + '000000',
          severity,
          severityNumber: severityNumber(severity),
          body,
        });
      }
    };
  }

  scheduleFlush();
}
