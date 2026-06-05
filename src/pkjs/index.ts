import './server/polyfills';
import { buildSettings, saveSettings } from './settings';
import { loadDestinations, saveDestinations } from './helper';
import { fromEvent, map, Subject, takeUntil, tap } from 'rxjs';
import { sendDestinationsToWatch } from './destionations';
import { MapHandler } from './map-handler';

const ENABLE_LOGS = false;

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
  .subscribe((payload) => {
    try {
      if (ENABLE_LOGS) console.log('AppMessage received', JSON.stringify(payload));

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

        if (payload.STOP_ROUTING !== undefined) {
          mapHandler.resetRoute();
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
  });

fromEvent(Pebble, 'showConfiguration').subscribe(() => {
  console.log('showConfiguration event');
  try {
    Pebble.openURL('data:text/html,' + encodeURIComponent(buildSettings()));
  } catch (e) {
    console.error(e);
  }
});

fromEvent(Pebble, 'webviewclosed').subscribe((e) => {
  console.log('webviewclosed event', JSON.stringify(e));
  try {
    if (e.response) saveSettings(e.response);
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

      mapHandler = new MapHandler(destroyApp);

      location.pipe(takeUntil(destroyApp)).subscribe((pos: GeolocationPosition) => {
        if (ENABLE_LOGS) console.log('geolocation event', JSON.stringify(pos));
        mapHandler?.updatePosition(pos);
      });

      navigationWatcher = navigator.geolocation.watchPosition(
        (pos) => location.next(pos),
        console.error,
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
        },
      );

      console.log('App initialized');

      // ## Random Mover to test navigation in emulator
      // let latitude = 52.13876865070192;
      // let longitude = 8.388358372735047;
      // let bering = 0;
      //
      // interval(2000)
      //   .pipe(startWith(-1), takeUntil(destroyApp))
      //   .subscribe(() => {
      //     // Generate random position events
      //     latitude += (Math.random() + 0.3) / 1000;
      //     longitude -= (Math.random() + 0.3) / 1000;
      //     bering += 10;
      //     bering = bering % 360;
      //
      //     location.next(<GeolocationPosition>(<unknown>{
      //       coords: {
      //         latitude: latitude,
      //         longitude: longitude,
      //         bearing: bering,
      //       },
      //     }));
      //   });
    } catch (e) {
      console.error(e);
    }
  });
