"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_DESTINATIONS = void 0;
exports.testOverride = testOverride;
exports.testAutoMove = testAutoMove;
var rxjs_1 = require("rxjs");
var DO_TESTING = true;
exports.TEST_DESTINATIONS = DO_TESTING
    ? [
        {
            name: 'Brandenburger Tor',
            lat: 52.51672061856219,
            lng: 13.378728425932048,
        },
        {
            name: 'Alexanderplatz',
            lat: 52.520976307736106,
            lng: 13.414912636513549,
        },
    ]
    : [];
function testOverride(pos) {
    if (!DO_TESTING) {
        return pos;
    }
    pos.coords.latitude = 52.520976307736106;
    pos.coords.longitude = 13.414912636513549;
    return pos;
}
function testAutoMove(location) {
    if (!DO_TESTING) {
        return;
    }
    (0, rxjs_1.interval)(1000).subscribe(function (nbr) {
        location.next({
            coords: {
                latitude: 52.520976307736106 + 0.00001 * nbr,
                longitude: 13.414912636513549,
            },
        });
    });
}
