"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_DESTINATIONS = void 0;
exports.test_override = test_override;
var DO_TESTING = false;
exports.TEST_DESTINATIONS = DO_TESTING
    ? [
        {
            name: 'Alexanderplatz',
            lat: 52.520976307736106,
            lng: 13.414912636513549,
        },
        {
            name: 'Tiergarten',
            lat: 52.520976307736106,
            lng: 13.414912636513549,
        },
        {
            name: 'Brandenburger Tor',
            lat: 52.51672061856219,
            lng: 13.378728425932048,
        },
    ]
    : [];
function test_override(pos) {
    if (!DO_TESTING) {
        return pos;
    }
    pos.coords.latitude = 52.520976307736106;
    pos.coords.longitude = 13.414912636513549;
    return pos;
}
