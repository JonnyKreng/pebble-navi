import { callbackForAck, callbackForNack, loadDestinations } from './helper';

export function sendDestinationsToWatch(): void {
  const names = loadDestinations().map(function (d) {
    return d.name || d.lat + ',' + d.lng;
  });
  Pebble.sendAppMessage(
    { DEST_NAMES_TOTAL: names.length },
    function () {
      for (let i = 0; i < names.length; i++) {
        Pebble.sendAppMessage(
          {
            SELECTED_DEST_INDEX: i,
            NEXT_STEP_NAME: names[i],
          },
          callbackForAck,
          callbackForNack,
        );
      }
    },
    function () {},
  );
}
