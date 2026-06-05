import './server/polyfills';
import { BuildSettingsMenu } from './settings';
import { createPipeline, MapState, RenderOutput } from './server/pipeline';

let CHUNK_SIZE = 8000;

const DEBUG_PNG = true;

console.log('JS App Started');

export interface Destination {
  lat: number;
  lng: number;
  name?: string;
}

interface Pipeline {
  setState(partial: Partial<MapState>): void;
  render(): Promise<RenderOutput>;
  getState(): MapState;
}

let pipeline: Pipeline | null = null;
let destinations: Destination[] = [];
let rendering = false;
let sendGeneration = 0;
let lastPosition: { lat: number; lng: number } | null = null;

function loadDestinations(): void {
  try {
    const saved = localStorage.getItem('destinations');
    if (saved) destinations = JSON.parse(saved);
  } catch (e) {
    destinations = [];
  }
}

function saveDestinations(): void {
  try {
    localStorage.setItem('destinations', JSON.stringify(destinations));
  } catch (e) {}
}

function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let runLen = 1;
    while (i + runLen < data.length && data[i + runLen] === val && runLen < 256) {
      runLen++;
    }
    if (runLen >= 2) {
      out.push(64, runLen - 1, val);
      i += runLen;
    } else {
      out.push(val);
      i++;
    }
  }
  return new Uint8Array(out);
}

function sendBitmapToWatch(pixels: Uint8Array, onDone?: () => void): void {
  const gen = ++sendGeneration;
  const compressed = rleEncode(pixels);
  const totalChunks = Math.ceil(compressed.length / CHUNK_SIZE);
  if (DEBUG_PNG)
    console.log(
      'sendBitmapToWatch: gen=' +
        gen +
        ' pixels=' +
        pixels.length +
        ' bytes, compressed=' +
        compressed.length +
        ', chunks=' +
        totalChunks,
    );

  sendChunk(0);

  function sendChunk(index: number): void {
    if (gen !== sendGeneration) {
      if (DEBUG_PNG) console.log('Chunk send cancelled at index ' + index + ' (gen ' + gen + ')');
      return;
    }
    if (index >= totalChunks) {
      if (DEBUG_PNG) console.log('All ' + totalChunks + ' chunks sent');
      if (onDone) onDone();
      return;
    }
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, compressed.length);
    const bytes: number[] = [];
    for (let i = start; i < end; i++) {
      bytes.push(compressed[i]);
    }

    if (DEBUG_PNG)
      console.log('Sending chunk ' + index + '/' + totalChunks + ' (' + bytes.length + ' bytes)');

    Pebble.sendAppMessage(
      {
        IMAGE_CHUNK_INDEX: index,
        IMAGE_CHUNKS_TOTAL: totalChunks,
        IMAGE_CHUNK_DATA: bytes,
      },
      function () {
        if (gen !== sendGeneration) {
          if (DEBUG_PNG) console.log('Chunk ' + index + ' ack cancelled (gen ' + gen + ')');
          return;
        }
        if (DEBUG_PNG) console.log('Chunk ' + index + ' acked');
        sendChunk(index + 1);
      },
      function (err: any) {
        if (DEBUG_PNG) console.log('Chunk ' + index + ' failed: ' + JSON.stringify(err));
        if (onDone) onDone();
      },
    );
  }
}
function sendRouteToWatch(output: RenderOutput): void {
  if (!output.route) return;
  const ns = output.nextStep;
  const dict: Record<string, any> = {
    ROUTE_DISTANCE: Math.round(output.route.distance),
    ROUTE_DURATION: Math.round(output.route.duration / 60),
  };
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

function refresh(): void {
  if (rendering) {
    console.log('refresh: already rendering, skipping');
    return;
  }
  if (!pipeline) {
    console.log('refresh: pipeline not ready');
    return;
  }
  rendering = true;
  console.log('refresh: starting render');
  pipeline
    .render()
    .then(function (output) {
      if (DEBUG_PNG) console.log('render done: pixels=' + output.pixels.length + ' bytes');
      sendBitmapToWatch(output.pixels, function () {
        rendering = false;
      });
      sendRouteToWatch(output);
    })
    .catch(function (err) {
      rendering = false;
      console.log('Render error: ' + (err.stack || err));
    });
}

function locationSuccess(pos: GeolocationPosition): void {
  if (!pipeline) return;

  lastPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };

  pipeline.setState({
    currentPos: { lat: pos.coords.latitude, lng: pos.coords.longitude },
    bearing: pos.coords.heading || undefined,
  });
  refresh();
}

