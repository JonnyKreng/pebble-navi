"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDestinationsToWatch = sendDestinationsToWatch;
var helper_1 = require("./helper");
function sendDestinationsToWatch() {
    var names = (0, helper_1.loadDestinations)().map(function (d) {
        return (0, helper_1.asciiNormalize)(d.name || d.lat + ',' + d.lng);
    });
    function sendNext(i) {
        if (i >= names.length) {
            return;
        }
        Pebble.sendAppMessage({
            SELECTED_DEST_INDEX: i,
            DEST_NAME: names[i],
        }, function () { return sendNext(i + 1); }, function (err) { return console.error('Destination send failed:', err.error); });
    }
    Pebble.sendAppMessage({ DEST_NAMES_TOTAL: names.length }, function () { return sendNext(0); }, function (err) { return console.error('DEST_NAMES_TOTAL send failed:', err.error); });
}
