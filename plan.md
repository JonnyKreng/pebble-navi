# Plan: Move Map Rendering Split (Watch draws user icon + rotation)

## Goal

Improve map FPS/responsiveness by decoupling the phone-side render/transfer cycle from user position changes. Currently, every GPS update triggers a full map render + RLE encoding + chunked bitmap transfer over Bluetooth. By having the watch render the user icon and handle map rotation locally, the phone only needs to send a new bitmap when the map actually changes (zoom, route, or user approaches edge).

---

## 1. Potential Problems (you asked)

### Memory (RAM) — biggest concern

The watch stores an expanded map bigger than the screen. Current vs proposed sizes for a **1.3×** expansion factor:

| Platform | Current (screen) | 1.3× expanded | Increase |
|----------|-----------------|---------------|----------|
| Flint (2-bit) | 6,048 B | ~10,192 B | +4 KB |
| Emery (8-bit) | 45,600 B | ~76,960 B | +31 KB |
| Gabbro (8-bit) | 67,600 B | ~114,244 B | +46 KB |

Pebble has very tight RAM: Flint ~64 KB, Emery ~128 KB, Gabbro ~128 KB.

Gabbro is round (260×260 logical, but the display circle is inscribed). The corners of the rectangular bitmap are never visible — they naturally show filler/background. This means:
- **Gabbro can use a larger expansion factor** (e.g., 1.5×) because the effective visible area is smaller and the filler in bitmap corners doesn't matter
- At high rotation angles on Gabbro, any out-of-bounds source pixels also map to the invisible corner area, never to the visible round display
- **Emery** is the tightest constraint — rectangular screen with no hidden corners. May use a smaller factor (1.2×) or accept occasional edge filler during rotation
- **Flint** is small enough that 1.3× is fine (10 KB bitmap)

### Rotation performance on watch CPU

Rotating the map on the Pebble requires an inverse bilinear sample per pixel. For Emery (200×228 = 45,600 px), each pixel involves:
- Compute offset from center of rotation → 2 FP ops
- Apply rotation matrix (cos, sin) → 4 FP ops + 2 trig lookups
- Clamp & sample source → 2 ops

~400k operations per frame. On a 100 MHz Cortex-M4 with hardware FPU (Emery/Gabbro), this is roughly **3–8 ms per frame** — acceptable at 30 FPS (33 ms budget). **Flint (Cortex-M3, no FPU)** would need fixed-point trig tables, making it slower but still manageable at the smaller (144×168) resolution.

### 2-bit packed format on Flint

Flint uses `GBitmapFormat2BitPalette` (4 pixels/byte). Rotation with packed pixels requires:
- Unpacking 4 pixel indices from each byte
- Applying rotation per pixel
- Repacking into the output

This adds overhead. A simpler approach for Flint: render to an intermediate 8-bit buffer (144×168 = 24 KB temp), rotate there, then convert back. This costs 24 KB extra RAM but simplifies code.

### Compass calibration

Pebble compass requires a figure-8 calibration on first use. `compass_service_subscribe()` provides heading data, but the compass can be noisy. Consider:
- Apply a simple low-pass filter (exponential moving average)
- Watch calibration UI on first use or when accuracy is low

### Smooth movement

GPS updates typically arrive every 1–5 seconds. Without mitigation the user icon jumps between positions. The phone sends **velocity estimates** (`USER_VX`, `USER_VY` in fixed-point pixels/s) alongside each position update. The watch extrapolates in real-time:

```c
s_current_display_x = s_user_x + (s_user_vx * dt_ms) / (128 * 1000);
```

This provides smooth movement between GPS ticks. When a new position arrives, the base resets and extrapolation restarts from there. If the phone fails to send updates for > 10 s, velocity fades to 0 to prevent drift.

### AppMessage inbound buffer

Currently `app_message_open(4096, 1024)`. The expanded map will generate more RLE data and more chunks. Keep the 4 KB inbound — it's the max per-message size, not the total receive buffer. The chunk size (2048) stays the same; there are just more chunks.

### Edge detection — when to request a new map

The phone decides when the user has moved too close to the expanded map's edge. Threshold:
- Buffer zone: 20 % of expanded buffer on each side
- When user's pixel position enters the buffer zone → re-render + send new map centered at new position

This logic lives in `MapHandler.updatePosition()` on the phone.

---

## 2. New Architecture

