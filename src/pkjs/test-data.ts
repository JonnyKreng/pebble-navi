const DO_TESTING: boolean = false;

export const TEST_DESTINATIONS = DO_TESTING
  ? [
      {
        name: 'Alexanderplatz',
        lat: 52.520976307736106,
        lng: 13.414912636513549,
      },
      {
        name: 'Tiergarten',
        lat: 52.520976307736106,
        lng: 13.414912636513549,
      },
      {
        name: 'Brandenburger Tor',
        lat: 52.51672061856219,
        lng: 13.378728425932048,
      },
    ]
  : [];

export function test_override(pos: GeolocationPosition): GeolocationPosition {
  if (!DO_TESTING) {
    return pos;
  }
  (<any>pos.coords.latitude) = 52.520976307736106;
  (<any>pos.coords.longitude) = 13.414912636513549;
  return pos;
}
