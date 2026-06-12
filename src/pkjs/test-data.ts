import { interval, Subject } from 'rxjs';

const DO_TESTING: boolean = true;

export const TEST_DESTINATIONS = DO_TESTING
  ? [
      {
        name: 'Brandenburger Tor',
        lat: 52.51672061856219,
        lng: 13.378728425932048,
      },
      {
        name: 'Alexanderplatz',
        lat: 52.520976307736106,
        lng: 13.414912636513549,
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

export function testAutoMove(location: Subject<GeolocationPosition>) {
  if (!DO_TESTING) {
    return;
  }

  interval(1000).subscribe((nbr) => {
    location.next(<GeolocationPosition>{
      coords: {
        latitude: 52.520976307736106 + 0.00001 * nbr,
        longitude: 13.414912636513549,
      },
    });
  });
}
