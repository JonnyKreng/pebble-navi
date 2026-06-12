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
import { worldPixel } from './server/osm';
import { Destination } from './index';
import { distanceToRoute, RouteResult } from './server/routing';
import { asciiNormalize, loadSettings, loadUnits, rleEncode, saveSettings } from './helper';
import { messageQueue } from './message-queue';

type PartialMapState = Partial<MapState>;

const ENABLE_LOGS = false;
const DEFAULT_ZOOM = 16;
const DEFAULT_MODE = 'walking';
const DEFAULT_CHUNK = 2048;

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
  private isFlint = false;
  private rotationMode = false;
  private mapTopLeftX = 0;
  private mapTopLeftY = 0;
  private expandedW = 0;
  private expandedH = 0;
  private lastPosTimestamp = 0;
  private lastUserBufX = 0;
  private lastUserBufY = 0;
  private readonly mapState = new BehaviorSubject<PartialMapState>({});

  constructor(destroyApp: Observable<void>) {
    const info = Pebble.getActiveWatchInfo();
    let w = 144;
    let h = 168;
    this.isFlint = info.platform === 'flint';
    if (info.platform === 'emery') {
      w = 200;
      h = 228;
    } else if (info.platform === 'gabbro') {
      w = 260;
      h = 260;
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
        switchMap((state) => from(renderForState(state, this.existingRoute, this.isFlint))),
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

    const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const bearing = pos.coords.heading ?? undefined;

    if (this.isWithinExpandedMap(newPos)) {
      this.sendPositionUpdate(newPos, bearing);
    } else {
      this.mapState.next({
        ...this.mapState.value,
        currentPos: newPos,
        bearing,
      });
    }
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
    messageQueue.enqueue(
      { ROTATION_MODE: enabled ? 1 : 0 },
      () => {},
      (err) => console.error('Rotation mode ack send failed: ' + err.error),
    );
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

  private isWithinExpandedMap(pos: { lat: number; lng: number }): boolean {
    if (this.expandedW === 0 || this.expandedH === 0) return false;

    const zoom = this.mapState.value.zoom;
    if (zoom === undefined) return false;

    const px = worldPixel(pos.lat, pos.lng, zoom);
    const bufX = px.wx - this.mapTopLeftX;
    const bufY = px.wy - this.mapTopLeftY;

    // Inner 60% safe zone (20% margin from each edge)
    const marginX = this.expandedW * 0.2;
    const marginY = this.expandedH * 0.2;

    return (
      bufX >= marginX &&
      bufX < this.expandedW - marginX &&
      bufY >= marginY &&
      bufY < this.expandedH - marginY
    );
  }

  private sendPositionUpdate(pos: { lat: number; lng: number }, bearing?: number): void {
    const zoom = this.mapState.value.zoom;
    if (zoom === undefined) return;
    if (this.expandedW === 0 || this.expandedH === 0) return;

    const px = worldPixel(pos.lat, pos.lng, zoom);
    const userBufX = Math.round(px.wx - this.mapTopLeftX);
    const userBufY = Math.round(px.wy - this.mapTopLeftY);

    // Compute velocity (fixed-point 8.7: value / 128 = pixels/sec)
    const now = Date.now();
    const dt = (now - this.lastPosTimestamp) / 1000;
    let vx = 0;
    let vy = 0;
    if (dt > 0.1 && dt <= 10) {
      vx = Math.round(((userBufX - this.lastUserBufX) / dt) * 128);
      vy = Math.round(((userBufY - this.lastUserBufY) / dt) * 128);
    }

    this.lastPosTimestamp = now;
    this.lastUserBufX = userBufX;
    this.lastUserBufY = userBufY;

    messageQueue.enqueue({
      USER_POS_X: userBufX,
      USER_POS_Y: userBufY,
      USER_BEARING: bearing !== undefined ? Math.round(bearing * 1000) : undefined,
      USER_VX: vx,
      USER_VY: vy,
    });
  }

  private onMapRendered(renderOutput: RenderOutput): void {
    this.existingRoute = renderOutput.route;
    this.mapTopLeftX = renderOutput.mapTopLeftX;
    this.mapTopLeftY = renderOutput.mapTopLeftY;
    this.expandedW = renderOutput.mapWidth;
    this.expandedH = renderOutput.mapHeight;

    // Compute initial user position in expanded map coords
    const pos = this.mapState.value.currentPos;
    const bearing = this.mapState.value.bearing;
    let initialUserX = 0;
    let initialUserY = 0;
    if (pos) {
      const zoom = this.mapState.value.zoom;
      if (zoom !== undefined) {
        const px = worldPixel(pos.lat, pos.lng, zoom);
        initialUserX = Math.round(px.wx - this.mapTopLeftX);
        initialUserY = Math.round(px.wy - this.mapTopLeftY);
      }
    }

    // Reset velocity tracking for the new map
    const now = Date.now();
    this.lastPosTimestamp = now;
    this.lastUserBufX = initialUserX;
    this.lastUserBufY = initialUserY;

    // Send map dimensions BEFORE bitmap chunks so watch can resize its buffer
    messageQueue.enqueue({
      USER_POS_X: initialUserX,
      USER_POS_Y: initialUserY,
      MAP_BUFFER_WIDTH: this.expandedW,
      MAP_BUFFER_HEIGHT: this.expandedH,
      USER_BEARING: bearing !== undefined ? Math.round(bearing * 1000) : undefined,
      USER_VX: 0,
      USER_VY: 0,
    });
    this.sendRouteToWatch(renderOutput);
    this.sendBitmapToWatch(renderOutput.pixels);
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
        dict.NAV_INFO_LINE1 = mi >= 0.1 ? `${mi.toFixed(1)} mi  ${time}` : `${Math.round(d / 0.3048)} ft  ${time}`;
      } else {
        dict.NAV_INFO_LINE1 = d >= 1000 ? `${(d / 1000).toFixed(1)} km  ${time}` : `${Math.round(d)} m  ${time}`;
      }
      dict.ROUTE_ACTIVE = 1;

      const ns = output.nextStep;
      if (ns && Math.round(ns.remainingDist) > 0) {
        const stepDist = units === 'imperial'
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
}
