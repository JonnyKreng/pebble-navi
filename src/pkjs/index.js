"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./server/polyfills");
var settings_1 = require("./settings");
var helper_1 = require("./helper");
var rxjs_1 = require("rxjs");
var destionations_1 = require("./destionations");
var map_handler_1 = require("./map-handler");
var test_data_1 = require("./test-data");
var telemetry_1 = require("./telemetry");
(0, telemetry_1.initTelemetry)();
console.log('JS App Started');
var destroyApp = new rxjs_1.Subject();
var location = new rxjs_1.Subject();
var navigationWatcher;
var mapHandler;
// --- Persistent event listeners (registered at module load time, before 'ready') ---
(0, rxjs_1.fromEvent)(Pebble, 'appmessage')
    .pipe((0, rxjs_1.map)(function (event) { return event.payload; }))
    .subscribe({
    next: function (payload) {
        try {
            if (test_data_1.ENABLE_LOGS)
                console.log('AppMessage received');
            if (payload.REQUEST_DESTINATIONS !== undefined) {
                (0, destionations_1.sendDestinationsToWatch)();
            }
            if (mapHandler !== undefined) {
                if (payload.ZOOM_DIR !== undefined) {
                    mapHandler.zoom(payload.ZOOM_DIR);
                }
                if (payload.SELECTED_DEST_INDEX !== undefined) {
                    var destination = (0, helper_1.loadDestinations)()[payload.SELECTED_DEST_INDEX];
                    if (destination) {
                        mapHandler.selectRoute(destination);
                    }
                    else {
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
                if (payload.SAVE_CURRENT_LOCATION !== undefined) {
                    var pos = mapHandler.getCurrentPosition();
                    if (pos) {
                        var destinations = (0, helper_1.loadDestinations)();
                        var existing = destinations.find(function (d) { return d.name === 'Saved Location'; });
                        if (existing) {
                            existing.lat = pos.lat;
                            existing.lng = pos.lng;
                        }
                        else {
                            destinations.push({ lat: pos.lat, lng: pos.lng, name: 'Saved Location' });
                        }
                        (0, helper_1.saveDestinations)(destinations);
                        console.log('Saved current location as Saved Location');
                    }
                    else {
                        console.error('No current position available to save');
                    }
                }
            }
        }
        catch (e) {
            console.error(e);
        }
    },
    error: function (err) { return console.error('AppMessage subscription error:', err); },
});
(0, rxjs_1.fromEvent)(Pebble, 'showConfiguration').subscribe(function () {
    console.log('showConfiguration event');
    try {
        navigator.geolocation.getCurrentPosition(function (pos) {
            Pebble.openURL('data:text/html,' +
                encodeURIComponent((0, settings_1.buildSettings)(pos.coords.latitude, pos.coords.longitude)));
        }, function () {
            Pebble.openURL('data:text/html,' + encodeURIComponent((0, settings_1.buildSettings)()));
        }, { enableHighAccuracy: false, timeout: 5000 });
    }
    catch (e) {
        console.error(e);
    }
});
(0, rxjs_1.fromEvent)(Pebble, 'webviewclosed').subscribe(function (e) {
    console.log('webviewclosed event');
    try {
        if (e.response) {
            (0, settings_1.saveSettings)(e.response);
            mapHandler === null || mapHandler === void 0 ? void 0 : mapHandler.onSettingsChanged();
        }
        (0, telemetry_1.flushTelemetry)();
    }
    catch (e) {
        console.error(e);
    }
});
// --- Session lifecycle ---
(0, rxjs_1.fromEvent)(Pebble, 'ready')
    .pipe((0, rxjs_1.tap)(function () {
    destroyApp.next();
    if (navigationWatcher !== undefined) {
        navigator.geolocation.clearWatch(navigationWatcher);
        navigationWatcher = undefined;
    }
}))
    .subscribe(function () {
    try {
        console.log('PebbleKit JS ready! Setting up new session.');
        (0, telemetry_1.setWatchInfo)(Pebble.getActiveWatchInfo());
        mapHandler = new map_handler_1.MapHandler(destroyApp);
        // Sync saved settings to watch on connect
        Pebble.sendAppMessage({
            ROUTE_MODE: mapHandler.getRouteMode(),
            ROTATION_MODE: mapHandler.getRotationMode() ? 1 : 0,
        }, function () { }, function (err) { return console.error('Initial state send failed: ' + err.error); });
        location.pipe((0, rxjs_1.takeUntil)(destroyApp)).subscribe({
            next: function (pos) {
                if (test_data_1.ENABLE_LOGS)
                    console.log('geolocation event');
                mapHandler === null || mapHandler === void 0 ? void 0 : mapHandler.updatePosition(pos);
            },
            error: function (err) { return console.error('Location subscription error:', err); },
        });
        navigationWatcher = navigator.geolocation.watchPosition(function (pos) { return location.next((0, test_data_1.testOverride)(pos)); }, console.error, {
            enableHighAccuracy: true,
            maximumAge: 5000,
        });
        console.log('App initialized');
    }
    catch (e) {
        console.error(e);
    }
});
(0, test_data_1.testAutoMove)(location, function () { return mapHandler === null || mapHandler === void 0 ? void 0 : mapHandler.getRouteCoords(); });
