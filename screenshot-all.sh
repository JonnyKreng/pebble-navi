#!/bin/bash
set -euo pipefail

# Screenshot maker for pebble-navi.
# For each watch platform group (emery, gabbro, chalk, basalt, aplite/diorite/flint):
#   1. Start the emulator, install the app (with DO_TESTING enabled for known GPS + destinations)
#   2. Navigate menus via emulated button presses
#   3. Capture 6 screenshots per group
#
# Dependencies: Pebble SDK, pebble tool on PATH, internet (for OSM tiles + OSRM routing).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TEST_DATA="src/pkjs/test-data.ts"
TEST_DATA_JS="src/pkjs/test-data.js"
TEST_DATA_BACKUP="src/pkjs/test-data.ts.screenshots.bak"
SCREENSHOT_DIR="screenshots"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
    echo ""
    info "Restoring test-data.ts..."
    if [ -f "$TEST_DATA_BACKUP" ]; then
        cp "$TEST_DATA_BACKUP" "$TEST_DATA"
        rm -f "$TEST_DATA_BACKUP"
        # Re-compile so the JS file matches
        npx tsc 2>/dev/null || true
    fi
    info "Cleaning up emulator..."
    pebble kill 2>/dev/null || true
    pkill -x qemu-pebble 2>/dev/null || true
    pkill -x qemu-pebmainble 2>/dev/null || true
    echo ""
    info "Done."
}
trap cleanup EXIT

# -------- Enable testing mode --------
cp "$TEST_DATA" "$TEST_DATA_BACKUP"
info "Enabling DO_TESTING mode (fixed GPS + test destinations)..."
sed -i '' 's/export const DO_TESTING: boolean = false;/export const DO_TESTING: boolean = true;/' "$TEST_DATA"

# -------- Build --------
info "Compiling TypeScript..."
npm run pretsc
npx tsc

info "Building Pebble app (all platforms)..."
pebble build

mkdir -p "$SCREENSHOT_DIR"

# -------- Helpers --------
take_screenshot() {
    local platform=$1 filename=$2
    local max_attempts=3
    local attempt=1
    while [ "$attempt" -le "$max_attempts" ]; do
        info "  [$platform] Screenshot -> $filename (attempt $attempt/$max_attempts)"
        if pebble screenshot --emulator "$platform" "$SCREENSHOT_DIR/$filename"; then
            return 0
        fi
        warn "  [$platform] Screenshot $filename attempt $attempt/$max_attempts FAILED"
        if [ "$attempt" -lt "$max_attempts" ]; then
            sleep 2
        fi
        attempt=$((attempt + 1))
    done
}

press() {
    local platform=$1 button=$2
    info "  [$platform] Button: $button"
    pebble emu-button --emulator "$platform" click "$button" || warn "  [$platform] Button $button FAILED"
}

run_platform() {
    local platform=$1 prefix=$2

    info ""
    info "========================================"
    info "  Platform : $platform"
    info "  Prefix   : ${prefix}{1..6}.png"
    info "========================================"
    info ""

    # Kill any previous emulator
    info "  Killing previous emulator..."
    pebble kill 2>/dev/null || true
    pkill -x qemu-pebble 2>/dev/null || true
    pkill -x qemu-pebmainble 2>/dev/null || true
    sleep 2

    # Wipe persistent data so the app starts clean
    info "  Wiping emulator data..."
    pebble wipe 2>/dev/null || true
    sleep 1

    # Install & launch
    info "  Installing on $platform..."
    pebble install --emulator "$platform"
    info "  Waiting 5s for app to initialize, fetch tiles, and render..."
    sleep 5

    # -------- Screenshot 1: Map view --------
    info "  Step 1/5: Map view (initial render)"
    take_screenshot "$platform" "${prefix}1.png"

    # -------- Screenshot 2: Main menu --------
    info "  Step 2/5: Opening main menu"
    press "$platform" select
    sleep 2
    take_screenshot "$platform" "${prefix}2.png"

    # -------- Screenshot 3: Destination list --------
    info "  Step 3/5: Selecting destination"
    # "Select Destination" is at index 0 and already highlighted
    press "$platform" select
    sleep 4
    take_screenshot "$platform" "${prefix}3.png"

    # -------- Screenshot 4: Map with route --------
    info "  Step 4/5: Choosing first destination (Brandenburger Tor)"
    press "$platform" select
    info "  Waiting 4s for OSRM routing + map render..."
    sleep 4
    take_screenshot "$platform" "${prefix}4.png"

    # -------- Screenshot 5: Main menu (with route active) --------
    info "  Step 5/5: Enabling rotation mode"
    press "$platform" select
    sleep 1
    press "$platform" down
    sleep 0.5
    press "$platform" down
    sleep 0.5
    press "$platform" down
    sleep 0.5
    press "$platform" down
    sleep 0.5
    press "$platform" down
    sleep 0.5
    press "$platform" select
    sleep 0.5
    press "$platform" back
    info "  Waiting 4s for map re-render with rotation..."
    sleep 4
    take_screenshot "$platform" "${prefix}5.png"


    info "  Done with $platform"
    info ""
}

# -------- Run each platform --------
run_platform "flint"  "aplite_diorite_flint"
run_platform "emery"  "emery"
run_platform "gabbro" "gabbro"
run_platform "chalk"  "chalk"
run_platform "basalt" "basalt"

echo ""
info "========================================"
info "  ALL SCREENSHOTS CAPTURED"
info "========================================"
echo ""
ls -lh "$SCREENSHOT_DIR"/*.png
