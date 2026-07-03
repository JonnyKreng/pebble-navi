import { interval, Subject } from 'rxjs';
import { isTelemetryEnabled } from './telemetry';

export const ENABLE_LOGS = isTelemetryEnabled();
export const DO_TESTING: boolean = false;
export const DO_MOVEMENT_TESTING: boolean = false;

export const TEST_DESTINATIONS = DO_TESTING
  ? [
      {
        name: 'Brandenburger Tor',
        lat: 52.51672061856219,
        lng: 13.378728425932048,
      },
      {
        name: 'Alexanderplatz',
        lat: 52.520976407736106,
        lng: 13.414212636513549,
      },
    ]
  : [];

export function testOverride(pos: GeolocationPosition): GeolocationPosition {
  if (!DO_TESTING) {
    return pos;
  }

  (<any>pos.coords.latitude) = 52.520976307736106;
  (<any>pos.coords.longitude) = 13.414912636513549;
  return pos;
}

function jitter(): number {
  return (Math.random() - 0.5) * 0.00008;
}

export function testAutoMove(
  location: Subject<GeolocationPosition>,
  getRouteCoords?: () => [number, number][] | undefined,
) {
  if (!DO_MOVEMENT_TESTING) {
    return;
  }

  let routeIndex = 0;
  let prevCoords: [number, number][] | undefined;

  interval(1000).subscribe((nbr) => {
    const coords = getRouteCoords?.();

    if (coords && coords.length > 0) {
      if (coords !== prevCoords) routeIndex = 0;
      prevCoords = coords;
      routeIndex = Math.min(routeIndex, coords.length - 1);
      const [lng, lat] = coords[routeIndex];
      location.next(<GeolocationPosition>{
        coords: { latitude: lat + jitter(), longitude: lng + jitter() },
      });
      routeIndex++;
      if (routeIndex >= coords.length) routeIndex = 0;
    } else {
      location.next(<GeolocationPosition>{
        coords: {
          latitude: 52.520976307736106 + jitter(),
          longitude: 13.414912636513549 - 0.0001 * nbr + jitter(),
        },
      });
      routeIndex = 0;
    }
  });
}