### Phone does:
- Render expanded unrotated map (without user icon)
- Quantize at expanded size
- Send bitmap via existing chunk mechanism (larger, but less frequent)
- Send per-update position messages (`USER_POS_X`, `USER_POS_Y`) with user's pixel offset in the expanded map
- Still send route info (`NAV_INFO_LINE1/2`, `ROUTE_ACTIVE`)
- Track map edge threshold; trigger re-render when user approaches edge

### Watch does:
- Store the expanded bitmap (unchanged until phone sends a new one)
- Receive position updates → track user pixel offset within expanded map
- Read compass via `compass_service_subscribe()` → compute rotation angle
- On each frame `map_update_proc`:
  - **No rotation**: blit the screen-sized viewport from expanded map centered on user position
  - **With rotation**: render the viewport with rotation applied (inverse sampling from expanded map around user position)
  - Draw user icon (direction arrow based on compass heading) at screen center
- Still render the time label and zoom/gear UI overlay

---

## 3. New / Modified Message Keys

Add to `package.json` `messageKeys` (order matters — they map to consecutive `MESSAGE_KEY_*` values):

```json
"USER_POS_X",       // uint16 — user X pixel offset in expanded map
"USER_POS_Y",       // uint16 — user Y pixel offset in expanded map
"MAP_BUFFER_WIDTH",  // uint16 — width of expanded map (sent on first render / re-render)
"MAP_BUFFER_HEIGHT", // uint16 — height of expanded map
"USER_BEARING",      // int32 — heading from phone GPS (millidegrees)
"USER_VX",           // int16 — user velocity X (pixels/s, fixed-point 8.7)
"USER_VY",           // int16 — user velocity Y (pixels/s, fixed-point 8.7)
```

Total: 7 new keys. Velocity is in fixed-point 8.7 format (value / 128 = pixels/sec). Positive X is right, positive Y is down in expanded map coordinates.

You'll need to update `package.json` messageKeys array, and `main.c` `inbox_received()` will need new dispatches.

---

## 4. Implementation Steps

> **Cleanup rule for every step**: After each step, remove any code that is now unreachable or unused by that step, but be conservative — if you're unsure whether something is still needed, leave it. Dead code can be cleaned up in later steps once the full picture is clear. Prefer leaving a comment like `// TODO: remove after X` over deleting something that might be used elsewhere.

### Phase 1: Phone-side changes

**Step 1 — Add new message keys** (`package.json` + auto-generated headers)
- Add the 7 keys above to `pebble.messageKeys` array
- Rebuild or manually update `message_keys.auto.h`

**Step 2 — Remove user icon from renderer** (`src/pkjs/server/renderer.ts`)
- Delete the `input.currentPos` block (lines 366–392 in `renderMapNormal`)
- Remove `bearing` from `RenderInput` (no longer needed for rendering)
- The phone no longer draws any user icon in the bitmap

**Step 3 — Remove rotation from renderer** (`src/pkjs/server/renderer.ts` + `stateRenderer.ts`)
- `renderMap()` can be simplified: always call `renderMapNormal()` at the expanded size
- `renderMapRotated()` is no longer called
- Remove `rotation`, `outputWidth`, `outputHeight`, `outputUserOffsetY` from `RenderInput` (or ignore them)

**Step 4 — Add expansion constant** (`src/pkjs/map-handler.ts` or `stateRenderer.ts`)
```typescript
const EXPAND_FACTOR = 1.3;
```
The phone renders at `ceil(width * EXPAND_FACTOR)` × `ceil(height * EXPAND_FACTOR)`.

**Step 5 — Modify `stateRenderer.ts` `renderForState()`**
- Change output quantization dimensions from `(s.width, s.height)` to expanded dimensions
- Map center logic stays the same (center on user position)
- No rotation in the phone rendering pipeline

**Step 6 — Modify `MapHandler` position handling** (`src/pkjs/map-handler.ts`)
- `updatePosition()`: instead of pushing to `this.mapState` (which triggers full re-render), check if user is within the expanded map's safe zone:
  ```typescript
  updatePosition(pos: GeolocationPosition): void {
    const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const bearing = pos.coords.heading;
    
    // Check if position is within the safe zone of current expanded map
    if (this.isWithinExpandedMap(newPos)) {
      // Send lightweight position update to watch
      this.sendPositionUpdate(newPos, bearing);
    } else {
      // User approaching edge — push to state to trigger full re-render
      this.mapState.next({ ...this.mapState.value, currentPos: newPos, bearing });
    }
  }
  ```
