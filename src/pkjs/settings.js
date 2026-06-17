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
    var html = settings_template_1.SETTINGS_HTML;
    html = html.replace('__DESTINATIONS__', JSON.stringify(destinations));
    html = html.replace('__UNITS_METRIC_CHECKED__', units === 'metric' ? ' checked' : '');
    html = html.replace('__UNITS_IMPERIAL_CHECKED__', units === 'imperial' ? ' checked' : '');
    html = html.replace('__TELEMETRY_CHECKED__', telemetry ? ' checked' : '');
    html = html.replace('__EXPERIMENTAL_CHECKED__', experimental ? ' checked' : '');
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
    }
    catch (err) {
        console.log('Config parse error: ' + err);
    }
    return [];
}
