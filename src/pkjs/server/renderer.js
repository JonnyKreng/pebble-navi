"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMap = renderMap;
var upng_js_1 = __importDefault(require("upng-js"));
var osm_js_1 = require("./osm.js");
function fillRect(buf, w, h, x, y, rw, rh, cr, cg, cb) {
    var x0 = Math.max(0, x);
    var y0 = Math.max(0, y);
    var x1 = Math.min(w, x + rw);
    var y1 = Math.min(h, y + rh);
    for (var row = y0; row < y1; row++) {
        for (var col = x0; col < x1; col++) {
            var idx = (row * w + col) * 4;
            buf[idx] = cr;
            buf[idx + 1] = cg;
            buf[idx + 2] = cb;
            buf[idx + 3] = 255;
        }
    }
}
function setPixel(buf, w, h, x, y, cr, cg, cb) {
    if (x < 0 || x >= w || y < 0 || y >= h)
        return;
    var idx = (y * w + x) * 4;
    buf[idx] = cr;
    buf[idx + 1] = cg;
    buf[idx + 2] = cb;
    buf[idx + 3] = 255;
}
function drawThickLine(buf, w, h, x0, y0, x1, y1, cr, cg, cb, thickness) {
    var half = Math.floor(thickness / 2);
    var dx = Math.abs(x1 - x0);
    var dy = -Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1;
    var sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    var cx = Math.round(x0);
    var cy = Math.round(y0);
    var ex = Math.round(x1);
    var ey = Math.round(y1);
    while (true) {
        for (var cy2 = -half; cy2 <= half; cy2++) {
            for (var cx2 = -half; cx2 <= half; cx2++) {
                if (cx2 * cx2 + cy2 * cy2 <= half * half) {
                    setPixel(buf, w, h, cx + cx2, cy + cy2, cr, cg, cb);
                }
            }
        }
        if (cx === ex && cy === ey)
            break;
        var e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            cx += sx;
        }
        if (e2 <= dx) {
            err += dx;
            cy += sy;
        }
    }
}
function drawPolyline(buf, w, h, coords, zoom, vl, vt, cr, cg, cb, thickness) {
    if (coords.length < 2)
        return;
    var _a = coords[0], plng = _a[0], plat = _a[1];
    var pp = (0, osm_js_1.worldPixel)(plat, plng, zoom);
    var px = Math.round(pp.wx - vl);
    var py = Math.round(pp.wy - vt);
    for (var i = 1; i < coords.length; i++) {
        var _b = coords[i], lng = _b[0], lat = _b[1];
        var p = (0, osm_js_1.worldPixel)(lat, lng, zoom);
        var x = Math.round(p.wx - vl);
        var y = Math.round(p.wy - vt);
        var onScreen = (px >= 0 && px < w && py >= 0 && py < h) || (x >= 0 && x < w && y >= 0 && y < h);
        if (onScreen) {
            drawThickLine(buf, w, h, px, py, x, y, cr, cg, cb, thickness);
        }
        px = x;
        py = y;
    }
}
function drawFilledCircle(buf, w, h, cx, cy, radius, cr, cg, cb) {
    var r = Math.round(radius);
    for (var y = -r; y <= r; y++) {
        for (var x = -r; x <= r; x++) {
            if (x * x + y * y <= r * r) {
                setPixel(buf, w, h, Math.round(cx + x), Math.round(cy + y), cr, cg, cb);
            }
        }
    }
}
function drawCircleOutline(buf, w, h, cx, cy, radius, cr, cg, cb) {
    var r = Math.round(radius);
    for (var y = -r; y <= r; y++) {
        for (var x = -r; x <= r; x++) {
            var dist = Math.round(Math.sqrt(x * x + y * y));
            if (dist === r || dist === r - 1) {
                setPixel(buf, w, h, Math.round(cx + x), Math.round(cy + y), cr, cg, cb);
            }
        }
    }
}
function drawFilledDiamond(buf, w, h, cx, cy, size, cr, cg, cb) {
    var s = Math.round(size);
    for (var dy = -s; dy <= s; dy++) {
        var halfW = s - Math.abs(dy);
        for (var dx = -halfW; dx <= halfW; dx++) {
            setPixel(buf, w, h, Math.round(cx + dx), Math.round(cy + dy), cr, cg, cb);
        }
    }
}
function drawDiamondOutline(buf, w, h, cx, cy, size, cr, cg, cb) {
    var s = Math.round(size);
    for (var dy = -s; dy <= s; dy++) {
        var halfW = s - Math.abs(dy);
        var outerW = halfW;
        var innerW = halfW - 1;
        setPixel(buf, w, h, Math.round(cx + outerW), Math.round(cy + dy), cr, cg, cb);
        setPixel(buf, w, h, Math.round(cx - outerW), Math.round(cy + dy), cr, cg, cb);
        if (innerW >= 0) {
            setPixel(buf, w, h, Math.round(cx + innerW), Math.round(cy + dy), cr, cg, cb);
            setPixel(buf, w, h, Math.round(cx - innerW), Math.round(cy + dy), cr, cg, cb);
        }
    }
}
function markerPixel(lat, lng, zoom, vl, vt) {
    var p = (0, osm_js_1.worldPixel)(lat, lng, zoom);
    return { x: p.wx - vl, y: p.wy - vt };
}
function renderMapNormal(input) {
    var _a;
    var width = input.width, height = input.height;
    var buf = new Uint8Array(width * height * 4);
    fillRect(buf, width, height, 0, 0, width, height, 0xf8, 0xf8, 0xf8);
    var center = (0, osm_js_1.worldPixel)(input.center.lat, input.center.lng, input.zoom);
    var offsetX = width / 2;
    var offsetY = (_a = input.userOffsetY) !== null && _a !== void 0 ? _a : height / 2;
    var vl = center.wx - offsetX;
    var vt = center.wy - offsetY;
    for (var _i = 0, _b = input.tiles; _i < _b.length; _i++) {
        var tile = _b[_i];
        try {
            var decoded = upng_js_1.default.decode(tile.buffer.buffer);
            var rgbaArr = upng_js_1.default.toRGBA8(decoded)[0];
            var rgba = new Uint8Array(rgbaArr);
            var tileX = tile.tx * osm_js_1.TILE_SIZE;
            var tileY = tile.ty * osm_js_1.TILE_SIZE;
            var screenX_1 = Math.round(tileX - vl);
            var screenY_1 = Math.round(tileY - vt);
            for (var ty = 0; ty < osm_js_1.TILE_SIZE; ty++) {
                for (var tx = 0; tx < osm_js_1.TILE_SIZE; tx++) {
                    var sx = screenX_1 + tx;
                    var sy = screenY_1 + ty;
                    if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                        var srcIdx = (ty * osm_js_1.TILE_SIZE + tx) * 4;
                        var dstIdx = (sy * width + sx) * 4;
                        buf[dstIdx] = rgba[srcIdx];
                        buf[dstIdx + 1] = rgba[srcIdx + 1];
                        buf[dstIdx + 2] = rgba[srcIdx + 2];
                        buf[dstIdx + 3] = 255;
                    }
                }
            }
        }
        catch (_c) {
            /* skip failed tile */
        }
    }
    if (input.route) {
        var coords = input.route.coordinates;
        if (coords.length > 0) {
            drawPolyline(buf, width, height, coords, input.zoom, vl, vt, 255, 255, 255, 6);
            drawPolyline(buf, width, height, coords, input.zoom, vl, vt, 51, 102, 255, 4);
        }
    }
    if (input.start) {
        var origin_1 = markerPixel(input.start.lat, input.start.lng, input.zoom, vl, vt);
        drawCircleOutline(buf, width, height, origin_1.x, origin_1.y, 6, 255, 255, 255);
        drawFilledCircle(buf, width, height, origin_1.x, origin_1.y, 5, 34, 204, 102);
        drawCircleOutline(buf, width, height, origin_1.x, origin_1.y, 5, 255, 255, 255);
    }
    if (input.dest) {
        var d = markerPixel(input.dest.lat, input.dest.lng, input.zoom, vl, vt);
        drawDiamondOutline(buf, width, height, d.x, d.y, 8, 255, 255, 255);
        drawFilledDiamond(buf, width, height, d.x, d.y, 7, 255, 51, 51);
        drawDiamondOutline(buf, width, height, d.x, d.y, 7, 255, 255, 255);
    }
    return buf;
}
function renderMap(input) {
    return renderMapNormal(input);
}
