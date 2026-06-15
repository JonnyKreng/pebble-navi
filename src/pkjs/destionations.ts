import { asciiNormalize, loadDestinations } from './helper';

export function sendDestinationsToWatch(): void {
  const names = loadDestinations().map(function (d) {
    return asciiNormalize(d.name || d.lat + ',' + d.lng);
  });

  function sendNext(i: number) {
    if (i >= names.length) {
      return;
    }
    Pebble.sendAppMessage(
      {
        SELECTED_DEST_INDEX: i,
        DEST_NAME: names[i],
      },
      () => sendNext(i + 1),
      (err) => console.error('Destination send failed:', err.error),
    );
  }

  Pebble.sendAppMessage(
    { DEST_NAMES_TOTAL: names.length },
    () => sendNext(0),
    (err) => console.error('DEST_NAMES_TOTAL send failed:', err.error),
  );
}