function locationError(err: GeolocationPositionError): void {
  console.log('GPS error: ' + err.message);
}

function sendDestinationsToWatch(): void {
  const names = destinations.map(function (d) {
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
          function () {},
          function () {},
        );
      }
    },
    function () {},
  );
}

Pebble.addEventListener('ready', function () {
  console.log('PebbleKit JS ready!');

  Pebble.sendAppMessage(
    { JSReady: 1 },
    function () {
      console.log('JSReady sent to watch');
    },
    function (err) {
      console.log('JSReady send failed: ' + err);
    },
  );

  loadDestinations();

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

  navigator.geolocation.getCurrentPosition(
    function (pos) {
      lastPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!pipeline) {
        pipeline = createPipeline({
          origin: { lat:  pos.coords.latitude, lng: pos.coords.longitude },
          zoom: 14,
          mode: 'walking',
          width: w,
          height: h,
        });
      } else {
        pipeline.setState({
          currentPos: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          bearing: pos.coords.heading || undefined,
        });
      }

      refresh();
    },
    locationError,
    { timeout: 15000, maximumAge: 60000 },
  );

  navigator.geolocation.watchPosition(locationSuccess, locationError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
  });
});

Pebble.addEventListener('appmessage', function (e) {
  console.log('AppMessage received');
  const payload = e.payload as any;
  if (payload.IMAGE_CHUNK_SIZE != null) {
    CHUNK_SIZE = payload.IMAGE_CHUNK_SIZE;
    if (DEBUG_PNG) console.log('Chunk size set to ' + CHUNK_SIZE + ' from watch');
  }
  if (payload.ZOOM_DIR != null) {
    if (!pipeline) return;
    sendGeneration++;
    rendering = false;
    const dir = payload.ZOOM_DIR;
    const state = pipeline.getState();
    let newZoom = dir === 1 ? state.zoom + 1 : state.zoom - 1;
    newZoom = Math.max(1, Math.min(18, newZoom));
    pipeline.setState({ zoom: newZoom });
    refresh();
  }

  if (payload.REQUEST_DESTINATIONS) {
    sendDestinationsToWatch();
  }

  if (payload.SELECTED_DEST_INDEX != null && destinations[payload.SELECTED_DEST_INDEX]) {
    if (!pipeline) return;
    const dest = destinations[payload.SELECTED_DEST_INDEX];
    const origin = lastPosition ||
      pipeline.getState().currentPos || { lat: dest.lat, lng: dest.lng };
    pipeline.setState({
      dest: { lat: dest.lat, lng: dest.lng },
      origin: { lat: origin.lat, lng: origin.lng },
    });
    refresh();
  }
});

Pebble.addEventListener('showConfiguration', function () {
  const apiKey = localStorage.getItem('ors_api_key') || '';
  const html = BuildSettingsMenu(destinations, apiKey);
  Pebble.openURL('data:text/html,' + encodeURIComponent(html));
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e.response) return;
  try {
    const data = JSON.parse(decodeURIComponent(e.response));
    if (data.destinations) {
      destinations = data.destinations;
      saveDestinations();
    }
    if (data.ors_api_key) {
      localStorage.setItem('ors_api_key', data.ors_api_key);
    }
  } catch (err) {
    console.log('Config parse error: ' + err);
  }
});
