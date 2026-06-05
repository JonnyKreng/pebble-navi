import {
  BehaviorSubject,
  catchError,
  EMPTY,
  filter,
  from,
  map,
  Observable,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { MapState, renderForState, RenderOutput } from './server/stateRenderer';
import { Destination } from './index';
import { distanceToRoute, RouteResult } from './server/routing';
import { asciiNormalize, rleEncode } from './helper';
import { messageQueue } from './message-queue';

type PartialMapState = Partial<MapState>;

const ENABLE_LOGS = false;
const DEFAULT_ZOOM = 14;
const DEFAULT_MODE = 'walking';
const DEFAULT_CHUNK = 2048;

export class MapHandler {
  private chunk_size: number = DEFAULT_CHUNK;
  private existingRoute: RouteResult | undefined = undefined;
  private sending = false;
  private rendering = false;
  private lastRecalc = 0;
  private readonly mapState = new BehaviorSubject<PartialMapState>({});

  constructor(destroyApp: Observable<void>) {
    const info = Pebble.getActiveWatchInfo();
    let w = 144;
    let h = 168;
    if (info.platform === 'emery') {
      w = 200;
      h = 228;
    } else if (info.platform === 'chalk') {
      w = 180;
      h = 180;
    }
    if (ENABLE_LOGS) console.log('Platform=' + info.platform + ' size=' + w + 'x' + h);

    this.mapState
      .pipe(
        takeUntil(destroyApp),
        filter(
          (state): boolean =>
            state.zoom !== undefined &&
            state.height !== undefined &&
            state.width !== undefined &&
            state.currentPos !== undefined &&
            state.mode !== undefined,
        ),
        map((state: PartialMapState) => <MapState>state),
        filter(() => !this.rendering),
        tap(() => (this.rendering = true)),
        tap((state) => {
          if (
            this.existingRoute !== undefined &&
            state.currentPos !== undefined &&
            state.dest !== undefined
          ) {
            const d = distanceToRoute(
              state.currentPos.lat,
              state.currentPos.lng,
              this.existingRoute.coordinates,
            );
            if (d > 100 && this.canRecalc()) {
              console.log('Off route by ' + Math.round(d) + 'm, recalculating');
              this.existingRoute = undefined;
              state.origin = state.currentPos;
              messageQueue.enqueue(
                { NAV_INFO_LINE1: 'Recalculating...', NAV_INFO_LINE2: '', ROUTE_ACTIVE: 0 },
                () => {},
                (err) => console.error('Recalculating send failed: ' + err.error),
              );
            }
          }
        }),
        switchMap((state) => from(renderForState(state, this.existingRoute))),
        tap(() => (this.rendering = false)),
        tap((output) => this.onMapRendered(output)),
        catchError((err) => {
          console.error('Map pipeline error:', err);
          this.rendering = false;
          return EMPTY;
        }),
      )
      .subscribe();

    // Set initial Data
    this.mapState.next({
      ...this.mapState.value,
      zoom: DEFAULT_ZOOM,
      mode: DEFAULT_MODE,
      width: w,
      height: h,
    });
  }

  public updatePosition(pos: GeolocationPosition): void {
    if (ENABLE_LOGS) console.info('updatePosition', JSON.stringify(pos));

    this.mapState.next({
      ...this.mapState.value,
      currentPos: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      bearing: pos.coords.heading ?? undefined,
    });
  }

  public selectRoute(destination: Destination): void {
    if (ENABLE_LOGS) console.info('selectRoute', JSON.stringify(destination));

    const state = this.mapState.value;

    this.mapState.next({
      ...state,
      dest: destination,
      origin: state.currentPos,
    });
  }

  public getCurrentPosition(): { lat: number; lng: number } | undefined {
    return this.mapState.value.currentPos;
  }

  public resetRoute(): void {
    if (ENABLE_LOGS) console.info('resetRoute');

    this.existingRoute = undefined;
    this.mapState.next({
      ...this.mapState.value,
      dest: undefined,
      origin: undefined,
    });
  }

  public zoom(zoom: number): void {
    if (ENABLE_LOGS) console.info('zoom', zoom);

    const state = this.mapState.value;

    let newZoom = state.zoom ? state.zoom + zoom : DEFAULT_ZOOM;
    newZoom = Math.max(1, Math.min(18, newZoom));

    this.mapState.next({
      ...state,
      zoom: newZoom,
    });
  }

  private canRecalc(): boolean {
    const now = Date.now();
    if (now - this.lastRecalc < 30000) return false;
    this.lastRecalc = now;
    return true;
  }

  private onMapRendered(renderOutput: RenderOutput): void {
    this.existingRoute = renderOutput.route;

    this.sendBitmapToWatch(renderOutput.pixels);
    this.sendRouteToWatch(renderOutput);
  }

  private sendBitmapToWatch(pixels: Uint8Array): void {
    if (this.sending) {
      return;
    }
    this.sending = true;

    const chunkSize = this.chunk_size;
    const compressed = rleEncode(pixels);
    const totalChunks = Math.ceil(compressed.length / chunkSize);
    if (ENABLE_LOGS)
      console.log(
        'sendBitmapToWatch: pixels=' +
          pixels.length +
          ' bytes, compressed=' +
          compressed.length +
          ', chunks=' +
          totalChunks,
      );

    const MAX_RETRIES = 3;

    const sendChunk = (index: number, retries: number = MAX_RETRIES): void => {
      if (index >= totalChunks) {
        this.sending = false;
        if (ENABLE_LOGS) console.log('Finished sending chunk ' + totalChunks);
        return;
      }

      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, compressed.length);
      const bytes: number[] = [];
      for (let i = start; i < end; i++) {
        bytes.push(compressed[i]);
      }

      if (ENABLE_LOGS)
        console.log('Sending chunk ' + index + '/' + totalChunks + ' (' + bytes.length + ' bytes)');

      messageQueue.enqueue(
        {
          IMAGE_CHUNK_INDEX: index,
          IMAGE_CHUNKS_TOTAL: totalChunks,
          IMAGE_CHUNK_DATA: bytes,
        },
        () => {
          sendChunk(index + 1);
          if (ENABLE_LOGS) console.log('Chunk ' + index + ' acked');
        },
        (err: any) => {
          console.error('Chunk ' + index + ' failed: ' + JSON.stringify(err.error));
          if (retries > 0) {
            const delay = (MAX_RETRIES - retries + 1) * 1000;
            if (ENABLE_LOGS)
              console.log(
                'Retrying chunk ' + index + ' in ' + delay + 'ms (' + retries + ' retries left)',
              );
            setTimeout(() => sendChunk(index, retries - 1), delay);
          } else {
            console.error('Giving up on chunk ' + index + ' after ' + MAX_RETRIES + ' retries');
            this.sending = false;
          }
        },
      );
    };

    sendChunk(0);
  }

  private sendRouteToWatch(output: RenderOutput): void {
    const dict: Record<string, any> = {};
    if (!output.route) {
      dict.NAV_INFO_LINE1 = 'Select a Destination';
      dict.NAV_INFO_LINE2 = 'Add new Destinations in App Settings';
      dict.ROUTE_ACTIVE = 0;
    } else {
      const d = Math.round(output.route.distance);
      const m = Math.round(output.route.duration / 60);
      const h = Math.floor(m / 60);
      const mins = m % 60;
      const time = h > 0 ? (mins > 0 ? `${h} h ${mins} min` : `${h} h`) : `${m} min`;
      dict.NAV_INFO_LINE1 = d >= 1000 ? `${(d / 1000).toFixed(1)} km  ${time}` : `${d} m  ${time}`;
      dict.ROUTE_ACTIVE = 1;

      const ns = output.nextStep;
      if (ns && Math.round(ns.remainingDist) > 0) {
        dict.NAV_INFO_LINE2 = `${ns.step.modifier || ''} ${asciiNormalize(ns.step.name) || ''} (${Math.round(ns.remainingDist)} m)`;
      } else {
        dict.NAV_INFO_LINE2 = '';
      }
    }

    messageQueue.enqueue(
      dict,
      () => {},
      (err) => console.error('Route info send failed: ' + err.error),
    );
  }
}
