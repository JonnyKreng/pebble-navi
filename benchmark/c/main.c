#include "decoders.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <dirent.h>
#include <sys/stat.h>

#define CHUNK_SIZE 2048
#define MAX_SIZE (260 * 260)
#define MAX_DECODERS 24

typedef struct {
    const char* name;
    size_t (*decode)(const uint8_t*, size_t, uint8_t*, size_t, void*);
    void* ctx;
} DecoderInfo;

/* Wrappers to unify signatures */
static size_t raw_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)ctx;
    decode_raw(d, len, out, out_sz);
    return out_sz;
}

static size_t rle_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)ctx;
    decode_rle(d, len, out, out_sz);
    return out_sz;
}

static size_t hoffmann_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)ctx;
    decode_hoffmann(d, len, out, out_sz);
    return out_sz;
}

static size_t hoffmann_xl_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)ctx;
    decode_hoffmann_xl(d, len, out, out_sz);
    return out_sz;
}

static size_t lzss_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)ctx;
    decode_lzss(d, len, out, out_sz);
    return out_sz;
}

static size_t lzss512_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)ctx;
    decode_lzss512(d, len, out, out_sz);
    return out_sz;
}

static size_t adaptive_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)ctx;
    decode_adaptive(d, len, out, out_sz);
    return out_sz;
}

typedef struct { int width, height; } WhCtx;

static size_t delta_wrap(const uint8_t* d, size_t len, uint8_t* out, size_t out_sz, void* ctx) {
    (void)out_sz;
    WhCtx* wh = (WhCtx*)ctx;
    decode_delta_rle(d, len, out, wh->width, wh->height);
    return (size_t)(wh->width * wh->height);
}

static int parse_filename(const char* fname, char* map, char* pattern, char* algo) {
    char copy[256];
    strncpy(copy, fname, sizeof(copy) - 1);
    copy[sizeof(copy) - 1] = '\0';
    char* dot = strrchr(copy, '.');
    if (!dot || strcmp(dot, ".bin") != 0) return 0;
    *dot = '\0';
    char* p1 = strchr(copy, '_');
    if (!p1) return 0;
    *p1++ = '\0';
    strcpy(map, copy);
    char* p2 = strchr(p1, '_');
    if (!p2) return 0;
    *p2++ = '\0';
    strcpy(pattern, p1);
    strcpy(algo, p2);
    return 1;
}

static int read_file(const char* path, uint8_t** out_data, size_t* out_size) {
    FILE* f = fopen(path, "rb");
    if (!f) return -1;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz <= 0) { fclose(f); return -1; }
    *out_data = (uint8_t*)malloc(sz);
    if (!*out_data) { fclose(f); return -1; }
    size_t n = fread(*out_data, 1, sz, f);
    fclose(f);
    *out_size = n;
    return 0;
}

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

int main(void) {
    const char* data_dir = "benchmark/data";
    DIR* dir = opendir(data_dir);
    if (!dir) {
        data_dir = "../benchmark/data";
        dir = opendir(data_dir);
        if (!dir) {
            fprintf(stderr, "Cannot open benchmark/data/\n");
            return 1;
        }
    }

    struct dirent* entry;
    char raw_files[64][512];
    int n_raw = 0;

    rewinddir(dir);
    while ((entry = readdir(dir)) && n_raw < 64) {
        char map[64], pat[64], algo[64];
        if (parse_filename(entry->d_name, map, pat, algo) && strcmp(algo, "raw") == 0) {
            snprintf(raw_files[n_raw++], sizeof(raw_files[0]), "%s/%s", data_dir, entry->d_name);
        }
    }

    printf("╔══════════════════════════════════════════════════════════════╗\n");
    printf("║          Pebble Map Compression Benchmark (C decode)        ║\n");
    printf("╚══════════════════════════════════════════════════════════════╝\n\n");

    for (int ri = 0; ri < n_raw; ri++) {
        char map[64], pat[64], _algo[64];
        const char* base = raw_files[ri] + strlen(data_dir) + 1;
        if (!parse_filename(base, map, pat, _algo)) continue;

        uint8_t* ref_data = NULL;
        size_t ref_size = 0;
        if (read_file(raw_files[ri], &ref_data, &ref_size) != 0) continue;

        int width = ref_data[0] | (ref_data[1] << 8);
        int height = ref_data[2] | (ref_data[3] << 8);
        int px_size = width * height;
        uint8_t* reference = ref_data + 4;

        printf("─── %s %s (%dx%d, %d px) ───\n", map, pat, width, height, px_size);

        WhCtx wh = { width, height };

        DecoderInfo decoders[MAX_DECODERS];
        int nd = 0;
        decoders[nd++] = (DecoderInfo){ "raw",         raw_wrap,         NULL };
        decoders[nd++] = (DecoderInfo){ "rle",         rle_wrap,         NULL };
        decoders[nd++] = (DecoderInfo){ "hoffmann",    hoffmann_wrap,    NULL };
        decoders[nd++] = (DecoderInfo){ "hoffmann-xl", hoffmann_xl_wrap, NULL };
        decoders[nd++] = (DecoderInfo){ "lzss64",      lzss_wrap,        NULL };
        decoders[nd++] = (DecoderInfo){ "lzss255",     lzss_wrap,        NULL };
        decoders[nd++] = (DecoderInfo){ "lzss512",     lzss512_wrap,     NULL };
        decoders[nd++] = (DecoderInfo){ "delta-rle",   delta_wrap,       &wh };
        decoders[nd++] = (DecoderInfo){ "adaptive",    adaptive_wrap,    NULL };

        for (int di = 0; di < nd; di++) {
            char algo_file[512];
            snprintf(algo_file, sizeof(algo_file), "%s/%s_%s_%s.bin",
                     data_dir, map, pat, decoders[di].name);

            uint8_t* enc_data = NULL;
            size_t enc_size = 0;
            if (read_file(algo_file, &enc_data, &enc_size) != 0) {
                printf("  %-12s  FILE NOT FOUND\n", decoders[di].name);
                continue;
            }

            uint8_t* decoded = (uint8_t*)malloc(px_size);

            /* Warmup */
            decoders[di].decode(enc_data, enc_size, decoded, (size_t)px_size, decoders[di].ctx);

            /* Timed runs */
            const int runs = 100;
            double total_time = 0.0;
            for (int r = 0; r < runs; r++) {
                memset(decoded, 0, px_size);
                double t0 = now_ms();
                decoders[di].decode(enc_data, enc_size, decoded, (size_t)px_size, decoders[di].ctx);
                double t1 = now_ms();
                if (r >= 10) total_time += (t1 - t0);
            }
            double avg_decode_ms = total_time / (runs - 10);

            /* Verify */
            int mismatches = 0;
            for (int i = 0; i < px_size && mismatches <= 10; i++) {
                if (decoded[i] != reference[i]) mismatches++;
            }

            double ratio = (double)enc_size / px_size;
            int chunks = (int)((enc_size + CHUNK_SIZE - 1) / CHUNK_SIZE);

            printf("  %-12s  enc=%7zu  ratio=%.4f  chunks=%d  decode=%7.3fms  %s\n",
                   decoders[di].name, enc_size, ratio, chunks, avg_decode_ms,
                   mismatches == 0 ? "PASS" : "FAIL");

            free(enc_data);
            free(decoded);
        }

        free(ref_data);
        printf("\n");
    }

    closedir(dir);
    return 0;
}
