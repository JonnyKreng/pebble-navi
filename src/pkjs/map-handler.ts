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
import { asciiNormalize, encodeAdaptive, loadSettings, loadUnits, saveSettings } from './helper';
import { messageQueue } from './message-queue';

type PartialMapState = Partial<MapState>;

const ENABLE_LOGS = true;
const DEFAULT_ZOOM = 16;
const DEFAULT_CHUNK = 1024;

export const RouteMode = {
  WALKING: 0,
  CYCLING: 1,
  DRIVING: 2,
} as const;

const ROUTE_MODE_NAMES: Record<number, string> = {
  [RouteMode.WALKING]: 'walking',
  [RouteMode.CYCLING]: 'cycling',
  [RouteMode.DRIVING]: 'driving',
} as const;

export class MapHandler {
  private chunk_size: number = DEFAULT_CHUNK;
  private existingRoute: RouteResult | undefined = undefined;
  private sending = false;
  private rendering = false;
  private lastRecalc = 0;
  private isBw = false;
  private rotationMode = false;
  private isEmulator = false;
  private readonly mapState = new BehaviorSubject<PartialMapState>({});
  private userVerticalOffset: number | undefined = undefined;

  constructor(destroyApp: Observable<void>) {
    const info = Pebble.getActiveWatchInfo();
    let w = 144;
    let h = 168;

    switch (info.platform) {
      case 'emery':
        w = 200;
        h = 228;
        break;
      case 'gabbro':
        w = 260;
        h = 260;
        this.userVerticalOffset = 0.7;
        break;
      case 'chalk':
        w = 180;
        h = 180;
        this.userVerticalOffset = 0.6;
        break;
      case 'flint':
      case 'aplite':
      case 'diorite':
        w = 144;
        h = 168;
        this.isBw = true;
        break;
      default:
        break;
    }

    if (ENABLE_LOGS) console.log('Platform=' + info.platform + ' model=' + info.model + ' size=' + w + 'x' + h);

    this.isEmulator = (info.model && info.model.indexOf('qemu') !== -1) || false;

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
            if (d > this.getRecalculationDistance() && this.canRecalc()) {
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
        switchMap((state) =>
          from(renderForState(state, this.existingRoute, this.isBw, this.userVerticalOffset)),
        ),
        tap(() => (this.rendering = false)),
        tap((output) => this.onMapRendered(output)),
        catchError((err) => {
          console.error('Map pipeline error:', err);
          this.rendering = false;
          return EMPTY;
        }),
      )
      .subscribe();

    // Set initial Data (load saved settings or use defaults)
    const saved = loadSettings();
    this.rotationMode = saved.rotationMode;
    this.mapState.next({
      ...this.mapState.value,
      zoom: saved.zoom,
      mode: saved.mode,
      width: w,
      height: h,
      rotationMode: saved.rotationMode,
    });
  }

  public setChunkSize(size: number): void {
    if (this.isEmulator) return;
    this.chunk_size = Math.max(DEFAULT_CHUNK, size - 128);
    if (ENABLE_LOGS) console.log('Chunk size set to', size);
  }

  public getRouteMode(): number {
    const mode = this.mapState.value.mode;
    if (mode === 'walking') return 0;
    if (mode === 'cycling') return 1;
    return 2;
  }

  public getRotationMode(): boolean {
    return this.rotationMode;
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

    this.existingRoute = undefined;
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

  public setMode(mode: number): void {
    console.log('setMode', mode);

    const name = ROUTE_MODE_NAMES[mode];
    if (name) {
      this.existingRoute = undefined;
      this.mapState.next({
        ...this.mapState.value,
        mode: name,
      });
      const s = this.mapState.value;
      saveSettings({ zoom: s.zoom!, mode: name, rotationMode: this.rotationMode });
    }
  }

  public setRotationMode(enabled: boolean): void {
    console.log('setRotationMode', enabled);
    this.rotationMode = enabled;
    this.mapState.next({
      ...this.mapState.value,
      rotationMode: enabled,
    });
    const s = this.mapState.value;
    saveSettings({ zoom: s.zoom!, mode: s.mode!, rotationMode: enabled });
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
    saveSettings({ zoom: newZoom, mode: state.mode!, rotationMode: this.rotationMode });
  }

  private canRecalc(): boolean {
    const now = Date.now();
    if (now - this.lastRecalc < 30000) return false;
    this.lastRecalc = now;
    return true;
  }

  private onMapRendered(renderOutput: RenderOutput): void {
    this.existingRoute = renderOutput.route;

    this.sendRouteToWatch(renderOutput);
    this.sendBitmapToWatch(renderOutput.pixels);
  }

  private sendBitmapToWatch(pixels: Uint8Array): void {
    if (this.sending) {
      return;
    }
    this.sending = true;

    const chunkSize = this.chunk_size;
    const compressed = encodeAdaptive(pixels);
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
    const units = loadUnits();

    if (!output.route) {
      dict.NAV_INFO_LINE1 = 'Select a Destination';
      dict.NAV_INFO_LINE2 = 'Add new Destinations in App Settings';
      dict.ROUTE_ACTIVE = 0;
    } else {
      const d = output.route.distance;
      const m = Math.round(output.route.duration / 60);
      const h = Math.floor(m / 60);
      const mins = m % 60;
      const time = h > 0 ? (mins > 0 ? `${h} h ${mins} min` : `${h} h`) : `${m} min`;

      if (units === 'imperial') {
        const mi = d / 1609.344;
        dict.NAV_INFO_LINE1 =
          mi >= 0.1 ? `${mi.toFixed(1)} mi  ${time}` : `${Math.round(d / 0.3048)} ft  ${time}`;
      } else {
        dict.NAV_INFO_LINE1 =
          d >= 1000 ? `${(d / 1000).toFixed(1)} km  ${time}` : `${Math.round(d)} m  ${time}`;
      }
      dict.ROUTE_ACTIVE = 1;

      const ns = output.nextStep;
      if (ns && Math.round(ns.remainingDist) > 0) {
        const stepDist =
          units === 'imperial'
            ? `${Math.round(ns.remainingDist / 0.3048)} ft`
            : `${Math.round(ns.remainingDist)} m`;
        dict.NAV_INFO_LINE2 = `${ns.step.modifier || ''} ${asciiNormalize(ns.step.name) || ''} (${stepDist})`;
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

  private getRecalculationDistance() {
    switch (this.mapState.value.mode) {
      case 'walking':
        return 15;
      case 'cycling':
        return 45;
      default:
        return 100;
    }
  }
}
