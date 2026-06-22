"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSettings = buildSettings;
exports.saveSettings = saveSettings;
var helper_1 = require("./helper");
var settings_template_1 = require("./settings-template");
function buildSettings(userLat, userLng) {
    var destinations = (0, helper_1.loadDestinations)();
    var units = (0, helper_1.loadUnits)();
    var telemetry = (0, helper_1.loadTelemetryEnabled)();
    var experimental = (0, helper_1.loadExperimentalEnabled)();
    var brightness = (0, helper_1.loadBrightness)();
    var showDestHint = (0, helper_1.loadShowDestinationHint)();
    var minUpdateTime = (0, helper_1.loadMinimumUpdateTime)();
    var html = settings_template_1.SETTINGS_HTML;
    html = html.replace('__DESTINATIONS__', JSON.stringify(destinations));
    html = html.replace('__UNITS_METRIC_CHECKED__', units === 'metric' ? ' checked' : '');
    html = html.replace('__UNITS_IMPERIAL_CHECKED__', units === 'imperial' ? ' checked' : '');
    html = html.replace('__TELEMETRY_CHECKED__', telemetry ? ' checked' : '');
    html = html.replace('__EXPERIMENTAL_CHECKED__', experimental ? ' checked' : '');
    html = html.replace(/__BRIGHTNESS_VALUE__/g, String(brightness));
    html = html.replace('__SHOW_DEST_HINT_CHECKED__', showDestHint ? ' checked' : '');
    html = html.replace(/__MIN_UPDATE_TIME__/g, String(minUpdateTime));
    html = html.replace('__ROUTING_MODE__', (0, helper_1.loadSettings)().mode);
    html = html.replace('__USER_LAT__', userLat !== undefined ? String(userLat) : 'undefined');
    html = html.replace('__USER_LNG__', userLng !== undefined ? String(userLng) : 'undefined');
    html = html.replace('__HAS_USER_POS__', userLat !== undefined ? 'true' : 'false');
    return html;
}
function saveSettings(response) {
    try {
        var data = JSON.parse(decodeURIComponent(response));
        if (data.destinations) {
            (0, helper_1.saveDestinations)(data.destinations);
        }
        if (data.units) {
            (0, helper_1.saveUnits)(data.units);
        }
        if (data.telemetry_enabled !== undefined) {
            (0, helper_1.saveTelemetryEnabled)(data.telemetry_enabled);
        }
        if (data.experimental_enabled !== undefined) {
            (0, helper_1.saveExperimentalEnabled)(data.experimental_enabled);
        }
        if (data.brightness !== undefined) {
            (0, helper_1.saveBrightness)(data.brightness);
        }
        if (data.show_destination_hint !== undefined) {
            (0, helper_1.saveShowDestinationHint)(data.show_destination_hint);
        }
        if (data.minimum_update_time !== undefined) {
            (0, helper_1.saveMinimumUpdateTime)(data.minimum_update_time);
        }
    }
    catch (err) {
        console.log('Config parse error: ' + err);
    }
    return [];
}
