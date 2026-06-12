"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.loadUnits = loadUnits;
exports.saveUnits = saveUnits;
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
                flags |= (1 << (7 - bit));
                out.push(bestOff & 0xFF, bestLen);
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
    var xl = encodeHoffmannXL(pixels);
    var lzss = encodeLZSS(pixels, 255);
    var best = lzss.length < xl.length ? lzss : xl;
    var out = new Uint8Array(1 + best.length);
    out[0] = best === lzss ? 1 : 0;
    out.set(best, 1);
    return out;
}
function encodeHoffmannXL(data) {
    var out = [];
    var i = 0;
    while (i < data.length) {
        var val = data[i];
        var runLen = 1;
        while (i + runLen < data.length && data[i + runLen] === val && runLen < 65536) {
            runLen++;
        }
        if (runLen >= 128) {
            out.push(0xFF, runLen & 0xFF, (runLen >> 8) & 0xFF, val);
            i += runLen;
        }
        else if (runLen >= 2) {
            out.push(0x80 | (runLen - 1), val);
            i += runLen;
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
