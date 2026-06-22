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
exports.USER_Y_OFFSET = void 0;
exports.renderForState = renderForState;
var osm_js_1 = require("./osm.js");
var routing_js_1 = require("./routing.js");
var renderer_js_1 = require("./renderer.js");
var pebble_palette_js_1 = require("./pebble-palette.js");
var lastBearing;
exports.USER_Y_OFFSET = 0.85;
function renderForState(s_1, existingRoute_1) {
    return __awaiter(this, arguments, void 0, function (s, existingRoute, isBw, userVerticalOffset) {
        var center, route, _a, _b, nextStep, ns, mapRotation, outUserOffsetY, renderW, renderH, cosA, sinA, maxDY, centerPx, vl, vt, tx0, ty0, tx1, ty1, tilePromises, _loop_1, tx, tileResults, tiles, rgba, pixels;
        var _c;
        if (isBw === void 0) { isBw = false; }
        if (userVerticalOffset === void 0) { userVerticalOffset = exports.USER_Y_OFFSET; }
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    center = s.currentPos || s.origin;
                    if (!(existingRoute !== null && existingRoute !== void 0)) return [3 /*break*/, 1];
                    _a = existingRoute;
                    return [3 /*break*/, 5];
                case 1:
                    if (!(s.dest && s.origin)) return [3 /*break*/, 3];
                    return [4 /*yield*/, (0, routing_js_1.fetchRoute)(s.origin, s.dest, s.mode)];
                case 2:
                    _b = ((_c = (_d.sent())) !== null && _c !== void 0 ? _c : undefined);
                    return [3 /*break*/, 4];
                case 3:
                    _b = undefined;
                    _d.label = 4;
                case 4:
                    _a = (_b);
                    _d.label = 5;
                case 5:
                    route = _a;
                    if (route && s.currentPos) {
                        ns = (0, routing_js_1.findNextStep)(route, s.currentPos);
                        if (ns)
                            nextStep = ns;
                    }
                    if (s.bearing != null) {
                        lastBearing = s.bearing;
                    }
                    if (s.rotationMode) {
                        if (nextStep && s.currentPos) {
                            mapRotation = -(0, routing_js_1.bearingTo)(s.currentPos, nextStep.step.location);
                        }
                        else if (s.bearing != null) {
                            mapRotation = -s.bearing;
                        }
                        else if (lastBearing != null) {
                            mapRotation = -lastBearing;
                        }
                    }
                    outUserOffsetY = mapRotation != null ? s.width * userVerticalOffset : undefined;
                    renderW = s.width, renderH = s.height;
                    if (mapRotation != null) {
                        cosA = Math.abs(Math.cos((mapRotation * Math.PI) / 180));
                        sinA = Math.abs(Math.sin((mapRotation * Math.PI) / 180));
                        maxDY = outUserOffsetY != null ? Math.max(outUserOffsetY, s.height - outUserOffsetY) : s.height / 2;
                        renderW = Math.ceil(s.width * cosA + 2 * maxDY * sinA) + 1;
                        renderH = Math.ceil(s.width * sinA + 2 * maxDY * cosA) + 1;
                    }
                    centerPx = (0, osm_js_1.worldPixel)(center.lat, center.lng, s.zoom);
                    vl = centerPx.wx - renderW / 2;
                    vt = centerPx.wy - renderH / 2;
                    tx0 = Math.floor(vl / osm_js_1.TILE_SIZE);
                    ty0 = Math.floor(vt / osm_js_1.TILE_SIZE);
                    tx1 = Math.floor((vl + renderW - 1) / osm_js_1.TILE_SIZE);
                    ty1 = Math.floor((vt + renderH - 1) / osm_js_1.TILE_SIZE);
                    tilePromises = [];
                    _loop_1 = function (tx) {
                        var _loop_2 = function (ty) {
                            tilePromises.push((0, osm_js_1.getTile)(s.zoom, tx, ty).then(function (buf) { return (buf ? { tx: tx, ty: ty, buffer: buf } : null); }));
                        };
                        for (var ty = ty0; ty <= ty1; ty++) {
                            _loop_2(ty);
                        }
                    };
                    for (tx = tx0; tx <= tx1; tx++) {
                        _loop_1(tx);
                    }
                    return [4 /*yield*/, Promise.all(tilePromises)];
                case 6:
                    tileResults = _d.sent();
                    tiles = tileResults.filter(function (t) { return t !== null; });
                    rgba = (0, renderer_js_1.renderMap)({
                        width: renderW,
                        height: renderH,
                        outputWidth: mapRotation != null ? s.width : undefined,
                        outputHeight: mapRotation != null ? s.height : undefined,
                        outputUserOffsetY: outUserOffsetY,
                        zoom: s.zoom,
                        center: center,
                        start: s.origin,
                        dest: s.dest,
                        currentPos: s.currentPos,
                        bearing: s.bearing,
                        route: route,
                        tiles: tiles,
                        userOffsetY: renderH / 2,
                        rotation: mapRotation,
                        isBw: isBw,
                    });
                    pixels = isBw
                        ? (0, pebble_palette_js_1.quantizeToPebble2Bit)(rgba, s.width, s.height, s.brightness).pixels
                        : (0, pebble_palette_js_1.quantizeToPebble)(rgba, s.width, s.height).pixels;
                    return [2 /*return*/, {
                            pixels: pixels,
                            route: route,
                            nextStep: nextStep,
                        }];
            }
        });
    });
}
