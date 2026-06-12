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
var osm_1 = require("./server/osm");
var routing_1 = require("./server/routing");
var helper_1 = require("./helper");
var message_queue_1 = require("./message-queue");
var ENABLE_LOGS = false;
var DEFAULT_ZOOM = 16;
var DEFAULT_MODE = 'walking';
var DEFAULT_CHUNK = 2048;
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
        this.isFlint = false;
        this.rotationMode = false;
        this.mapTopLeftX = 0;
        this.mapTopLeftY = 0;
        this.expandedW = 0;
        this.expandedH = 0;
        this.lastPosTimestamp = 0;
        this.lastUserBufX = 0;
        this.lastUserBufY = 0;
        this.mapState = new rxjs_1.BehaviorSubject({});
        var info = Pebble.getActiveWatchInfo();
        var w = 144;
        var h = 168;
        this.isFlint = info.platform === 'flint';
        if (info.platform === 'emery') {
            w = 200;
            h = 228;
        }
        else if (info.platform === 'gabbro') {
            w = 260;
            h = 260;
        }
        if (ENABLE_LOGS)
            console.log('Platform=' + info.platform + ' size=' + w + 'x' + h);
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
                if (d > 100 && _this.canRecalc()) {
                    console.log('Off route by ' + Math.round(d) + 'm, recalculating');
                    _this.existingRoute = undefined;
                    state.origin = state.currentPos;
                    message_queue_1.messageQueue.enqueue({ NAV_INFO_LINE1: 'Recalculating...', NAV_INFO_LINE2: '', ROUTE_ACTIVE: 0 }, function () { }, function (err) { return console.error('Recalculating send failed: ' + err.error); });
                }
            }
        }), (0, rxjs_1.switchMap)(function (state) { return (0, rxjs_1.from)((0, stateRenderer_1.renderForState)(state, _this.existingRoute, _this.isFlint)); }), (0, rxjs_1.tap)(function () { return (_this.rendering = false); }), (0, rxjs_1.tap)(function (output) { return _this.onMapRendered(output); }), (0, rxjs_1.catchError)(function (err) {
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
        var newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        var bearing = (_a = pos.coords.heading) !== null && _a !== void 0 ? _a : undefined;
        if (this.isWithinExpandedMap(newPos)) {
            this.sendPositionUpdate(newPos, bearing);
        }
        else {
            this.mapState.next(__assign(__assign({}, this.mapState.value), { currentPos: newPos, bearing: bearing }));
        }
    };
    MapHandler.prototype.selectRoute = function (destination) {
        if (ENABLE_LOGS)
            console.info('selectRoute', JSON.stringify(destination));
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
        message_queue_1.messageQueue.enqueue({ ROTATION_MODE: enabled ? 1 : 0 }, function () { }, function (err) { return console.error('Rotation mode ack send failed: ' + err.error); });
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
    MapHandler.prototype.isWithinExpandedMap = function (pos) {
        if (this.expandedW === 0 || this.expandedH === 0)
            return false;
        var zoom = this.mapState.value.zoom;
        if (zoom === undefined)
            return false;
        var px = (0, osm_1.worldPixel)(pos.lat, pos.lng, zoom);
        var bufX = px.wx - this.mapTopLeftX;
        var bufY = px.wy - this.mapTopLeftY;
        // Inner 60% safe zone (20% margin from each edge)
        var marginX = this.expandedW * 0.2;
        var marginY = this.expandedH * 0.2;
        return (bufX >= marginX &&
            bufX < this.expandedW - marginX &&
            bufY >= marginY &&
            bufY < this.expandedH - marginY);
    };
    MapHandler.prototype.sendPositionUpdate = function (pos, bearing) {
        var zoom = this.mapState.value.zoom;
        if (zoom === undefined)
            return;
        if (this.expandedW === 0 || this.expandedH === 0)
            return;
        var px = (0, osm_1.worldPixel)(pos.lat, pos.lng, zoom);
        var userBufX = Math.round(px.wx - this.mapTopLeftX);
        var userBufY = Math.round(px.wy - this.mapTopLeftY);
        // Compute velocity (fixed-point 8.7: value / 128 = pixels/sec)
        var now = Date.now();
        var dt = (now - this.lastPosTimestamp) / 1000;
        var vx = 0;
        var vy = 0;
        if (dt > 0.1 && dt <= 10) {
            vx = Math.round(((userBufX - this.lastUserBufX) / dt) * 128);
            vy = Math.round(((userBufY - this.lastUserBufY) / dt) * 128);
        }
        this.lastPosTimestamp = now;
        this.lastUserBufX = userBufX;
        this.lastUserBufY = userBufY;
        message_queue_1.messageQueue.enqueue({
            USER_POS_X: userBufX,
            USER_POS_Y: userBufY,
            USER_BEARING: bearing !== undefined ? Math.round(bearing * 1000) : undefined,
            USER_VX: vx,
            USER_VY: vy,
        });
    };
    MapHandler.prototype.onMapRendered = function (renderOutput) {
        this.existingRoute = renderOutput.route;
        this.mapTopLeftX = renderOutput.mapTopLeftX;
        this.mapTopLeftY = renderOutput.mapTopLeftY;
        this.expandedW = renderOutput.mapWidth;
        this.expandedH = renderOutput.mapHeight;
        // Compute initial user position in expanded map coords
        var pos = this.mapState.value.currentPos;
        var bearing = this.mapState.value.bearing;
        var initialUserX = 0;
        var initialUserY = 0;
        if (pos) {
            var zoom = this.mapState.value.zoom;
            if (zoom !== undefined) {
                var px = (0, osm_1.worldPixel)(pos.lat, pos.lng, zoom);
                initialUserX = Math.round(px.wx - this.mapTopLeftX);
                initialUserY = Math.round(px.wy - this.mapTopLeftY);
            }
        }
        // Reset velocity tracking for the new map
        var now = Date.now();
        this.lastPosTimestamp = now;
        this.lastUserBufX = initialUserX;
        this.lastUserBufY = initialUserY;
        // Send map dimensions BEFORE bitmap chunks so watch can resize its buffer
        message_queue_1.messageQueue.enqueue({
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
    };
    MapHandler.prototype.sendBitmapToWatch = function (pixels) {
        var _this = this;
        if (this.sending) {
            return;
        }
        this.sending = true;
        var chunkSize = this.chunk_size;
        var compressed = (0, helper_1.rleEncode)(pixels);
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
                dict.NAV_INFO_LINE1 = mi >= 0.1 ? "".concat(mi.toFixed(1), " mi  ").concat(time) : "".concat(Math.round(d / 0.3048), " ft  ").concat(time);
            }
            else {
                dict.NAV_INFO_LINE1 = d >= 1000 ? "".concat((d / 1000).toFixed(1), " km  ").concat(time) : "".concat(Math.round(d), " m  ").concat(time);
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
    return MapHandler;
}());
exports.MapHandler = MapHandler;
