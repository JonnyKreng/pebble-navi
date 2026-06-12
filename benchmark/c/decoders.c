#include "decoders.h"
#include <string.h>

void decode_raw(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size) {
    (void)data_len;
    size_t copy = data_len - 4 < out_size ? data_len - 4 : out_size;
    memcpy(out, data + 4, copy);
}

void decode_rle(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size) {
    size_t ip = 0, op = 0;
    while (ip < data_len && op < out_size) {
        uint8_t b = data[ip++];
        if (b < 64) {
            out[op++] = b;
        } else if (b == 64) {
            if (ip >= data_len) break;
            int count = data[ip++] + 1;
            if (ip >= data_len) break;
            uint8_t val = data[ip++];
            size_t n = count;
            if (op + n > out_size) n = out_size - op;
            memset(out + op, val, n);
            op += n;
        }
    }
}

void decode_hoffmann(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size) {
    size_t ip = 0, op = 0;
    while (ip < data_len && op < out_size) {
        uint8_t b = data[ip++];
        if (b & 0x80) {
            if (ip >= data_len) break;
            int count = (b & 0x7F) + 1;
            uint8_t val = data[ip++];
            size_t n = count;
            if (op + n > out_size) n = out_size - op;
            memset(out + op, val, n);
            op += n;
        } else {
            out[op++] = b;
        }
    }
}

void decode_hoffmann_xl(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size) {
    size_t ip = 0, op = 0;
    while (ip < data_len && op < out_size) {
        uint8_t b = data[ip++];
        if (b == 0xFF) {
            if (ip + 3 > data_len) break;
            int lo = data[ip++];
            int hi = data[ip++];
            int len = lo | (hi << 8);
            uint8_t val = data[ip++];
            size_t n = len;
            if (op + n > out_size) n = out_size - op;
            memset(out + op, val, n);
            op += n;
        } else if (b & 0x80) {
            if (ip >= data_len) break;
            int count = (b & 0x7F) + 1;
            uint8_t val = data[ip++];
            size_t n = count;
            if (op + n > out_size) n = out_size - op;
            memset(out + op, val, n);
            op += n;
        } else {
            out[op++] = b;
        }
    }
}

void decode_lzss(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size) {
    size_t ip = 0, op = 0;
    while (ip < data_len && op < out_size) {
        uint8_t flags = data[ip++];
        for (int bit = 0; bit < 8 && ip < data_len && op < out_size; bit++) {
            if (flags & (1 << (7 - bit))) {
                if (ip + 1 >= data_len) break;
                uint8_t off = data[ip++];
                uint8_t len = data[ip++];
                size_t start = op - off;
                for (uint8_t k = 0; k < len && op < out_size; k++) {
                    out[op++] = out[start + k];
                }
            } else {
                out[op++] = data[ip++];
            }
        }
    }
}

void decode_lzss512(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size) {
    size_t ip = 0, op = 0;
    while (ip < data_len && op < out_size) {
        uint8_t flags = data[ip++];
        for (int bit = 0; bit < 8 && ip < data_len && op < out_size; bit++) {
            if (flags & (1 << (7 - bit))) {
                if (ip + 2 >= data_len) break;
                uint8_t off_lo = data[ip++];
                uint8_t off_hi = data[ip++];
                uint8_t len = data[ip++];
                size_t off = (size_t)off_lo | ((size_t)off_hi << 8);
                size_t start = op - off;
                for (uint8_t k = 0; k < len && op < out_size; k++) {
                    out[op++] = out[start + k];
                }
            } else {
                out[op++] = data[ip++];
            }
        }
    }
}

void decode_adaptive(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size) {
    if (data_len < 1) return;
    uint8_t algo = data[0];
    const uint8_t* inner = data + 1;
    size_t inner_len = data_len - 1;
    switch (algo) {
        case 0: decode_hoffmann_xl(inner, inner_len, out, out_size); return;
        case 1: decode_lzss(inner, inner_len, out, out_size); return;
        case 2: decode_lzss(inner, inner_len, out, out_size); return;
        case 3: decode_lzss512(inner, inner_len, out, out_size); return;
    }
}

void decode_delta_rle(const uint8_t* data, size_t data_len, uint8_t* out,
                      int width, int height) {
    size_t ip = 0;

    /* Decode first row */
    for (int x = 0; x < width && ip < data_len; ) {
        uint8_t b = data[ip++];
        if (b < 64) {
            out[x++] = b;
        } else if (b == 64) {
            if (ip + 1 >= data_len) break;
            int count = data[ip++] + 1;
            uint8_t val = data[ip++];
            int n = count;
            if (x + n > width) n = width - x;
            memset(out + x, val, n);
            x += n;
        }
    }

    /* Decode subsequent rows */
    for (int y = 1; y < height; y++) {
        int row_start = y * width;
        int prev_start = (y - 1) * width;
        uint8_t delta[2048]; /* max width = 260, safe */
        int dx = 0;

        while (dx < width && ip < data_len) {
            uint8_t b = data[ip++];
            if (b < 64) {
                delta[dx++] = b;
            } else if (b == 64) {
                if (ip + 1 >= data_len) break;
                int count = data[ip++] + 1;
                uint8_t val = data[ip++];
                int n = count;
                if (dx + n > width) n = width - dx;
                memset(delta + dx, val, n);
                dx += n;
            }
        }

        for (int x = 0; x < width; x++) {
            out[row_start + x] = delta[x] ^ out[prev_start + x];
        }
    }
}
