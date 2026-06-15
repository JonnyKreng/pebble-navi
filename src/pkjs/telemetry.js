"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTelemetryEnabled = isTelemetryEnabled;
exports.setWatchInfo = setWatchInfo;
exports.flushTelemetry = flushTelemetry;
exports.initTelemetry = initTelemetry;
var version_1 = require("./version");
var OTLP_ENDPOINT = 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp/v1/logs';
var OTLP_HEADERS = {
    Authorization: 'Basic MTY5MDU4MTpnbGNfZXlKdklqb2lNVGd4TVRZNE1TSXNJbTRpT2lKdVlYWnBMV0Z3Y0NJc0ltc2lPaUpIWlRZNFYwYzNZemcwT1d0TWEwbExNVGxZTjAxd05Ia2lMQ0p0SWpwN0luSWlPaUp3Y205a0xXVjFMWGRsYzNRdE1pSjlmUT09',
};
var TELEMETRY_KEY = 'telemetry_enabled';
var FLUSH_INTERVAL_MS = 10000;
var BATCH_SIZE = 50;
var buffer = [];
var flushTimer = null;
var hooked = false;
var watchInfo = null;
var sessionId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
function severityNumber(level) {
    switch (level) {
        case 'ERROR':
            return 17;
        case 'WARN':
            return 13;
        case 'INFO':
            return 9;
        case 'DEBUG':
            return 5;
        default:
            return 9;
    }
}
function isTelemetryEnabled() {
    try {
        return localStorage.getItem(TELEMETRY_KEY) === 'true';
    }
    catch (_a) {
        return false;
    }
}
function sendBatch() {
    while (buffer.length > 0) {
        var batch = buffer.splice(0, BATCH_SIZE);
        var body = JSON.stringify({
            resourceLogs: [
                {
                    resource: {
                        attributes: __spreadArray([
                            { key: 'service.name', value: { stringValue: 'pebble-navi' } },
                            { key: 'service.version', value: { stringValue: version_1.VERSION } },
                            { key: 'session.id', value: { stringValue: sessionId } }
                        ], (watchInfo
                            ? [
                                { key: 'device.platform', value: { stringValue: watchInfo.platform } },
                                { key: 'device.model', value: { stringValue: watchInfo.model } },
                                { key: 'device.firmware', value: { stringValue: watchInfo.firmware } },
                            ]
                            : []), true),
                    },
                    scopeLogs: [
                        {
                            scope: { name: 'pebble-navi' },
                            logRecords: batch.map(function (e) { return ({
                                timeUnixNano: e.time,
                                severityNumber: e.severityNumber,
                                severityText: e.severity,
                                body: { stringValue: e.body },
                            }); }),
                        },
                    ],
                },
            ],
        });
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', OTLP_ENDPOINT, true);
            for (var _i = 0, _a = Object.keys(OTLP_HEADERS); _i < _a.length; _i++) {
                var k = _a[_i];
                xhr.setRequestHeader(k, OTLP_HEADERS[k]);
            }
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(body);
        }
        catch (_) { }
    }
}
function scheduleFlush() {
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(function () {
        sendBatch();
        scheduleFlush();
    }, FLUSH_INTERVAL_MS);
}
function setWatchInfo(info) {
    watchInfo = {
        platform: info.platform,
        model: info.model,
        firmware: info.firmware.versionString || info.firmware.major + '.' + info.firmware.minor,
    };
}
function flushTelemetry() {
    sendBatch();
}
function initTelemetry() {
    if (hooked)
        return;
    hooked = true;
    var levels = [
        ['log', 'INFO'],
        ['info', 'INFO'],
        ['warn', 'WARN'],
        ['error', 'ERROR'],
        ['debug', 'DEBUG'],
    ];
    var orig = {};
    var hookedMethods = [];
    for (var _i = 0, levels_1 = levels; _i < levels_1.length; _i++) {
        var _a = levels_1[_i], method = _a[0], severity = _a[1];
        if (typeof console[method] !== 'function')
            continue;
        orig[method] = console[method].bind(console);
        hookedMethods.push([method, severity]);
    }
    var _loop_1 = function (method, severity) {
        console[method] = function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            orig[method].apply(console, args);
            if (isTelemetryEnabled()) {
                var body = args
                    .map(function (a) {
                    return typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a);
                })
                    .join(' ');
                buffer.push({
                    time: String(Date.now()) + '000000',
                    severity: severity,
                    severityNumber: severityNumber(severity),
                    body: body,
                });
            }
        };
    };
    for (var _b = 0, hookedMethods_1 = hookedMethods; _b < hookedMethods_1.length; _b++) {
        var _c = hookedMethods_1[_b], method = _c[0], severity = _c[1];
        _loop_1(method, severity);
    }
    scheduleFlush();
}
