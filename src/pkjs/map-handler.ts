import { BehaviorSubject, filter, from, map, Observable, switchMap, takeUntil, tap } from 'rxjs';
import { MapState, renderForState, RenderOutput } from './server/stateRenderer';
import { Destination } from './index';
import { RouteResult } from './server/routing';
import { rleEncode } from './helper';

type PartialMapState = Partial<MapState>;

const DEFAULT_ZOOM = 14;
const DEFAULT_MODE = 'walking';
const DEFAULT_CHUNK = 8000;

export class MapHandler {
  private chunk_size: number = DEFAULT_CHUNK;
  private existingRoute: RouteResult | undefined = undefined;
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
    console.log('Platform=' + info.platform + ' size=' + w + 'x' + h);

    this.mapState
      .pipe(
        takeUntil(destroyApp),
        tap((state) => console.info(JSON.stringify(state))),
        filter(
          (state): boolean =>
            state.zoom !== undefined &&
            state.height !== undefined &&
            state.width !== undefined &&
            state.currentPos !== undefined &&
            state.mode !== undefined,
        ),
        map((state: PartialMapState) => <MapState>state),
        tap(() => console.info('Filter cleared')),
        switchMap((state) => from(renderForState(state, this.existingRoute))),
      )
      .subscribe(this.onMapRendered);

    // Set initial Data
    this.mapState.next({
      ...this.mapState.value,
      zoom: DEFAULT_ZOOM,
      mode: DEFAULT_MODE,
      width: w,
      height: h,
    });
  }

  public setImageChunkSize(size: number) {
    console.info('setImageChunkSize', size);

    this.chunk_size = size;
  }

  public updatePosition(pos: GeolocationPosition): void {
    console.info('updatePosition', JSON.stringify(pos));

    this.mapState.next({
      ...this.mapState.value,
      currentPos: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      bearing: pos.coords.heading ?? undefined,
    });
  }

  public selectRoute(destination: Destination): void {
    console.info('selectRoute', JSON.stringify(destination));

    const state = this.mapState.value;

    this.mapState.next({
      ...state,
      dest: destination,
      origin: state.currentPos,
    });
  }

  public resetRoute(): void {
    console.info('resetRoute');

    this.existingRoute = undefined;
    this.mapState.next({
      ...this.mapState.value,
      dest: undefined,
      origin: undefined,
    });
  }

  public zoom(zoom: number): void {
    console.info('zoom', zoom);

    const state = this.mapState.value;

    let newZoom = state.zoom ?? DEFAULT_ZOOM + zoom;
    newZoom = Math.max(1, Math.min(18, newZoom));

    this.mapState.next({
      ...state,
      zoom: newZoom,
    });
  }

  private onMapRendered(renderOutput: RenderOutput): void {
    console.info('onStateChanged');
    this.existingRoute = renderOutput.route;

    //this.sendBitmapToWatch(renderOutput.pixels);
    //this.sendRouteToWatch(renderOutput);
  }

  private sendBitmapToWatch(pixels: Uint8Array): void {
    const chunkSize = this.chunk_size;
    const compressed = rleEncode(pixels);
    const totalChunks = Math.ceil(compressed.length / chunkSize);
    console.log(
      'sendBitmapToWatch: pixels=' +
        pixels.length +
        ' bytes, compressed=' +
        compressed.length +
        ', chunks=' +
        totalChunks,
    );

    const sendChunk = (index: number): void => {
      if (index >= totalChunks) {
        return;
      }
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, compressed.length);
      const bytes: number[] = [];
      for (let i = start; i < end; i++) {
        bytes.push(compressed[i]);
      }

      console.log('Sending chunk ' + index + '/' + totalChunks + ' (' + bytes.length + ' bytes)');

      Pebble.sendAppMessage(
        {
          IMAGE_CHUNK_INDEX: index,
          IMAGE_CHUNKS_TOTAL: totalChunks,
          IMAGE_CHUNK_DATA: bytes,
        },
        function () {
          console.log('Chunk ' + index + ' acked');
          sendChunk(index + 1);
        },
        function (err: any) {
          console.log('Chunk ' + index + ' failed: ' + JSON.stringify(err));
        },
      );
    };

    sendChunk(0);
  }

  private sendRouteToWatch(output: RenderOutput): void {
    if (!output.route) return;

    const dict: Record<string, any> = {
      ROUTE_DISTANCE: Math.round(output.route.distance),
      ROUTE_DURATION: Math.round(output.route.duration / 60),
    };

    const ns = output.nextStep;
    if (ns) {
      dict.NEXT_STEP_TYPE = ns.step.type;
      dict.NEXT_STEP_MODIFIER = ns.step.modifier || '';
      dict.NEXT_STEP_NAME = ns.step.name || '';
      dict.NEXT_STEP_DISTANCE = Math.round(ns.remainingDist);
    }

    Pebble.sendAppMessage(
      dict,
      function () {},
      function (err) {
        console.log('Route info send failed: ' + err);
      },
    );
  }
}
