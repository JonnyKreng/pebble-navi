import './server/polyfills';
import { buildSettings, saveSettings } from './settings';
import { loadDestinations, rleEncode, saveDestinations } from './helper';
import { fromEvent, interval, map, startWith, Subject, takeUntil, tap } from 'rxjs';
import { sendDestinationsToWatch } from './destionations';
import { MapHandler } from './map-handler';

let CHUNK_SIZE = 8000;

const DEBUG_PNG = true;

console.log('JS App Started');

export interface Destination {
  lat: number;
  lng: number;
  name?: string;
}

const destroyApp = new Subject<void>();
const location = new Subject<GeolocationPosition>();

let navigationWatcher: number | undefined = undefined;

// The 'ready' event signals the start of a new app session.
// We use it to trigger the destruction of the *previous* session's resources.
const ready$ = fromEvent(Pebble, 'ready').pipe(
  tap(() => {
    // Destroy all old resources
    destroyApp.next();
    if (navigationWatcher !== undefined) {
      navigator.geolocation.clearWatch(navigationWatcher);
    }
  }),
);

ready$.subscribe(() => {
  console.log('PebbleKit JS ready! Setting up new session.');

  // All event listeners and subscriptions for the app session should be defined here
  // and use `takeUntil(destroyApp)` to ensure they are cleaned up when the next
  // 'ready' event arrives.

  const mapHandler = new MapHandler(destroyApp);

  fromEvent(Pebble, 'appmessage')
    .pipe(
      takeUntil(destroyApp),
      map((event) => event.payload as any),
    )
    .subscribe((payload) => {
      console.log('AppMessage received', JSON.stringify(payload));

      if (payload.REQUEST_DESTINATIONS !== undefined) {
        sendDestinationsToWatch();
      }

      if (payload.IMAGE_CHUNK_SIZE !== undefined) {
        mapHandler.setImageChunkSize(payload.IMAGE_CHUNK_SIZE);
      }

      if (payload.ZOOM_DIR !== undefined) {
        mapHandler.zoom(payload.ZOOM_DIR);
      }

      if (payload.SELECTED_DEST_INDEX !== undefined) {
        const destination = loadDestinations()[payload.SELECTED_DEST_INDEX];
        if (destination) {
          mapHandler.selectRoute(destination);
        } else {
          console.error('Destination not found, index', payload.SELECTED_DEST_INDEX);
        }
      }
    });

  fromEvent(Pebble, 'showConfiguration')
    .pipe(takeUntil(destroyApp))
    .subscribe(() => {
      console.log('showConfiguration event');

      Pebble.openURL('data:text/html,' + encodeURIComponent(buildSettings()));
    });

  fromEvent(Pebble, 'webviewclosed')
    .pipe(takeUntil(destroyApp))
    .subscribe((e) => {
      console.log('webviewclosed event', JSON.stringify(e));

      if (e.response) saveSettings(e.response);
    });

  location.pipe(takeUntil(destroyApp)).subscribe((pos: GeolocationPosition) => {
    console.log('geolocation event', JSON.stringify(pos));

    mapHandler.updatePosition(pos);
  });

  navigationWatcher = navigator.geolocation.watchPosition(location.next, console.error, {
    enableHighAccuracy: true,
    maximumAge: 5000,
  });

  Pebble.sendAppMessage(
    { JSReady: 1 },
    () => console.log('JSReady sent to watch'),
    (err) => console.log('JSReady send failed: ' + err),
  );

  console.log('App initialized');

  let latitude = 52.13876865070192;
  let longitude = 8.388358372735047;
  let bering = 0;

  interval(20000)
    .pipe(startWith(-1), takeUntil(destroyApp))
    .subscribe(() => {
      // Generate random position events
      latitude += (Math.random() - 0.5) / 1000;
      latitude += (Math.random() - 0.5) / 1000;
      bering += 10;

      console.log(latitude, longitude, bering);

      location.next(<GeolocationPosition>(<unknown>{
        coords: {
          latitude: latitude,
          longitude: longitude,
          bearing: bering,
        },
      }));
    });
});
