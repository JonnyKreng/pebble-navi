import './server/polyfills';
import { buildSettings, saveSettings } from './settings';
import { loadDestinations, loadShowDictation, saveDestinations } from './helper';
import { fromEvent, map, Subject, takeUntil, tap } from 'rxjs';
import { sendDestinationsToWatch } from './destionations';
import { dictateSearch, dictationResults } from './dictation';
import { MapHandler } from './map-handler';
import { DO_MOVEMENT_TESTING, ENABLE_LOGS, testAutoMove, testOverride } from './test-data';
import { initTelemetry, flushTelemetry, setWatchInfo } from './telemetry';

initTelemetry();
console.log('JS App Started');

export interface Destination {
  lat: number;
  lng: number;
  name?: string;
}

const destroyApp = new Subject<void>();
const location = new Subject<GeolocationPosition>();

let navigationWatcher: number | undefined;
let mapHandler: MapHandler | undefined;

// --- Persistent event listeners (registered at module load time, before 'ready') ---

fromEvent(Pebble, 'appmessage')
  .pipe(map((event) => event.payload as any))
  .subscribe({
    next: (payload) => {
      try {
        if (ENABLE_LOGS) console.log('AppMessage received');

        if (payload.REQUEST_DESTINATIONS !== undefined) {
          sendDestinationsToWatch();
        }

        if (mapHandler !== undefined) {
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

          if (payload.ROUTE_MODE !== undefined) {
            mapHandler.setMode(payload.ROUTE_MODE);
          }

          if (payload.ROTATION_MODE !== undefined) {
            mapHandler.setRotationMode(payload.ROTATION_MODE !== 0);
          }

          if (payload.MAX_MESSAGE_SIZE !== undefined) {
            mapHandler.setChunkSize(payload.MAX_MESSAGE_SIZE);
          }

          if (payload.STOP_ROUTING !== undefined) {
            mapHandler.resetRoute();
          }

          if (payload.DICTATE_TEXT !== undefined) {
            dictateSearch(payload.DICTATE_TEXT, mapHandler);
          }

          if (payload.DICTATE_SELECT_INDEX !== undefined) {
            const idx = payload.DICTATE_SELECT_INDEX as number;
            const result = dictationResults[idx];
            if (result) {
              mapHandler.selectRoute({ lat: result.lat, lng: result.lng, name: result.name });
            }
          }

          if (payload.SAVE_CURRENT_LOCATION !== undefined) {
            const pos = mapHandler.getCurrentPosition();
            if (pos) {
              const destinations = loadDestinations();
              const existing = destinations.find((d) => d.name === 'Saved Location');
              if (existing) {
                existing.lat = pos.lat;
                existing.lng = pos.lng;
              } else {
                destinations.push({ lat: pos.lat, lng: pos.lng, name: 'Saved Location' });
              }
              saveDestinations(destinations);
              console.log('Saved current location as Saved Location');
            } else {
              console.error('No current position available to save');
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    error: (err) => console.error('AppMessage subscription error:', err),
  });

fromEvent(Pebble, 'showConfiguration').subscribe(() => {
  console.log('showConfiguration event');
  try {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        Pebble.openURL(
          'data:text/html,' +
            encodeURIComponent(buildSettings(pos.coords.latitude, pos.coords.longitude)),
        );
      },
      () => {
        Pebble.openURL('data:text/html,' + encodeURIComponent(buildSettings()));
      },
      { enableHighAccuracy: false, timeout: 5000 },
    );
  } catch (e) {
    console.error(e);
  }
});

fromEvent(Pebble, 'webviewclosed').subscribe((e) => {
  console.log('webviewclosed event');
  try {
    if (e.response) {
      saveSettings(e.response);
      mapHandler?.onSettingsChanged();
      Pebble.sendAppMessage(
        { SHOW_DICTATION: loadShowDictation() ? 1 : 0 },
        () => {},
        (err) => console.error('SHOW_DICTATION send failed: ' + err.error),
      );
    }
    flushTelemetry();
  } catch (e) {
    console.error(e);
  }
});

// --- Session lifecycle ---

fromEvent(Pebble, 'ready')
  .pipe(
    tap(() => {
      destroyApp.next();
      if (navigationWatcher !== undefined) {
        navigator.geolocation.clearWatch(navigationWatcher);
        navigationWatcher = undefined;
      }
    }),
  )
  .subscribe(() => {
    try {
      console.log('PebbleKit JS ready! Setting up new session.');
      setWatchInfo(Pebble.getActiveWatchInfo());

      mapHandler = new MapHandler(destroyApp);

      // Sync saved settings to watch on connect
      Pebble.sendAppMessage(
        {
          ROUTE_MODE: mapHandler.getRouteMode(),
          ROTATION_MODE: mapHandler.getRotationMode() ? 1 : 0,
          SHOW_DICTATION: loadShowDictation() ? 1 : 0,
        },
        () => {},
        (err) => console.error('Initial state send failed: ' + err.error),
      );

      location.pipe(takeUntil(destroyApp)).subscribe({
        next: (pos: GeolocationPosition) => {
          if (ENABLE_LOGS) console.log('geolocation event');
          mapHandler?.updatePosition(pos);
        },
        error: (err) => console.error('Location subscription error:', err),
      });

      navigationWatcher = navigator.geolocation.watchPosition(
        (pos) => {
          if (!DO_MOVEMENT_TESTING) location.next(testOverride(pos));
        },
        console.error,
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
        },
      );

      console.log('App initialized');
    } catch (e) {
      console.error(e);
    }
  });

testAutoMove(location, () => mapHandler?.getRouteCoords());
