CFLAGS = -std=c99 -Wall -Wextra -O2
LDFLAGS = -lm

BENCH = decode_bench

.PHONY: all clean

all: $(BENCH)

$(BENCH): main.c decoders.c decoders.h
	$(CC) $(CFLAGS) -o $@ main.c decoders.c $(LDFLAGS)

clean:
	rm -f $(BENCH)
