"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.loadUnits = loadUnits;
exports.saveUnits = saveUnits;
exports.loadTelemetryEnabled = loadTelemetryEnabled;
exports.saveTelemetryEnabled = saveTelemetryEnabled;
exports.loadExperimentalEnabled = loadExperimentalEnabled;
exports.saveExperimentalEnabled = saveExperimentalEnabled;
exports.loadBrightness = loadBrightness;
exports.saveBrightness = saveBrightness;
exports.loadShowDestinationHint = loadShowDestinationHint;
exports.saveShowDestinationHint = saveShowDestinationHint;
exports.loadMinimumUpdateTime = loadMinimumUpdateTime;
exports.saveMinimumUpdateTime = saveMinimumUpdateTime;
exports.loadDestinations = loadDestinations;
exports.saveDestinations = saveDestinations;
exports.encodeLZSS = encodeLZSS;
exports.encodeAdaptive = encodeAdaptive;
exports.encodeHoffmannXL = encodeHoffmannXL;
exports.asciiNormalize = asciiNormalize;
var test_data_1 = require("./test-data");
var DESTINATIONS_KEY = 'destinations';
var UNITS_KEY = 'units';
var SETTINGS_KEY = 'nav_settings';
var TELEMETRY_KEY = 'telemetry_enabled';
var EXPERIMENTAL_KEY = 'experimental_enabled';
var BRIGHTNESS_KEY = 'brightness_value';
var SHOW_DESTINATION_HINT_KEY = 'show_destination_hint';
var MINIMUM_UPDATE_TIME_KEY = 'minimum_update_time';
function loadSettings() {
    try {
        var saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    }
    catch (e) { }
    return { zoom: 16, mode: 'walking', rotationMode: false };
}
function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function loadUnits() {
    return localStorage.getItem(UNITS_KEY) || 'metric';
}
function saveUnits(units) {
    localStorage.setItem(UNITS_KEY, units);
}
function loadTelemetryEnabled() {
    return localStorage.getItem(TELEMETRY_KEY) === 'true';
}
function saveTelemetryEnabled(enabled) {
    localStorage.setItem(TELEMETRY_KEY, enabled ? 'true' : 'false');
}
function loadExperimentalEnabled() {
    return localStorage.getItem(EXPERIMENTAL_KEY) === 'true';
}
function saveExperimentalEnabled(enabled) {
    localStorage.setItem(EXPERIMENTAL_KEY, enabled ? 'true' : 'false');
}
function loadBrightness() {
    var saved = localStorage.getItem(BRIGHTNESS_KEY);
    if (saved !== null) {
        var parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return 40;
}
function saveBrightness(brightness) {
    localStorage.setItem(BRIGHTNESS_KEY, String(brightness));
}
function loadShowDestinationHint() {
    var saved = localStorage.getItem(SHOW_DESTINATION_HINT_KEY);
    return saved !== 'false';
}
function saveShowDestinationHint(enabled) {
    localStorage.setItem(SHOW_DESTINATION_HINT_KEY, enabled ? 'true' : 'false');
}
function loadMinimumUpdateTime() {
    var saved = localStorage.getItem(MINIMUM_UPDATE_TIME_KEY);
    if (saved !== null) {
        var parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return 0;
}
function saveMinimumUpdateTime(time) {
    localStorage.setItem(MINIMUM_UPDATE_TIME_KEY, String(time));
}
function loadDestinations() {
    try {
        var saved = localStorage.getItem(DESTINATIONS_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    }
    catch (e) { }
    return test_data_1.TEST_DESTINATIONS;
}
function saveDestinations(destinations) {
    try {
        localStorage.setItem(DESTINATIONS_KEY, JSON.stringify(destinations));
    }
    catch (e) { }
}
function encodeLZSS(data, window) {
    var out = [];
    var MAX_MATCH = 15;
    var MIN_MATCH = 2;
    var i = 0;
    while (i < data.length) {
        var flagPos = out.length;
        out.push(0);
        var flags = 0;
        for (var bit = 0; bit < 8 && i < data.length; bit++) {
            var bestLen = 0;
            var bestOff = 0;
            var windowStart = Math.max(0, i - window);
            for (var j = windowStart; j < i; j++) {
                var len = 0;
                while (len < MAX_MATCH && i + len < data.length && data[j + len] === data[i + len]) {
                    len++;
                }
                if (len >= MIN_MATCH && len > bestLen) {
                    bestLen = len;
                    bestOff = i - j;
                }
            }
            if (bestLen >= MIN_MATCH) {
                flags |= 1 << (7 - bit);
                out.push(bestOff & 0xff, bestLen);
                i += bestLen;
            }
            else {
                out.push(data[i]);
                i++;
            }
        }
        out[flagPos] = flags;
    }
    return new Uint8Array(out);
}
function encodeAdaptive(pixels) {
    if (test_data_1.ENABLE_LOGS)
        console.time('encodeHoffmannXL');
    var hxl = encodeHoffmannXL(pixels);
    if (test_data_1.ENABLE_LOGS)
        console.timeEnd('encodeHoffmannXL');
    if (test_data_1.ENABLE_LOGS)
        console.time('encodeLZSS');
    var lzss = encodeLZSS(pixels, 255);
    if (test_data_1.ENABLE_LOGS)
        console.timeEnd('encodeLZSS');
    var useHxl = hxl.length <= lzss.length;
    var data = useHxl ? hxl : lzss;
    var algo = useHxl ? 0 : 1;
    var out = new Uint8Array(1 + data.length);
    out[0] = algo;
    out.set(data, 1);
    return out;
}
function encodeHoffmannXL(data) {
    var out = [];
    var i = 0;
    while (i < data.length) {
        var val = data[i];
        var runLen = 1;
        while (i + runLen < data.length && data[i + runLen] === val && runLen < 65535) {
            runLen++;
        }
        if (runLen >= 128) {
            out.push(0xff, runLen & 0xff, (runLen >> 8) & 0xff, val);
            i += runLen;
        }
        else if (runLen >= 2) {
            out.push(0x80 | (runLen - 1), val);
            i += runLen;
        }
        else if (val >= 0x80) {
            out.push(0x80, val);
            i++;
        }
        else {
            out.push(val);
            i++;
        }
    }
    return new Uint8Array(out);
}
var charMap = {
    ä: 'a',
    ö: 'o',
    ü: 'u',
    Ä: 'A',
    Ö: 'O',
    Ü: 'U',
    é: 'e',
    è: 'e',
    ê: 'e',
    ë: 'e',
    É: 'E',
    à: 'a',
    â: 'a',
    ã: 'a',
    å: 'a',
    À: 'A',
    Â: 'A',
    Ã: 'A',
    Å: 'A',
    ç: 'c',
    Ç: 'C',
    ñ: 'n',
    Ñ: 'N',
    ó: 'o',
    ò: 'o',
    ô: 'o',
    õ: 'o',
    Ó: 'O',
    Ò: 'O',
    Ô: 'O',
    Õ: 'O',
    í: 'i',
    ì: 'i',
    î: 'i',
    ï: 'i',
    Í: 'I',
    Ì: 'I',
    Î: 'I',
    Ï: 'I',
    ú: 'u',
    ù: 'u',
    û: 'u',
    Ú: 'U',
    Ù: 'U',
    Û: 'U',
    ý: 'y',
    ÿ: 'y',
    Ý: 'Y',
    ß: 'ss',
    æ: 'ae',
    Æ: 'AE',
    œ: 'oe',
    Œ: 'OE',
};
function IsAscii(c) {
    return c.length === 1 && c >= " c >= ' " && c <= '~';
}
function asciiNormalize(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
        var c = s[i];
        var mapped = charMap[c];
        if (mapped) {
            out += mapped;
        }
        else if (IsAscii(c)) {
            out += c;
        }
    }
    return out.trim();
}