- `isWithinExpandedMap()`: convert new position to pixel coords in the expanded map, check if within inner 60% (i.e., 20% margin from each edge)
- `sendPositionUpdate()`: enqueue a small message with USER_POS_X, USER_POS_Y, USER_BEARING
- Remove the tap that checks off-route distance from the rendering pipeline (it can stay but won't trigger re-render as often since position updates don't go through the pipeline)

**Step 7 — Compute pixel offsets + velocity on phone** (`src/pkjs/map-handler.ts` or new helper)
- When rendering a new map, compute and store the map's top-left world pixel coordinates and the timestamp
- On each position update, convert `(lat, lng)` to world pixel, subtract map TL to get `(user_buf_x, user_buf_y)`
- Compute velocity: track the last position + timestamp. On each new GPS fix:
  ```typescript
  const dt = (now - lastTimestamp) / 1000;  // seconds
  if (dt > 0.1) {
    const vx = Math.round(((userBufX - lastBufX) / dt) * 128);  // fixed-point 8.7
    const vy = Math.round(((userBufY - lastBufY) / dt) * 128);
  }
  ```
- Send `USER_POS_X`, `USER_POS_Y`, `USER_VX`, `USER_VY` in the same message
- Reset velocity to 0 if GPS fix is stale (> 10 s since last update)

**Step 8 — Modify `onMapRendered()`** (`src/pkjs/map-handler.ts`)
- After sending the bitmap, also send the initial user position, map dimensions, and zero velocity:
  ```typescript
  messageQueue.enqueue({
    USER_POS_X: initialUserX,
    USER_POS_Y: initialUserY,
    MAP_BUFFER_WIDTH: expandedW,
    MAP_BUFFER_HEIGHT: expandedH,
    USER_BEARING: currentBearing,
    USER_VX: 0,
    USER_VY: 0,
  });
  ```

### Phase 2: Watch-side changes

**Step 9 — Expand bitmap storage** (`src/c/navigation.c`)
- Change `MAX_BITMAP_DATA_SIZE` to accommodate expanded buffer (e.g., `SCREEN_W * SCREEN_H * 2` or compute from factor)
- Pass expanded width/height from the phone via `MAP_BUFFER_WIDTH/HEIGHT` messages
- `navigation_create_map_layer()` now creates the bitmap at the expanded size received from the phone
- Update `s_bitmap_width`, `s_bitmap_height`, `s_bitmap_data_size` based on received dimensions
- Add `s_viewport_x` and `s_viewport_y` (offset into the expanded map for the visible screen portion)
- Add `s_user_x`, `s_user_y` (user position in expanded map pixels)
- Add `s_compass_heading` (latest compass reading)

**Step 10 — Add compass service with low-pass filter** (`src/c/navigation.c`)
The Pebble compass can be noisy. Apply an exponential moving average (EMA) filter:
```c
static int32_t s_filtered_heading;  // millidegrees, accumulated
static bool s_compass_initialized;

static void compass_handler(CompassHeadingData heading, void* context) {
    if (!s_compass_initialized) {
        s_filtered_heading = heading.true_heading;
        s_compass_initialized = true;
        return;
    }
    // Handle 360° wrap-around
    int32_t raw = heading.true_heading;
    int32_t diff = raw - s_filtered_heading;
    if (diff > 180000) diff -= 360000;
    if (diff < -180000) diff += 360000;
    // EMA: α = 0.3 (smoothing factor, tune empirically)
    s_filtered_heading += (diff * 3 + 5) / 10;  // floor(diff * 0.3 + 0.5)
    // Normalize
    if (s_filtered_heading >= 360000) s_filtered_heading -= 360000;
    if (s_filtered_heading < 0) s_filtered_heading += 360000;
}
```
- Subscribe in `navigation_init()`: `compass_service_subscribe(compass_handler);`
- `s_compass_heading` (used by rotation) = `s_filtered_heading / 1000` (degrees)

**Step 11 — Handle position + velocity messages** (`src/c/navigation.c`)
- Add handlers for position and velocity:
  ```c
  if (nav_pos_x) {
    s_user_x = nav_pos_x->value->uint16;
    s_last_pos_update = clock_ms();  // for velocity-based extrapolation
  }
  if (nav_pos_y) s_user_y = nav_pos_y->value->uint16;
  if (nav_vx) s_user_vx = (int16_t)nav_vx->value->int16;
  if (nav_vy) s_user_vy = (int16_t)nav_vy->value->int16;
  ```
