#!/usr/bin/env bash
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BENCH_DIR/.." && pwd)"

echo "╔═══════════════════════════════════════════╗"
echo "║  Pebble Map Compression Benchmark        ║"
echo "╚═══════════════════════════════════════════╝"

# ─── Step 1: Compile & run TypeScript encoder ────────
echo ""
echo "◆ Step 1: Generating map data and encoding..."

cd "$ROOT_DIR"
npx esbuild "$BENCH_DIR/encode.ts" --bundle --platform=node --target=node18 \
  --outfile="$BENCH_DIR/encode.bundle.js" --external:fs --external:path 2>&1

node "$BENCH_DIR/encode.bundle.js"

# ─── Step 2: Compile C decoders ─────────────────────
echo ""
echo "◆ Step 2: Compiling C decoders..."

cd "$BENCH_DIR/c"
make clean 2>/dev/null || true
make

# ─── Step 3: Run C decode benchmark ─────────────────
echo ""
echo "◆ Step 3: Running C decode benchmark..."

cd "$ROOT_DIR"
./benchmark/c/decode_bench

echo ""
echo "◆ Done!"
