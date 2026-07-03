"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_DESTINATIONS = exports.DO_MOVEMENT_TESTING = exports.DO_TESTING = exports.ENABLE_LOGS = void 0;
exports.testOverride = testOverride;
exports.testAutoMove = testAutoMove;
var rxjs_1 = require("rxjs");
var telemetry_1 = require("./telemetry");
exports.ENABLE_LOGS = (0, telemetry_1.isTelemetryEnabled)();
exports.DO_TESTING = false;
exports.DO_MOVEMENT_TESTING = false;
exports.TEST_DESTINATIONS = exports.DO_TESTING
    ? [
        {
            name: 'Brandenburger Tor',
            lat: 52.51672061856219,
            lng: 13.378728425932048,
        },
        {
            name: 'Alexanderplatz',
            lat: 52.520976407736106,
            lng: 13.414212636513549,
        },
    ]
    : [];
function testOverride(pos) {
    if (!exports.DO_TESTING) {
        return pos;
    }
    pos.coords.latitude = 52.520976307736106;
    pos.coords.longitude = 13.414912636513549;
    return pos;
}
function jitter() {
    return (Math.random() - 0.5) * 0.00008;
}
function testAutoMove(location, getRouteCoords) {
    if (!exports.DO_MOVEMENT_TESTING) {
        return;
    }
    var routeIndex = 0;
    var prevCoords;
    (0, rxjs_1.interval)(1000).subscribe(function (nbr) {
        var coords = getRouteCoords === null || getRouteCoords === void 0 ? void 0 : getRouteCoords();
        if (coords && coords.length > 0) {
            if (coords !== prevCoords)
                routeIndex = 0;
            prevCoords = coords;
            routeIndex = Math.min(routeIndex, coords.length - 1);
            var _a = coords[routeIndex], lng = _a[0], lat = _a[1];
            location.next({
                coords: { latitude: lat + jitter(), longitude: lng + jitter() },
            });
            routeIndex++;
            if (routeIndex >= coords.length)
                routeIndex = 0;
        }
        else {
            location.next({
                coords: {
                    latitude: 52.520976307736106 + jitter(),
                    longitude: 13.414912636513549 - 0.0001 * nbr + jitter(),
                },
            });
            routeIndex = 0;
        }
    });
}