- Store `MESSAGE_KEY_USER_BEARING` similarly for the user icon direction
- Store `MESSAGE_KEY_MAP_BUFFER_WIDTH/HEIGHT` when a new map arrives

**Step 12 — Velocity-based position extrapolation on watch** (`src/c/navigation.c`)

Between GPS position updates (1–5 s apart), the user icon would jump. Instead, extrapolate position in real-time using the velocity sent by the phone:

```c
static uint64_t s_last_pos_update;  // ms from clock_ms()
static int s_user_x, s_user_y;      // base position from last message
static int16_t s_user_vx, s_user_vy; // velocity in fixed-point 8.7 (pixels/s)

// Called every frame from map_update_proc:
static void extrapolate_user_pos(void) {
    uint64_t now = clock_ms();
    uint64_t dt_ms = now - s_last_pos_update;
    if (dt_ms > 0 && (s_user_vx != 0 || s_user_vy != 0)) {
        // velocity * dt (ms) / 1000 / 128
        int dx = (int)((int64_t)s_user_vx * (int64_t)dt_ms) / (128 * 1000);
        int dy = (int)((int64_t)s_user_vy * (int64_t)dt_ms) / (128 * 1000);
        s_current_display_x = s_user_x + dx;
        s_current_display_y = s_user_y + dy;
    } else {
        s_current_display_x = s_user_x;
        s_current_display_y = s_user_y;
    }
}
```

`s_current_display_x/y` is what `map_update_proc()` uses for viewport offset and rotation center. This gives smooth movement between GPS ticks. When the next position message arrives, the base is updated and the extrapolation resets.

**Step 13 — Rewrite `map_update_proc()`** (`src/c/navigation.c`)

New rendering logic:
```c
static void map_update_proc(Layer* layer, GContext* ctx) {
    if (!s_bitmap) return;
    
    GRect bounds = layer_get_bounds(layer);
    
    if (s_rotation_mode) {
        // Rotated rendering — inverse sample from expanded map
        int screen_w = bounds.size.w;
        int screen_h = bounds.size.h;
        int center_x = screen_w / 2;
        int center_y = screen_h * USER_Y_OFFSET;  // 0.85
        float rot_rad = DEG_TO_TRIGANGLE(s_compass_heading);
        
        GBitmap* rot_bmp = render_rotated(s_bitmap, s_bitmap_width, s_bitmap_height,
                                          s_user_x, s_user_y,
                                          screen_w, screen_h,
                                          center_x, center_y, rot_rad);
        graphics_draw_bitmap_in_rect(ctx, rot_bmp, bounds);
        gbitmap_destroy(rot_bmp);
    } else {
        // Non-rotated — just blit the viewport portion
        int view_x = s_user_x - bounds.size.w / 2;
        int view_y = s_user_y - bounds.size.h / 2;
        // Clamp to expanded map bounds
        view_x = MAX(0, MIN(view_x, s_bitmap_width - bounds.size.w));
        view_y = MAX(0, MIN(view_y, s_bitmap_height - bounds.size.h));
        
        // Use Pebble's sub-bitmap API to avoid copying
        GBitmap* sub = gbitmap_create_as_sub_bitmap(s_bitmap, 
            GRect(view_x, view_y, bounds.size.w, bounds.size.h));
        graphics_draw_bitmap_in_rect(ctx, sub, bounds);
        gbitmap_destroy(sub);
    }
    
    // Draw user icon (arrow pointing in bearing direction)
    draw_user_icon(ctx, bounds, s_compass_heading);
    
    // Draw existing UI overlays: time, zoom, gear
    draw_ui_overlays(ctx, bounds);
}
```

**Step 13a — Implement `render_rotated()`** (`src/c/navigation.c`)
This is the core new function. It:
1. Creates a temporary `GBitmap` at screen size (or reuses a pre-allocated one)
2. For each output pixel `(dx, dy)`, computes source pixel `(sx, sy)` using inverse rotation around `(s_user_x, s_user_y)`
3. Samples from the expanded map and writes to the temp bitmap
4. Returns the temp bitmap

