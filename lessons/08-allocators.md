<!-- {"title": "How malloc Works, and When to Write Your Own", "summary": "Headers, free lists, splitting, coalescing and fragmentation, then arenas and pools: allocators that trade generality for speed and simplicity.", "practice": ["bump-allocator", "fixed-size-pool-allocator", "reference-counted-strings", "lru-cache", "implement-malloc"]} -->
# How malloc works, and when to write your own

`malloc` is ordinary C code. It asks the operating system for big regions of memory (`VirtualAlloc` on Windows, `mmap`/`sbrk` on Linux) and carves them into the blocks you request.

## Headers

`free(p)` receives only a pointer, so the allocator must recover the block's size from `p` alone. The classic answer is a small **header** just before every block:

```
          header         your bytes
        ┌─────────┬──────────────────────┐
        │ size,   │                      │
        │ flags   │                      │
        └─────────┴──────────────────────┘
                  ^ the pointer malloc returns
```

This explains several "mysterious" crashes: writing before the start of a block, or freeing `p + 1`, corrupts or misreads a header, and the program dies later inside `malloc` or `free`.

## Free lists, splitting and coalescing

- **Allocate**: find a free block that is big enough (*first fit*, *best fit*...), and **split** it if the remainder is useful.
- **Free**: mark the block free and **coalesce** it with free neighbours, otherwise memory fragments into many small pieces.
- **Fragmentation**: plenty of free memory in total, but no single piece large enough. Allocators fight it with size classes, coalescing and placement policies.

Real allocators (glibc's ptmalloc, jemalloc, mimalloc, Windows' heap) add per-size free lists ("bins"), thread-local caches and many tricks, but the core ideas are the ones you implement in *Implement malloc and free*.

## Why write your own?

General-purpose `malloc` handles any size in any order from any thread, and it pays for that generality. When you know more about your objects, a specialized allocator can be simpler, faster and leak-proof.

### Arenas (bump allocators)
Allocate by bumping an offset; free *everything* at once. Ideal when many objects share a lifetime (one request, one frame, one parse).

```c
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct { unsigned char *base; size_t cap, used; } Arena;

void *arenaAlloc(Arena *a, size_t size, size_t align) {
    uintptr_t p = ((uintptr_t)a->base + a->used + align - 1) & ~(uintptr_t)(align - 1);
    size_t off = (size_t)(p - (uintptr_t)a->base);
    if (off > a->cap || size > a->cap - off) return NULL;
    a->used = off + size;
    return a->base + off;
}

int main(void) {
    Arena a = { malloc(1024), 1024, 0 };
    if (a.base == NULL) return 1;
    for (int frame = 0; frame < 3; frame++) {
        int *scores = arenaAlloc(&a, 10 * sizeof *scores, _Alignof(int));
        double *weights = arenaAlloc(&a, 10 * sizeof *weights, _Alignof(double));
        for (int i = 0; i < 10; i++) { scores[i] = frame * i; weights[i] = i * 0.5; }
        printf("frame %d: used %zu bytes, scores[9] = %d\n", frame, a.used, scores[9]);
        a.used = 0;                    // free everything from this frame at once
    }
    free(a.base);                      // one free for the whole arena
    return 0;
}
```

### Pools (fixed-size blocks)
Every block has the same size, free blocks form a linked list stored *inside* the free blocks themselves. O(1) alloc and free, no fragmentation. Ideal for many objects of one type (nodes, particles, packets).

### Reference counting
Not an allocator, but a policy for *when* to free shared objects: each owner retains and releases, and the last release frees.

## Debug allocators

The allocator LeakCode links into your programs is a *debug allocator*. It trades speed and memory for catching bugs: every block gets its own pages and a guard page, freed blocks are poisoned and never reused, and allocation sites are recorded. Tools like AddressSanitizer, Valgrind and Windows' PageHeap use the same ideas. Use one of them on every C project you write.
