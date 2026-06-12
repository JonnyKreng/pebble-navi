#ifndef BENCHMARK_DECODERS_H
#define BENCHMARK_DECODERS_H

#include <stdint.h>
#include <stddef.h>

/* Raw: copies data[4..4+outSize-1] to out */
void decode_raw(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size);

/* RLE: existing Pebble escape scheme (escape byte = 64) */
void decode_rle(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size);

/* Hoffmann: top-bit run flag */
void decode_hoffmann(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size);

/* Hoffmann-XL: extended runs via 0xFF marker + uint16 length */
void decode_hoffmann_xl(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size);

/* LZSS: 1-byte offset (works with 64 or 255-byte window) */
void decode_lzss(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size);

/* LZSS-512: 2-byte offset LE */
void decode_lzss512(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size);

/* Adaptive: 1-byte type tag followed by algorithm data (0=XL, 1=lzss64, 2=lzss255, 3=lzss512) */
void decode_adaptive(const uint8_t* data, size_t data_len, uint8_t* out, size_t out_size);

/* Delta-RLE: row-wise delta + RLE */
void decode_delta_rle(const uint8_t* data, size_t data_len, uint8_t* out,
                      int width, int height);

#endif /* BENCHMARK_DECODERS_H */