For Emery/Gabbro (8-bit): direct byte sampling
For Flint (2-bit): unpack byte → 4 pixel indices → rotate → repack, OR use an 8-bit temp buffer

**Step 13b — Implement `draw_user_icon()`** (`src/c/navigation.c`)
Draw a direction arrow (triangle/chevron) at screen center using Pebble's `graphics_fill_triangle()` or `graphics_draw_line()`. Color: cyan (`GColorCyan`).

**Step 14 — Handle expansion size in navigation** (`src/c/navigation.c`)
- `navigation_handle_message()` already handles bitmap chunks and knows the total. Add handling for `MAP_BUFFER_WIDTH/HEIGHT` to update `s_bitmap_width/height`.
- When a new map arrives (chunk index 0), the bitmap dimensions may have changed. Re-create the bitmap if needed.

**Step 15 — Limit rotation to the available buffer**
- If the user moves to an edge where the rotated view would go out of bounds, cap the rotation or let corners show background color
- The expanded buffer factor (1.3×) means at high rotation angles, the content area is smaller. This is acceptable — high rotation happens at low speeds where the user doesn't need full map coverage.

### Phase 3: Integration & tuning

**Step 16 — Update `main.c` for new messages**
- Add dispatchers in `inbox_received()` for `USER_POS_X`, `USER_POS_Y`, `MAP_BUFFER_WIDTH`, `MAP_BUFFER_HEIGHT`, `USER_BEARING`
- Pass these to `navigation_handle_message()` (it already returns false for unknown keys, so add the new dispatches after the existing `navigation_handle_message` call)

**Step 17 — Add ROTATION_MODE to watch rotation logic**
- The watch already receives `ROTATION_MODE` → `menu_set_rotation_mode()` stores it
- `map_update_proc()` checks `s_rotation_mode` (add a static/extern variable in navigation.c)

**Step 18 — Tune the expansion factor and edge threshold**
- Start with `EXPAND_FACTOR = 1.3` and inner safe zone of 60 % (20 % margin)
- Monitor `USER_POS_X/Y` values to ensure re-renders aren't too frequent
- Test on Gabbro for memory; reduce factor if needed

**Step 19 — Test and iterate**
- `npm run build` + `npm run debug` (emery) to test
- Verify: position updates appear on watch, map rotates with compass, user icon tracks correctly
- Verify: map only re-sends when zoom/route changes or user approaches edge
- Verify: memory is stable (no crashes on Gabbro)
- Test extremes: zoom in/out, stop/start routing, toggle rotation

---

## 5. Key Trade-offs Summary

| Decision | Option chosen | Rationale |
|----------|--------------|-----------|
| Expansion factor | 1.3× | Balance of movement/rotation buffer vs RAM |
| Rotation angle | Uses watch compass (not route bearing) | User requested watch compass; simplifies protocol |
| Edge detection | Phone-side at 20% inner margin | Phone has geospatial context, watch just receives pixels |
| User position format | Pixel offsets in expanded map | Avoids lat/lng conversion on watch |
| Flint rotation | 8-bit intermediate buffer (24 KB temp) | 2-bit packed rotation is too complex for v1 |
| User icon drawing | Watch C code (triangle/line drawing) | No bitmap needed, simple pebble graphics API calls |
| Smooth interpolation | Velocity-based extrapolation on watch | Phone sends VX/VY; watch extrapolates between GPS ticks for real-time smooth movement |
| Position update frequency | On every GPS tick (~1–5 s) | Small messages, low bandwidth impact |
| Compass filter | Exponential moving average | Reduce jitter without adding latency |

---

## 6. Edge Cases & Future Work

- **No compass calibration**: The Pebble compass can be inaccurate without calibration. If `compass_service_peek()` returns unreliable data, fall back to GPS bearing from phone.
- **Position arrives before map**: Send position messages are queued; the watch should ignore them until a map buffer is loaded.
- **Zoom changes always trigger re-render**: This is correct — the expanded map is at a specific zoom level.
- **Route recalculation (>100 m off-route)**: This triggers a re-render with a new route. The phone can send the new expanded map + route info.
- **Future optimization**: Pre-allocate a screen-sized temporary bitmap for rotated output to avoid per-frame `gbitmap_create_blank()`.
- **Velocity extrapolation**: When position messages stall (> 10 s), the watch should fade velocity to 0 to prevent runaway drift. Implement a velocity timeout in `extrapolate_user_pos()`.
