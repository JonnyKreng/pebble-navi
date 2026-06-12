"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapHandler = exports.RouteMode = void 0;
var rxjs_1 = require("rxjs");
var stateRenderer_1 = require("./server/stateRenderer");
var routing_1 = require("./server/routing");
var helper_1 = require("./helper");
var message_queue_1 = require("./message-queue");
var ENABLE_LOGS = true;
var DEFAULT_ZOOM = 16;
var DEFAULT_CHUNK = 1024;
exports.RouteMode = {
    WALKING: 0,
    CYCLING: 1,
    DRIVING: 2,
};
var ROUTE_MODE_NAMES = (_a = {},
    _a[exports.RouteMode.WALKING] = 'walking',
    _a[exports.RouteMode.CYCLING] = 'cycling',
    _a[exports.RouteMode.DRIVING] = 'driving',
    _a);
var MapHandler = /** @class */ (function () {
    function MapHandler(destroyApp) {
        var _this = this;
        this.chunk_size = DEFAULT_CHUNK;
        this.existingRoute = undefined;
        this.sending = false;
        this.rendering = false;
        this.lastRecalc = 0;
        this.isBw = false;
        this.rotationMode = false;
        this.isEmulator = false;
        this.mapState = new rxjs_1.BehaviorSubject({});
        this.userVerticalOffset = undefined;
        var info = Pebble.getActiveWatchInfo();
        var w = 144;
        var h = 168;
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
        if (ENABLE_LOGS)
            console.log('Platform=' + info.platform + ' model=' + info.model + ' size=' + w + 'x' + h);
        this.isEmulator = (info.model && info.model.indexOf('qemu') !== -1) || false;
        this.mapState
            .pipe((0, rxjs_1.takeUntil)(destroyApp), (0, rxjs_1.filter)(function (state) {
            return state.zoom !== undefined &&
                state.height !== undefined &&
                state.width !== undefined &&
                state.currentPos !== undefined &&
                state.mode !== undefined;
        }), (0, rxjs_1.map)(function (state) { return state; }), (0, rxjs_1.filter)(function () { return !_this.rendering; }), (0, rxjs_1.tap)(function () { return (_this.rendering = true); }), (0, rxjs_1.tap)(function (state) {
            if (_this.existingRoute !== undefined &&
                state.currentPos !== undefined &&
                state.dest !== undefined) {
                var d = (0, routing_1.distanceToRoute)(state.currentPos.lat, state.currentPos.lng, _this.existingRoute.coordinates);
                if (d > _this.getRecalculationDistance() && _this.canRecalc()) {
                    console.log('Off route by ' + Math.round(d) + 'm, recalculating');
                    _this.existingRoute = undefined;
                    state.origin = state.currentPos;
                    message_queue_1.messageQueue.enqueue({ NAV_INFO_LINE1: 'Recalculating...', NAV_INFO_LINE2: '', ROUTE_ACTIVE: 0 }, function () { }, function (err) { return console.error('Recalculating send failed: ' + err.error); });
                }
            }
        }), (0, rxjs_1.switchMap)(function (state) {
            return (0, rxjs_1.from)((0, stateRenderer_1.renderForState)(state, _this.existingRoute, _this.isBw, _this.userVerticalOffset));
        }), (0, rxjs_1.tap)(function () { return (_this.rendering = false); }), (0, rxjs_1.tap)(function (output) { return _this.onMapRendered(output); }), (0, rxjs_1.catchError)(function (err) {
            console.error('Map pipeline error:', err);
            _this.rendering = false;
            return rxjs_1.EMPTY;
        }))
            .subscribe();
        // Set initial Data (load saved settings or use defaults)
        var saved = (0, helper_1.loadSettings)();
        this.rotationMode = saved.rotationMode;
        this.mapState.next(__assign(__assign({}, this.mapState.value), { zoom: saved.zoom, mode: saved.mode, width: w, height: h, rotationMode: saved.rotationMode }));
    }
    MapHandler.prototype.setChunkSize = function (size) {
        if (this.isEmulator)
            return;
        this.chunk_size = Math.max(DEFAULT_CHUNK, size - 128);
        if (ENABLE_LOGS)
            console.log('Chunk size set to', size);
    };
    MapHandler.prototype.getRouteMode = function () {
        var mode = this.mapState.value.mode;
        if (mode === 'walking')
            return 0;
        if (mode === 'cycling')
            return 1;
        return 2;
    };
    MapHandler.prototype.getRotationMode = function () {
        return this.rotationMode;
    };
    MapHandler.prototype.updatePosition = function (pos) {
        var _a;
        if (ENABLE_LOGS)
            console.info('updatePosition', JSON.stringify(pos));
        this.mapState.next(__assign(__assign({}, this.mapState.value), { currentPos: { lat: pos.coords.latitude, lng: pos.coords.longitude }, bearing: (_a = pos.coords.heading) !== null && _a !== void 0 ? _a : undefined }));
    };
    MapHandler.prototype.selectRoute = function (destination) {
        if (ENABLE_LOGS)
            console.info('selectRoute', JSON.stringify(destination));
        this.existingRoute = undefined;
        var state = this.mapState.value;
        this.mapState.next(__assign(__assign({}, state), { dest: destination, origin: state.currentPos }));
    };
    MapHandler.prototype.getCurrentPosition = function () {
        return this.mapState.value.currentPos;
    };
    MapHandler.prototype.resetRoute = function () {
        if (ENABLE_LOGS)
            console.info('resetRoute');
        this.existingRoute = undefined;
        this.mapState.next(__assign(__assign({}, this.mapState.value), { dest: undefined, origin: undefined }));
    };
    MapHandler.prototype.setMode = function (mode) {
        console.log('setMode', mode);
        var name = ROUTE_MODE_NAMES[mode];
        if (name) {
            this.existingRoute = undefined;
            this.mapState.next(__assign(__assign({}, this.mapState.value), { mode: name }));
            var s = this.mapState.value;
            (0, helper_1.saveSettings)({ zoom: s.zoom, mode: name, rotationMode: this.rotationMode });
        }
    };
    MapHandler.prototype.setRotationMode = function (enabled) {
        console.log('setRotationMode', enabled);
        this.rotationMode = enabled;
        this.mapState.next(__assign(__assign({}, this.mapState.value), { rotationMode: enabled }));
        var s = this.mapState.value;
        (0, helper_1.saveSettings)({ zoom: s.zoom, mode: s.mode, rotationMode: enabled });
    };
    MapHandler.prototype.zoom = function (zoom) {
        if (ENABLE_LOGS)
            console.info('zoom', zoom);
        var state = this.mapState.value;
        var newZoom = state.zoom ? state.zoom + zoom : DEFAULT_ZOOM;
        newZoom = Math.max(1, Math.min(18, newZoom));
        this.mapState.next(__assign(__assign({}, state), { zoom: newZoom }));
        (0, helper_1.saveSettings)({ zoom: newZoom, mode: state.mode, rotationMode: this.rotationMode });
    };
    MapHandler.prototype.canRecalc = function () {
        var now = Date.now();
        if (now - this.lastRecalc < 30000)
            return false;
        this.lastRecalc = now;
        return true;
    };
    MapHandler.prototype.onMapRendered = function (renderOutput) {
        this.existingRoute = renderOutput.route;
        this.sendRouteToWatch(renderOutput);
        this.sendBitmapToWatch(renderOutput.pixels);
    };
    MapHandler.prototype.sendBitmapToWatch = function (pixels) {
        var _this = this;
        if (this.sending) {
            return;
        }
        this.sending = true;
        var chunkSize = this.chunk_size;
        var compressed = (0, helper_1.encodeAdaptive)(pixels);
        var totalChunks = Math.ceil(compressed.length / chunkSize);
        if (ENABLE_LOGS)
            console.log('sendBitmapToWatch: pixels=' +
                pixels.length +
                ' bytes, compressed=' +
                compressed.length +
                ', chunks=' +
                totalChunks);
        var MAX_RETRIES = 3;
        var sendChunk = function (index, retries) {
            if (retries === void 0) { retries = MAX_RETRIES; }
            if (index >= totalChunks) {
                _this.sending = false;
                if (ENABLE_LOGS)
                    console.log('Finished sending chunk ' + totalChunks);
                return;
            }
            var start = index * chunkSize;
            var end = Math.min(start + chunkSize, compressed.length);
            var bytes = [];
            for (var i = start; i < end; i++) {
                bytes.push(compressed[i]);
            }
            if (ENABLE_LOGS)
                console.log('Sending chunk ' + index + '/' + totalChunks + ' (' + bytes.length + ' bytes)');
            message_queue_1.messageQueue.enqueue({
                IMAGE_CHUNK_INDEX: index,
                IMAGE_CHUNKS_TOTAL: totalChunks,
                IMAGE_CHUNK_DATA: bytes,
            }, function () {
                sendChunk(index + 1);
                if (ENABLE_LOGS)
                    console.log('Chunk ' + index + ' acked');
            }, function (err) {
                console.error('Chunk ' + index + ' failed: ' + JSON.stringify(err.error));
                if (retries > 0) {
                    var delay = (MAX_RETRIES - retries + 1) * 1000;
                    if (ENABLE_LOGS)
                        console.log('Retrying chunk ' + index + ' in ' + delay + 'ms (' + retries + ' retries left)');
                    setTimeout(function () { return sendChunk(index, retries - 1); }, delay);
                }
                else {
                    console.error('Giving up on chunk ' + index + ' after ' + MAX_RETRIES + ' retries');
                    _this.sending = false;
                }
            });
        };
        sendChunk(0);
    };
    MapHandler.prototype.sendRouteToWatch = function (output) {
        var dict = {};
        var units = (0, helper_1.loadUnits)();
        if (!output.route) {
            dict.NAV_INFO_LINE1 = 'Select a Destination';
            dict.NAV_INFO_LINE2 = 'Add new Destinations in App Settings';
            dict.ROUTE_ACTIVE = 0;
        }
        else {
            var d = output.route.distance;
            var m = Math.round(output.route.duration / 60);
            var h = Math.floor(m / 60);
            var mins = m % 60;
            var time = h > 0 ? (mins > 0 ? "".concat(h, " h ").concat(mins, " min") : "".concat(h, " h")) : "".concat(m, " min");
            if (units === 'imperial') {
                var mi = d / 1609.344;
                dict.NAV_INFO_LINE1 =
                    mi >= 0.1 ? "".concat(mi.toFixed(1), " mi  ").concat(time) : "".concat(Math.round(d / 0.3048), " ft  ").concat(time);
            }
            else {
                dict.NAV_INFO_LINE1 =
                    d >= 1000 ? "".concat((d / 1000).toFixed(1), " km  ").concat(time) : "".concat(Math.round(d), " m  ").concat(time);
            }
            dict.ROUTE_ACTIVE = 1;
            var ns = output.nextStep;
            if (ns && Math.round(ns.remainingDist) > 0) {
                var stepDist = units === 'imperial'
                    ? "".concat(Math.round(ns.remainingDist / 0.3048), " ft")
                    : "".concat(Math.round(ns.remainingDist), " m");
                dict.NAV_INFO_LINE2 = "".concat(ns.step.modifier || '', " ").concat((0, helper_1.asciiNormalize)(ns.step.name) || '', " (").concat(stepDist, ")");
            }
            else {
                dict.NAV_INFO_LINE2 = '';
            }
        }
        message_queue_1.messageQueue.enqueue(dict, function () { }, function (err) { return console.error('Route info send failed: ' + err.error); });
    };
    MapHandler.prototype.getRecalculationDistance = function () {
        switch (this.mapState.value.mode) {
            case 'walking':
                return 15;
            case 'cycling':
                return 45;
            default:
                return 100;
        }
    };
    return MapHandler;
}());
exports.MapHandler = MapHandler;
