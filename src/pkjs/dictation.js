"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dictationResults = void 0;
exports.dictateSearch = dictateSearch;
var routing_1 = require("./server/routing");
var helper_1 = require("./helper");
exports.dictationResults = [];
function formatDistance(meters) {
    var units = (0, helper_1.loadUnits)();
    if (units === 'imperial') {
        var mi = meters / 1609.344;
        if (mi >= 0.1)
            return "".concat(mi.toFixed(1), " mi");
        return "".concat(Math.round(meters / 0.3048), " ft");
    }
    else {
        if (meters >= 1000)
            return "".concat((meters / 1000).toFixed(1), " km");
        return "".concat(Math.round(meters), " m");
    }
}
function sendDictateResult(i) {
    if (i >= exports.dictationResults.length)
        return;
    var r = exports.dictationResults[i];
    Pebble.sendAppMessage({
        DICTATE_RESULT_INDEX: i,
        DICTATE_RESULT_NAME: r.name,
        DICTATE_RESULT_DISTANCE: r.distance,
    }, function () { return sendDictateResult(i + 1); }, function (err) { return console.error('Dictate result send failed: ' + err.error); });
}
function dictateSearch(query, mapHandler) {
    return __awaiter(this, void 0, void 0, function () {
        var pos, url, res, data, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    pos = mapHandler.getCurrentPosition();
                    if (!pos) {
                        Pebble.sendAppMessage({ DICTATE_RESULTS_TOTAL: 0 });
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(query) + '&lat=' + pos.lat + '&lon=' + pos.lng + '&limit=6';
                    return [4 /*yield*/, fetch(url)];
                case 2:
                    res = _a.sent();
                    return [4 /*yield*/, res.json()];
                case 3:
                    data = _a.sent();
                    if (!data.features || data.features.length === 0) {
                        Pebble.sendAppMessage({ DICTATE_RESULTS_TOTAL: 0 });
                        return [2 /*return*/];
                    }
                    exports.dictationResults = data.features.map(function (item) {
                        var _a = item.geometry.coordinates, lng = _a[0], lat = _a[1];
                        var p = item.properties;
                        var dist = (0, routing_1.haversine)(pos.lat, pos.lng, lat, lng);
                        var displayName = p.name || query;
                        return {
                            lat: lat,
                            lng: lng,
                            name: displayName,
                            distance: formatDistance(dist),
                        };
                    });
                    Pebble.sendAppMessage({ DICTATE_RESULTS_TOTAL: exports.dictationResults.length }, function () { return sendDictateResult(0); }, function (err) { return console.error('Dictate total send failed: ' + err.error); });
                    return [3 /*break*/, 5];
                case 4:
                    e_1 = _a.sent();
                    console.error('Dictation search failed:', e_1);
                    Pebble.sendAppMessage({ DICTATE_RESULTS_TOTAL: 0 });
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
