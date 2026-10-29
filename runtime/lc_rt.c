/* lc_rt.c - the LeakCode runtime, linked into every program LeakCode builds.
 *
 *  1. A checking allocator behind malloc/calloc/realloc/free (see lc_mem.h).
 *     Each block gets pages of its own, placed so that it ends exactly at an
 *     inaccessible guard page; freed blocks are decommitted and never reused.
 *     Overflows and use-after-free therefore fault on the very instruction
 *     that commits them. Bytes before a block are filled with a guard pattern
 *     and checked when the block is freed (underflow detection). If too many
 *     blocks are live the allocator falls back to canary-guarded heap blocks.
 *  2. A crash reporter: access violations, stack overflows, MSVC run-time
 *     check failures, abort() and CRT invalid-parameter errors are turned into
 *     symbolized reports (function, file and line via DbgHelp + the PDB).
 *  3. The test-harness API used by problem drivers (lc_driver.h).
 *
 * Everything is reported as JSON lines in the file named by LC_RESULT.
 * This file is compiled without lc_mem.h, so malloc/free here are the real ones.
 */
#define WIN32_LEAN_AND_MEAN
#ifndef _CRT_SECURE_NO_WARNINGS
#define _CRT_SECURE_NO_WARNINGS
#endif
#include <windows.h>
#include <dbghelp.h>
#include <crtdbg.h>
#include <rtcapi.h>
#include <ctype.h>
#include <math.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lc_driver.h"

#pragma comment(lib, "dbghelp.lib")

#define LC_PAGE             ((size_t)4096)
#define LC_DEPTH            10
#define LC_FILL_NEW         0xCD   /* fresh malloc memory (same as the MSVC debug heap) */
#define LC_FILL_FREED       0xDD   /* freed memory (canary mode) */
#define LC_FILL_GUARD       0xFD   /* bytes around a block */
#define LC_CANARY           16
#define LC_HUGE             ((size_t)1 << 46)
#define LC_ARENA_SIZE       ((size_t)1 << 30)
#define LC_COMMIT_MAX       ((size_t)192 << 20)
#define LC_RESERVE_MAX      ((size_t)64 << 30)
#define LC_QUAR_MAX_BLOCKS  200000
#define LC_QUAR_MAX_BYTES   ((size_t)64 << 20)
#define LC_MAX_FRAMES       48
#define LC_NORETURN         __declspec(noreturn)

enum { LC_LIVE = 1, LC_FREED = 2 };
enum { K_USER, K_HARNESS, K_RT, K_LIB };

typedef struct LcBlock LcBlock;
struct LcBlock {
    uintptr_t user;          /* pointer handed to the program */
    size_t size;             /* requested size */
    uintptr_t base;          /* guarded: first data page; canary: raw heap block */
    size_t span;             /* guarded: committed bytes; canary: raw size */
    const char *afile, *ffile;
    int aline, fline;
    int case_idx;
    unsigned char state, guarded, harness, readonly, by_realloc, adepth, fdepth;
    long long seq;
    void *astack[LC_DEPTH];
    void *fstack[LC_DEPTH];
    LcBlock *hnext, *prev, *next;
};

typedef struct { char *p; size_t len, cap; } LcBuf;

typedef struct {
    char fn[160];
    char file[MAX_PATH];
    int line;
    int kind;
} LcFrame;

static struct {
    int ready, judge;
    HANDLE meta, canary_heap, scratch, out;
    CRITICAL_SECTION lock;
    LcBlock **table;
    int table_bits;
    size_t table_count;
    LcBlock live, quar;
    size_t quar_blocks, quar_bytes;
    long long seq;
    uintptr_t arena_cur, arena_end;
    size_t reserved, committed;
    long long allocs, frees;
    size_t live_bytes, peak_bytes, limit;
    int case_idx, in_case, ncases;
    long long case_allocs, case_frees;
    size_t case_base, case_peak;
    LARGE_INTEGER freq, t0;
    LcBuf out_json, fails;
    int out_depth, out_count[64], nfails;
    char *in;
    size_t in_len, in_pos;
    const char *free_ctx;
    volatile LONG crashing;
    EXCEPTION_RECORD crash_rec;
    CONTEXT crash_ctx;
    int sym_ready;
    char exe_dir[MAX_PATH];
    char crt_msg[1024];
} G;

static void lc_lazy_init(void);
LC_NORETURN static void report_block_fatal(const char *kind, const char *title, LcBlock *b,
                                           const char *file, int line, const char *fmt, ...);

/* ======================================================================
 * Small string builder (memory comes from the runtime's private heap)
 * ====================================================================== */

static void buf_grow(LcBuf *b, size_t extra)
{
    size_t need = b->len + extra + 1, cap;
    char *np;
    if (need <= b->cap) return;
    cap = b->cap ? b->cap : 256;
    while (cap < need) cap *= 2;
    np = b->p ? (char *)HeapReAlloc(G.meta, 0, b->p, cap) : (char *)HeapAlloc(G.meta, 0, cap);
    if (!np) TerminateProcess(GetCurrentProcess(), 4);
    b->p = np;
    b->cap = cap;
}

static void buf_put(LcBuf *b, const char *s, size_t n)
{
    buf_grow(b, n);
    memcpy(b->p + b->len, s, n);
    b->len += n;
    b->p[b->len] = 0;
}

static void buf_puts(LcBuf *b, const char *s) { buf_put(b, s, strlen(s)); }

static void buf_vprintf(LcBuf *b, const char *fmt, va_list ap)
{
    va_list ap2;
    int n;
    va_copy(ap2, ap);
    n = _vscprintf(fmt, ap2);
    va_end(ap2);
    if (n <= 0) return;
    buf_grow(b, (size_t)n);
    vsnprintf(b->p + b->len, (size_t)n + 1, fmt, ap);
    b->len += (size_t)n;
}

static void buf_printf(LcBuf *b, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    buf_vprintf(b, fmt, ap);
    va_end(ap);
}

/* Appends s as a JSON string. Bytes outside printable ASCII are escaped as
 * \u00XX so garbage (e.g. uninitialized 0xCD bytes) stays visible. */
static void buf_json_str(LcBuf *b, const char *s)
{
    const unsigned char *c;
    if (!s) { buf_puts(b, "null"); return; }
    buf_put(b, "\"", 1);
    for (c = (const unsigned char *)s; *c; c++) {
        switch (*c) {
        case '"':  buf_put(b, "\\\"", 2); break;
        case '\\': buf_put(b, "\\\\", 2); break;
        case '\n': buf_put(b, "\\n", 2); break;
        case '\r': buf_put(b, "\\r", 2); break;
        case '\t': buf_put(b, "\\t", 2); break;
        default:
            if (*c < 0x20 || *c >= 0x7F) buf_printf(b, "\\u%04x", *c);
            else buf_put(b, (const char *)c, 1);
        }
    }
    buf_put(b, "\"", 1);
}

static void buf_free(LcBuf *b)
{
    if (b->p) HeapFree(G.meta, 0, b->p);
    b->p = NULL;
    b->len = b->cap = 0;
}

static void rec_emit(LcBuf *b)
{
    DWORD w;
    HANDLE h = G.out != INVALID_HANDLE_VALUE ? G.out : GetStdHandle(STD_ERROR_HANDLE);
    buf_put(b, "\n", 1);
    WriteFile(h, b->p, (DWORD)b->len, &w, NULL);
}

/* ======================================================================
 * Symbolization
 * ====================================================================== */

static const char *base_name(const char *path)
{
    const char *s = path, *p;
    for (p = path; *p; p++)
        if (*p == '\\' || *p == '/') s = p + 1;
    return s;
}

static void sym_init(void)
{
    if (G.sym_ready) return;
    G.sym_ready = 1;
    SymSetOptions(SYMOPT_LOAD_LINES | SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS |
                  SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_NO_PROMPTS);
    SymInitialize(GetCurrentProcess(), G.exe_dir[0] ? G.exe_dir : NULL, TRUE);
}

static int classify_file(const char *file)
{
    const char *bn = base_name(file);
    size_t dl = strlen(G.exe_dir);
    if (!file[0]) return K_LIB;
    if (_stricmp(bn, "lc_rt.c") == 0) return K_RT;
    if (_stricmp(bn, "driver.c") == 0 || _strnicmp(bn, "lc_", 3) == 0) return K_HARNESS;
    if (dl && _strnicmp(file, G.exe_dir, dl) == 0 && (file[dl] == '\\' || file[dl] == '/') &&
        !strchr(file + dl + 1, '\\') && !strchr(file + dl + 1, '/'))
        return K_USER;
    if (!strchr(file, '\\') && !strchr(file, '/')) return K_USER; /* relative name from __FILE__ */
    return K_LIB;
}

static void sym_frame(void *addr, int is_return, LcFrame *f)
{
    char sbuf[sizeof(SYMBOL_INFO) + 256];
    SYMBOL_INFO *si = (SYMBOL_INFO *)sbuf;
    IMAGEHLP_LINE64 ln;
    DWORD64 a = (DWORD64)(uintptr_t)addr - (is_return ? 1 : 0), disp = 0;
    DWORD d2 = 0;
    sym_init();
    strcpy(f->fn, "?");
    f->file[0] = 0;
    f->line = 0;
    memset(sbuf, 0, sizeof sbuf);
    si->SizeOfStruct = sizeof(SYMBOL_INFO);
    si->MaxNameLen = 255;
    if (SymFromAddr(GetCurrentProcess(), a, &disp, si)) {
        strncpy(f->fn, si->Name, sizeof f->fn - 1);
        f->fn[sizeof f->fn - 1] = 0;
    }
    memset(&ln, 0, sizeof ln);
    ln.SizeOfStruct = sizeof ln;
    if (SymGetLineFromAddr64(GetCurrentProcess(), a, &d2, &ln)) {
        strncpy(f->file, ln.FileName, sizeof f->file - 1);
        f->file[sizeof f->file - 1] = 0;
        f->line = (int)ln.LineNumber;
    }
    f->kind = classify_file(f->file);
}

/* Appends a JSON array of the interesting frames. Runtime frames are hidden
 * and the walk stops at main(). For a crash inside the C library, only the
 * library function the program called (e.g. sprintf, not its internals) is
 * kept. The first pc is a fault address when first_is_fault is set; all
 * others are return addresses. */
static void buf_frames(LcBuf *b, void **pcs, int n, int first_is_fault)
{
    static const char *kinds[] = { "user", "harness", "rt", "lib" };
    LcFrame *fr;
    int i, m = 0, out = 0, first_code = -1, api = -1;
    buf_put(b, "[", 1);
    fr = n > 0 ? (LcFrame *)HeapAlloc(G.meta, 0, sizeof(LcFrame) * (size_t)n) : NULL;
    if (fr) {
        for (i = 0; i < n; i++) {
            if (!pcs[i]) continue;
            sym_frame(pcs[i], !(first_is_fault && i == 0), &fr[m]);
            m++;
        }
        for (i = 0; i < m && first_code < 0; i++)
            if (fr[i].kind == K_USER || fr[i].kind == K_HARNESS) first_code = i;
        if (first_is_fault && m > 0 && fr[0].kind == K_LIB) {
            int limit = first_code < 0 ? m : first_code;
            for (i = 0; i < limit; i++)
                if (fr[i].kind == K_LIB) api = i;
        }
        for (i = 0; i < m && out < 24; i++) {
            LcFrame *f = &fr[i];
            if (i != api && f->kind != K_USER && f->kind != K_HARNESS) continue;
            if (out++) buf_put(b, ",", 1);
            buf_puts(b, "{\"fn\":");
            buf_json_str(b, f->fn);
            buf_puts(b, ",\"file\":");
            buf_json_str(b, base_name(f->file));
            buf_printf(b, ",\"line\":%d,\"k\":\"%s\"}", f->line, kinds[f->kind]);
            if (strcmp(f->fn, "main") == 0 && f->kind != K_LIB) break;
        }
        HeapFree(G.meta, 0, fr);
    }
    buf_put(b, "]", 1);
}
/* ======================================================================
 * Block bookkeeping
 * ====================================================================== */

static size_t table_slot(uintptr_t p)
{
    return (size_t)(((uint64_t)p * 0x9E3779B97F4A7C15ull) >> (64 - G.table_bits));
}

static void table_grow(void)
{
    int nb = G.table_bits + 1;
    size_t i, old = (size_t)1 << G.table_bits;
    LcBlock **ot = G.table, **nt = (LcBlock **)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof(LcBlock *) << nb);
    if (!nt) return;
    G.table = nt;
    G.table_bits = nb;
    for (i = 0; i < old; i++) {
        LcBlock *b = ot[i];
        while (b) {
            LcBlock *nx = b->hnext;
            size_t s = table_slot(b->user);
            b->hnext = nt[s];
            nt[s] = b;
            b = nx;
        }
    }
    HeapFree(G.meta, 0, ot);
}

static void table_insert(LcBlock *b)
{
    size_t s;
    if (G.table_count >= ((size_t)1 << G.table_bits)) table_grow();
    s = table_slot(b->user);
    b->hnext = G.table[s];
    G.table[s] = b;
    G.table_count++;
}

static LcBlock *table_find(uintptr_t p)
{
    LcBlock *b;
    for (b = G.table[table_slot(p)]; b; b = b->hnext)
        if (b->user == p) return b;
    return NULL;
}

static void table_remove(LcBlock *b)
{
    LcBlock **pp = &G.table[table_slot(b->user)];
    while (*pp && *pp != b) pp = &(*pp)->hnext;
    if (*pp) {
        *pp = b->hnext;
        G.table_count--;
    }
}

static void list_init(LcBlock *h) { h->next = h->prev = h; }

static void list_push(LcBlock *h, LcBlock *b)
{
    b->prev = h->prev;
    b->next = h;
    h->prev->next = b;
    h->prev = b;
}

static void list_unlink(LcBlock *b)
{
    b->prev->next = b->next;
    b->next->prev = b->prev;
    b->next = b->prev = NULL;
}

/* The block whose pages (or canary area) contain addr, live or freed. */
static LcBlock *find_block_region(uintptr_t addr)
{
    LcBlock *heads[2] = { &G.live, &G.quar }, *b;
    int h;
    for (h = 0; h < 2; h++)
        for (b = heads[h]->next; b != heads[h]; b = b->next) {
            uintptr_t hi = b->base + b->span + (b->guarded ? LC_PAGE : 0);
            if (addr >= b->base && addr < hi) return b;
        }
    return NULL;
}

/* The block whose user bytes [user, user+size) contain addr, live or freed. */
static LcBlock *find_block_containing(uintptr_t addr)
{
    LcBlock *heads[2] = { &G.live, &G.quar }, *b;
    int h;
    for (h = 0; h < 2; h++)
        for (b = heads[h]->next; b != heads[h]; b = b->next)
            if (addr >= b->user && addr < b->user + b->size) return b;
    return NULL;
}

/* ======================================================================
 * Allocation
 * ====================================================================== */

static int guard_carve(LcBlock *b, size_t n)
{
    size_t data = (n + LC_PAGE - 1) & ~(LC_PAGE - 1), need;
    uintptr_t base;
    if (data == 0) data = LC_PAGE;
    need = data + LC_PAGE;
    if (G.committed + data > LC_COMMIT_MAX) return 0;
    if (need > LC_ARENA_SIZE / 4) {
        /* big block: a reservation of its own */
        if (G.reserved + need > LC_RESERVE_MAX) return 0;
        base = (uintptr_t)VirtualAlloc(NULL, need, MEM_RESERVE, PAGE_NOACCESS);
        if (!base) return 0;
        G.reserved += need;
    } else {
        if (G.arena_cur + need > G.arena_end) {
            uintptr_t r;
            if (G.reserved + LC_ARENA_SIZE > LC_RESERVE_MAX) return 0;
            r = (uintptr_t)VirtualAlloc(NULL, LC_ARENA_SIZE, MEM_RESERVE, PAGE_NOACCESS);
            if (!r) return 0;
            G.reserved += LC_ARENA_SIZE;
            G.arena_cur = r;
            G.arena_end = r + LC_ARENA_SIZE;
        }
        base = G.arena_cur;
        G.arena_cur += need;
    }
    if (!VirtualAlloc((void *)base, data, MEM_COMMIT, PAGE_READWRITE)) return 0;
    G.committed += data;
    b->base = base;
    b->span = data;
    b->user = base + data - n;   /* the block ends exactly at the guard page */
    b->guarded = 1;
    memset((void *)base, LC_FILL_GUARD, data - n);
    return 1;
}

static int canary_carve(LcBlock *b, size_t n)
{
    size_t raw = n + 2 * LC_CANARY + 16;
    uintptr_t r = (uintptr_t)HeapAlloc(G.canary_heap, 0, raw);
    if (!r) return 0;
    b->base = r;
    b->span = raw;
    b->user = (r + LC_CANARY + 15) & ~(uintptr_t)15;
    b->guarded = 0;
    memset((void *)r, LC_FILL_GUARD, b->user - r);
    memset((void *)(b->user + n), LC_FILL_GUARD, r + raw - (b->user + n));
    return 1;
}

static void stats_on_alloc(size_t n)
{
    G.allocs++;
    G.live_bytes += n;
    if (G.live_bytes > G.peak_bytes) G.peak_bytes = G.live_bytes;
    if (G.in_case) {
        size_t cur = G.live_bytes > G.case_base ? G.live_bytes - G.case_base : 0;
        G.case_allocs++;
        if (cur > G.case_peak) G.case_peak = cur;
    }
}

LC_NORETURN static void fatal_size(size_t n, const char *file, int line, int is_limit);

static void *block_alloc(size_t n, int zero, const char *file, int line, int harness)
{
    LcBlock *b;
    lc_lazy_init();
    if (n >= LC_HUGE) fatal_size(n, file, line, 0);
    if (!harness && G.live_bytes + n > G.limit) fatal_size(n, file, line, 1);
    EnterCriticalSection(&G.lock);
    b = (LcBlock *)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof *b);
    if (!b || (!guard_carve(b, n) && !canary_carve(b, n))) {
        LeaveCriticalSection(&G.lock);
        fatal_size(n, file, line, 1);
    }
    b->size = n;
    b->afile = file;
    b->aline = line;
    b->state = LC_LIVE;
    b->harness = (unsigned char)harness;
    b->case_idx = G.in_case ? G.case_idx : -1;
    b->seq = ++G.seq;
    b->adepth = (unsigned char)CaptureStackBackTrace(1, LC_DEPTH, b->astack, NULL);
    memset((void *)b->user, zero ? 0 : LC_FILL_NEW, n);
    table_insert(b);
    list_push(&G.live, b);
    if (!harness) stats_on_alloc(n);
    LeaveCriticalSection(&G.lock);
    return (void *)b->user;
}

/* Verifies the guard bytes around a block; a mismatch means the program
 * wrote outside the block at some earlier point. */
static void check_guards(LcBlock *b, const char *file, int line, const char *when)
{
    const unsigned char *p = (const unsigned char *)b->base;
    size_t front = b->user - b->base, i;
    for (i = front; i > 0; i--)
        if (p[i - 1] != LC_FILL_GUARD)
            report_block_fatal("heap_underflow", "Heap buffer underflow", b, file, line,
                "The %zu byte(s) just before this %zu-byte block were overwritten (found %zu byte(s) before its start "
                "when the block was %s). Your code wrote to an index below 0, e.g. arr[-1].",
                front - (i - 1), b->size, front - (i - 1), when);
    if (!b->guarded) {
        const unsigned char *q = (const unsigned char *)(b->user + b->size);
        size_t back = b->base + b->span - (b->user + b->size);
        for (i = 0; i < back; i++)
            if (q[i] != LC_FILL_GUARD)
                report_block_fatal("heap_overflow", "Heap buffer overflow", b, file, line,
                    "Memory right after this %zu-byte block was overwritten (byte %zu past its end; noticed when the "
                    "block was %s). Your code wrote past the end of the allocation.",
                    b->size, i, when);
    }
}

static void quarantine_trim(void)
{
    while (G.quar_blocks > LC_QUAR_MAX_BLOCKS || G.quar_bytes > LC_QUAR_MAX_BYTES) {
        LcBlock *old = G.quar.next;
        if (old == &G.quar) break;
        if (!old->guarded) {
            const unsigned char *p = (const unsigned char *)old->user;
            size_t i;
            for (i = 0; i < old->size; i++)
                if (p[i] != LC_FILL_FREED)
                    report_block_fatal("write_after_free", "Write after free", old, NULL, 0,
                        "Byte %zu of this %zu-byte block was modified after the block had been freed. "
                        "Something kept using a dangling pointer.", i, old->size);
            HeapFree(G.canary_heap, 0, (void *)old->base);
            G.quar_bytes -= old->span;
        }
        list_unlink(old);
        table_remove(old);
        G.quar_blocks--;
        HeapFree(G.meta, 0, old);
    }
}

static void release_block(LcBlock *b, const char *file, int line, int by_realloc)
{
    b->state = LC_FREED;
    b->ffile = file;
    b->fline = line;
    b->by_realloc = (unsigned char)by_realloc;
    b->fdepth = (unsigned char)CaptureStackBackTrace(2, LC_DEPTH, b->fstack, NULL);
    if (!b->harness) {
        G.frees++;
        G.live_bytes -= b->size;
        if (G.in_case) G.case_frees++;
    }
    list_unlink(b);
    if (b->guarded) {
        VirtualFree((void *)b->base, b->span, MEM_DECOMMIT);
        G.committed -= b->span;
    } else {
        memset((void *)b->user, LC_FILL_FREED, b->size);
        G.quar_bytes += b->span;
    }
    list_push(&G.quar, b);
    G.quar_blocks++;
    quarantine_trim();
}

/* ======================================================================
 * Fatal reports
 * ====================================================================== */

LC_NORETURN static void die(void)
{
    TerminateProcess(GetCurrentProcess(), 3);
    ExitProcess(3);
}

static void fatal_head(LcBuf *b, const char *kind, const char *title)
{
    buf_printf(b, "{\"t\":\"fatal\",\"i\":%d,\"kind\":", G.in_case ? G.case_idx : -1);
    buf_json_str(b, kind);
    buf_puts(b, ",\"title\":");
    buf_json_str(b, title);
    if (G.free_ctx) {
        buf_puts(b, ",\"ctx\":");
        buf_json_str(b, G.free_ctx);
    }
}

static void fatal_vmsg(LcBuf *b, const char *fmt, va_list ap)
{
    LcBuf m = { 0 };
    buf_vprintf(&m, fmt, ap);
    buf_puts(b, ",\"msg\":");
    buf_json_str(b, m.p ? m.p : "");
    buf_free(&m);
}

static void buf_site(LcBuf *b, const char *file, int line)
{
    buf_puts(b, "{\"file\":");
    buf_json_str(b, file ? base_name(file) : "");
    buf_printf(b, ",\"line\":%d}", line);
}

static void buf_block(LcBuf *b, LcBlock *blk)
{
    buf_printf(b, ",\"block\":{\"size\":%zu,\"harness\":%d,\"freed\":%d,\"realloc\":%d,\"alloc\":",
               blk->size, blk->harness, blk->state == LC_FREED, blk->by_realloc);
    buf_site(b, blk->afile, blk->aline);
    buf_puts(b, ",\"allocStack\":");
    buf_frames(b, blk->astack, blk->adepth, 0);
    if (blk->state == LC_FREED) {
        buf_puts(b, ",\"free\":");
        buf_site(b, blk->ffile, blk->fline);
        buf_puts(b, ",\"freeStack\":");
        buf_frames(b, blk->fstack, blk->fdepth, 0);
    }
    buf_put(b, "}", 1);
}

LC_NORETURN static void fatal_finish_here(LcBuf *b, const char *file, int line)
{
    void *pcs[LC_MAX_FRAMES];
    int n = (int)CaptureStackBackTrace(1, LC_MAX_FRAMES, pcs, NULL);
    if (file) {
        buf_puts(b, ",\"site\":");
        buf_site(b, file, line);
    }
    buf_puts(b, ",\"frames\":");
    buf_frames(b, pcs, n, 0);
    buf_put(b, "}", 1);
    rec_emit(b);
    die();
}

LC_NORETURN static void report_block_fatal(const char *kind, const char *title, LcBlock *blk,
                               const char *file, int line, const char *fmt, ...)
{
    LcBuf b = { 0 };
    va_list ap;
    InterlockedExchange(&G.crashing, 1);
    fatal_head(&b, kind, title);
    va_start(ap, fmt);
    fatal_vmsg(&b, fmt, ap);
    va_end(ap);
    if (blk) buf_block(&b, blk);
    fatal_finish_here(&b, file, line);
}

LC_NORETURN static void report_fatal(const char *kind, const char *title, const char *file, int line, const char *fmt, ...)
{
    LcBuf b = { 0 };
    va_list ap;
    InterlockedExchange(&G.crashing, 1);
    fatal_head(&b, kind, title);
    va_start(ap, fmt);
    fatal_vmsg(&b, fmt, ap);
    va_end(ap);
    fatal_finish_here(&b, file, line);
}

static void fatal_size(size_t n, const char *file, int line, int is_limit)
{
    if (!is_limit)
        report_fatal("huge_alloc", "Impossible allocation size", file, line,
            "An allocation of %zu bytes was requested. A size this large almost always comes from a negative number "
            "converted to size_t (e.g. malloc(n * sizeof(int)) with n < 0), or from an uninitialized size variable.", n);
    report_fatal("memory_limit", "Memory Limit Exceeded", file, line,
        "Tried to allocate %zu more bytes while %zu bytes were already in use (limit: %zu MB). "
        "Look for allocations inside loops that are never freed, or sizes that grow without bound.",
        n, G.live_bytes, G.limit >> 20);
}

static int is_readable(const void *p, size_t n)
{
    MEMORY_BASIC_INFORMATION mbi;
    if (!VirtualQuery(p, &mbi, sizeof mbi)) return 0;
    if (mbi.State != MEM_COMMIT) return 0;
    if (mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)) return 0;
    return (uintptr_t)p + n <= (uintptr_t)mbi.BaseAddress + mbi.RegionSize;
}

static int is_crt_heap_block(void *p)
{
    int ok = 0;
    if (!is_readable((char *)p - 64, 64)) return 0;
    __try { ok = _CrtIsValidHeapPointer(p); } __except (EXCEPTION_EXECUTE_HANDLER) { ok = 0; }
    return ok;
}

static const char *pattern_note(uintptr_t p)
{
    switch (p >> 48) {
    case 0xCDCD: return " Its value 0xCDCD... is the fill pattern of fresh malloc memory: the pointer was read from an allocated but never-initialized block.";
    case 0xCCCC: return " Its value 0xCCCC... is the fill pattern of uninitialized local variables: the pointer variable was never assigned.";
    case 0xDDDD: return " Its value 0xDDDD... is the fill pattern of freed memory: the pointer was read from a block that had already been freed.";
    case 0xFDFD: return " Its value 0xFDFD... is the guard pattern around blocks: the pointer was read from outside an allocation.";
    }
    return "";
}

LC_NORETURN static void bad_pointer_free(void *ptr, const char *file, int line, const char *fn)
{
    uintptr_t p = (uintptr_t)ptr;
    ULONG_PTR lo = 0, hi = 0;
    HMODULE mod = NULL;
    LcBlock *b = find_block_containing(p);
    if (b && b->state == LC_LIVE)
        report_block_fatal("invalid_free", "Freeing a pointer into the middle of a block", b, file, line,
            "%s() was given a pointer %zu byte(s) into a %zu-byte block. You must pass exactly the pointer that "
            "malloc/calloc/realloc returned (did you move the pointer, e.g. with p++, before freeing it?).",
            fn, (size_t)(p - b->user), b->size);
    if (b)
        report_block_fatal("double_free", "Freeing an already-freed block", b, file, line,
            "%s() was given a pointer into a %zu-byte block that has already been freed.", fn, b->size);
    GetCurrentThreadStackLimits(&lo, &hi);
    if (p >= lo && p < hi)
        report_fatal("invalid_free", "Freeing stack memory", file, line,
            "%s() was given the address of a local variable or array, which lives on the stack. Only memory "
            "returned by malloc/calloc/realloc may be freed; locals disappear automatically when their function returns.", fn);
    if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           (LPCSTR)ptr, &mod))
        report_fatal("invalid_free", "Freeing a global or a string literal", file, line,
            "%s() was given the address of a global/static variable or a string literal. Those exist for the whole "
            "program and must never be freed.", fn);
    report_fatal("invalid_free", "Freeing an invalid pointer", file, line,
        "%s() was given 0x%p, which was never returned by malloc/calloc/realloc. The pointer may be uninitialized "
        "garbage or point to memory that was freed long ago.%s", fn, ptr, pattern_note(p));
}

LC_NORETURN static void report_double_free(LcBlock *b, const char *file, int line, const char *fn)
{
    report_block_fatal("double_free", "Double free", b, file, line,
        "%s() was called on a %zu-byte block that was already %s (line %d). After free(p), p is a dangling pointer: "
        "set it to NULL if it might be freed again, and make sure exactly one owner frees each block.",
        fn, b->size, b->by_realloc ? "released by realloc()" : "freed", b->fline);
}

/* ======================================================================
 * Public allocation API (called through the macros in lc_mem.h)
 * ====================================================================== */

void *lc_malloc(size_t size, const char *file, int line)
{
    return block_alloc(size, 0, file, line, 0);
}

void *lc_calloc(size_t count, size_t size, const char *file, int line)
{
    if (size && count > ((size_t)-1) / size) return NULL;
    return block_alloc(count * size, 1, file, line, 0);
}

static LcBlock *owned_block(void *ptr, const char *file, int line, const char *fn)
{
    LcBlock *b;
    lc_lazy_init();
    b = table_find((uintptr_t)ptr);
    if (!b) bad_pointer_free(ptr, file, line, fn);
    if (b->state == LC_FREED) report_double_free(b, file, line, fn);
    if (b->harness)
        report_block_fatal("invalid_free", "Freeing memory you don't own", b, file, line,
            "%s() was called on an input that belongs to the test harness. Your function may read (and, if the "
            "problem says so, modify) its inputs, but the harness allocated them and will free them itself.", fn);
    return b;
}

void lc_free(void *ptr, const char *file, int line)
{
    LcBlock *b;
    if (!ptr) return;
    lc_lazy_init();
    b = table_find((uintptr_t)ptr);
    if (!b && is_crt_heap_block(ptr)) {   /* memory from a CRT function such as _getcwd(NULL, 0) */
        _free_dbg(ptr, _NORMAL_BLOCK);
        return;
    }
    b = owned_block(ptr, file, line, "free");
    check_guards(b, file, line, "freed");
    EnterCriticalSection(&G.lock);
    release_block(b, file, line, 0);
    LeaveCriticalSection(&G.lock);
}

void *lc_realloc(void *ptr, size_t size, const char *file, int line)
{
    LcBlock *b;
    void *q;
    if (!ptr) return block_alloc(size, 0, file, line, 0);
    b = owned_block(ptr, file, line, "realloc");
    check_guards(b, file, line, "reallocated");
    if (size == 0) {
        EnterCriticalSection(&G.lock);
        release_block(b, file, line, 1);
        LeaveCriticalSection(&G.lock);
        return NULL;
    }
    /* Always move: stale pointers into the old block then fault like they would
     * whenever a real realloc has to relocate the data. */
    q = block_alloc(size, 0, file, line, 0);
    memcpy(q, ptr, b->size < size ? b->size : size);
    EnterCriticalSection(&G.lock);
    release_block(b, file, line, 1);
    LeaveCriticalSection(&G.lock);
    return q;
}

char *lc_strdup(const char *s, const char *file, int line)
{
    size_t n;
    char *d;
    if (!s) report_fatal("null_deref", "strdup(NULL)", file, line, "strdup() was called with a NULL pointer.");
    n = strlen(s) + 1;
    d = (char *)block_alloc(n, 0, file, line, 0);
    memcpy(d, s, n);
    return d;
}

char *lc_strndup(const char *s, size_t n, const char *file, int line)
{
    size_t len = 0;
    char *d;
    if (!s) report_fatal("null_deref", "strndup(NULL)", file, line, "strndup() was called with a NULL pointer.");
    while (len < n && s[len]) len++;
    d = (char *)block_alloc(len + 1, 0, file, line, 0);
    memcpy(d, s, len);
    d[len] = 0;
    return d;
}

/* ======================================================================
 * Crash handling
 * ====================================================================== */

static int unwind(CONTEXT *ctx, void **out, int max)
{
    int n = 0;
    __try {
        while (n < max && ctx->Rip) {
            DWORD64 image = 0;
            PRUNTIME_FUNCTION fe;
            out[n++] = (void *)(uintptr_t)ctx->Rip;
            fe = RtlLookupFunctionEntry(ctx->Rip, &image, NULL);
            if (!fe) {
                /* leaf function or a jump into garbage: the return address is on top of the stack */
                if (!is_readable((void *)(uintptr_t)ctx->Rsp, 8)) break;
                ctx->Rip = *(DWORD64 *)(uintptr_t)ctx->Rsp;
                ctx->Rsp += 8;
            } else {
                PVOID hd;
                DWORD64 est;
                RtlVirtualUnwind(UNW_FLAG_NHANDLER, image, ctx->Rip, fe, ctx, &hd, &est, NULL);
            }
        }
    } __except (EXCEPTION_EXECUTE_HANDLER) {
    }
    return n;
}

static uintptr_t suspicious_register(const CONTEXT *c)
{
    DWORD64 regs[] = { c->Rax, c->Rbx, c->Rcx, c->Rdx, c->Rsi, c->Rdi, c->R8, c->R9,
                       c->R10, c->R11, c->R12, c->R13, c->R14, c->R15 };
    size_t i;
    for (i = 0; i < sizeof regs / sizeof regs[0]; i++) {
        unsigned top = (unsigned)(regs[i] >> 48);
        if (top == 0xCDCD || top == 0xCCCC || top == 0xDDDD || top == 0xFDFD) return (uintptr_t)regs[i];
    }
    return 0;
}

static void describe_access_violation(LcBuf *b, const EXCEPTION_RECORD *er, const CONTEXT *ctx)
{
    ULONG_PTR op = er->NumberParameters >= 2 ? er->ExceptionInformation[0] : 0;
    uintptr_t addr = er->NumberParameters >= 2 ? (uintptr_t)er->ExceptionInformation[1] : 0;
    const char *verb = op == 1 ? "write" : op == 8 ? "execute" : "read";
    LcBlock *blk;

    if (op == 8) {
        if (addr < 0x10000) {
            fatal_head(b, "bad_call", "Calling a NULL function pointer");
            buf_puts(b, ",\"msg\":\"The program called a function through a function pointer that is NULL.\"");
        } else {
            fatal_head(b, "bad_call", "Jumped to an invalid address");
            buf_printf(b, ",\"msg\":\"Execution jumped to 0x%p, which is not code. Causes: calling an uninitialized or "
                          "corrupted function pointer, or a stack buffer overflow that overwrote a return address.\"",
                       (void *)addr);
        }
        buf_printf(b, ",\"access\":\"%s\",\"addr\":\"0x%p\"", verb, (void *)addr);
        return;
    }
    if (addr == (uintptr_t)-1) {
        /* non-canonical address: the CPU reports no address, so look at the registers */
        uintptr_t r = suspicious_register(ctx);
        LcBuf m = { 0 };
        if ((r >> 48) == 0xCDCD || (r >> 48) == 0xCCCC) fatal_head(b, "uninit_pointer", "Using an uninitialized pointer");
        else if ((r >> 48) == 0xDDDD) fatal_head(b, "use_after_free", "Using a pointer read from freed memory");
        else fatal_head(b, "wild_pointer", "Invalid pointer dereference");
        buf_printf(&m, "The program dereferenced an invalid pointer (a garbage address that cannot exist).%s",
                   r ? pattern_note(r) : " The pointer is probably uninitialized or overwritten by garbage.");
        buf_puts(b, ",\"msg\":");
        buf_json_str(b, m.p);
        buf_free(&m);
        buf_printf(b, ",\"access\":\"%s\"", verb);
        return;
    }
    if (addr < 0x10000) {
        LcBuf m = { 0 };
        fatal_head(b, "null_deref", "NULL pointer dereference");
        if (addr == 0)
            buf_printf(&m, "The program tried to %s through a NULL pointer.", verb);
        else
            buf_printf(&m, "The program tried to %s address 0x%p, which is %zu bytes past NULL: it accessed a field or "
                           "element through a NULL pointer (for example node->next when node is NULL).",
                       verb, (void *)addr, (size_t)addr);
        buf_puts(b, ",\"msg\":");
        buf_json_str(b, m.p);
        buf_free(&m);
        buf_printf(b, ",\"access\":\"%s\",\"addr\":\"0x%p\"", verb, (void *)addr);
        return;
    }
    blk = find_block_region(addr);
    if (blk) {
        LcBuf m = { 0 };
        uintptr_t end = blk->user + blk->size;
        if (blk->state == LC_FREED) {
            fatal_head(b, "use_after_free", "Use after free");
            if (addr >= blk->user && addr < end)
                buf_printf(&m, "The program tried to %s byte %zu of a %zu-byte block that was already %s. "
                               "The pointer is dangling: the memory it points to no longer belongs to you.",
                           verb, (size_t)(addr - blk->user), blk->size,
                           blk->by_realloc ? "moved by realloc() (it freed the old block)" : "freed");
            else
                buf_printf(&m, "The program tried to %s memory near a %zu-byte block that was already %s.",
                           verb, blk->size, blk->by_realloc ? "moved by realloc()" : "freed");
        } else if (op == 1 && blk->readonly && addr >= blk->user && addr < end) {
            fatal_head(b, "write_to_const", "Writing to a read-only input");
            buf_printf(&m, "The program wrote byte %zu of an input it must not modify (the parameter is const). "
                           "Make a copy first if you need a modifiable version.", (size_t)(addr - blk->user));
        } else if (addr >= end) {
            fatal_head(b, "heap_overflow", "Heap buffer overflow");
            if (addr == end)
                buf_printf(&m, "The program tried to %s the byte just past the end of a %zu-byte block "
                               "(valid offsets are 0..%zu).", verb, blk->size, blk->size ? blk->size - 1 : 0);
            else
                buf_printf(&m, "The program tried to %s %zu bytes past the end of a %zu-byte block "
                               "(valid offsets are 0..%zu).", verb, (size_t)(addr - end) + 1, blk->size,
                           blk->size ? blk->size - 1 : 0);
            if (blk->size == 0)
                buf_puts(&m, " This block has size 0 (malloc(0)), so no access to it is valid.");
        } else {
            fatal_head(b, "heap_underflow", "Heap buffer underflow");
            buf_printf(&m, "The program tried to %s %zu byte(s) before the start of a %zu-byte block.",
                       verb, (size_t)(blk->user - addr), blk->size);
        }
        buf_puts(b, ",\"msg\":");
        buf_json_str(b, m.p);
        buf_free(&m);
        buf_printf(b, ",\"access\":\"%s\",\"addr\":\"0x%p\"", verb, (void *)addr);
        buf_block(b, blk);
        return;
    }
    {
        LcBuf m = { 0 };
        fatal_head(b, "wild_pointer", "Invalid memory access");
        buf_printf(&m, "The program tried to %s address 0x%p, which does not belong to any live allocation, local or "
                       "global. The pointer is probably uninitialized, computed with wrong pointer arithmetic, or "
                       "points into a block that was freed long ago.%s",
                   verb, (void *)addr, pattern_note(suspicious_register(ctx)));
        buf_puts(b, ",\"msg\":");
        buf_json_str(b, m.p);
        buf_free(&m);
        buf_printf(b, ",\"access\":\"%s\",\"addr\":\"0x%p\"", verb, (void *)addr);
    }
}

static DWORD WINAPI crash_thread(LPVOID unused)
{
    EXCEPTION_RECORD *er = &G.crash_rec;
    CONTEXT ctx = G.crash_ctx;
    void *pcs[64];
    int n;
    LcBuf b = { 0 };
    (void)unused;
    n = unwind(&ctx, pcs, 64);
    switch (er->ExceptionCode) {
    case EXCEPTION_ACCESS_VIOLATION:
    case EXCEPTION_IN_PAGE_ERROR:
        describe_access_violation(&b, er, &G.crash_ctx);
        break;
    case EXCEPTION_STACK_OVERFLOW:
        fatal_head(&b, "stack_overflow", "Stack overflow");
        buf_puts(&b, ",\"msg\":\"The call stack ran out of space (8 MB). This is almost always infinite or too deep "
                     "recursion: check that every recursive call moves toward a base case that is actually reached. "
                     "Huge local arrays (e.g. int big[5000000]) can also overflow the stack; use malloc for those.\"");
        break;
    case EXCEPTION_INT_DIVIDE_BY_ZERO:
        fatal_head(&b, "div_zero", "Integer division by zero");
        buf_puts(&b, ",\"msg\":\"The program divided an integer by zero (or took x % 0).\"");
        break;
    case EXCEPTION_INT_OVERFLOW:
        fatal_head(&b, "int_overflow", "Integer overflow in division");
        buf_puts(&b, ",\"msg\":\"INT_MIN / -1 (or INT_MIN % -1) does not fit in an int.\"");
        break;
    case EXCEPTION_ILLEGAL_INSTRUCTION:
    case EXCEPTION_PRIV_INSTRUCTION:
        fatal_head(&b, "bad_call", "Executed garbage instead of code");
        buf_puts(&b, ",\"msg\":\"The CPU was sent to bytes that are not valid code. This usually means a corrupted "
                     "function pointer or a stack buffer overflow that overwrote a return address.\"");
        break;
    case EXCEPTION_BREAKPOINT:
        fatal_head(&b, "breakpoint", "Breakpoint");
        buf_puts(&b, ",\"msg\":\"The program executed a breakpoint (__debugbreak() or a failed internal check).\"");
        break;
    case 0xC0000374: /* STATUS_HEAP_CORRUPTION */
        fatal_head(&b, "heap_corruption", "Heap corruption");
        buf_puts(&b, ",\"msg\":\"The system heap detected corrupted memory.\"");
        break;
    default:
        fatal_head(&b, "crash", "Crash");
        buf_printf(&b, ",\"msg\":\"The program crashed with exception code 0x%08lX.\"", er->ExceptionCode);
    }
    buf_printf(&b, ",\"code\":%lu,\"frames\":", er->ExceptionCode);
    buf_frames(&b, pcs, n, 1);
    buf_put(&b, "}", 1);
    rec_emit(&b);
    return 0;
}

static int fmt_dec(char *out, long long v)
{
    char tmp[24];
    int n = 0, i = 0;
    unsigned long long u = v < 0 ? (unsigned long long)(-v) : (unsigned long long)v;
    if (v < 0) out[i++] = '-';
    do { tmp[n++] = (char)('0' + u % 10); u /= 10; } while (u);
    while (n) out[i++] = tmp[--n];
    return i;
}

static LONG WINAPI lc_unhandled(EXCEPTION_POINTERS *ep)
{
    HANDLE th;
    if (InterlockedExchange(&G.crashing, 1)) {
        die();
        return EXCEPTION_EXECUTE_HANDLER;
    }
    G.crash_rec = *ep->ExceptionRecord;
    G.crash_ctx = *ep->ContextRecord;
    {
        /* a minimal record first, written without the CRT, in case the full report fails */
        static const char a[] = "{\"t\":\"fatal\",\"early\":1,\"i\":", c[] = ",\"kind\":\"crash\",\"code\":";
        char buf[160];
        int n = 0;
        DWORD w;
        memcpy(buf, a, sizeof a - 1); n += (int)sizeof a - 1;
        n += fmt_dec(buf + n, G.in_case ? G.case_idx : -1);
        memcpy(buf + n, c, sizeof c - 1); n += (int)sizeof c - 1;
        n += fmt_dec(buf + n, (long long)ep->ExceptionRecord->ExceptionCode);
        buf[n++] = '}';
        buf[n++] = '\n';
        WriteFile(G.out != INVALID_HANDLE_VALUE ? G.out : GetStdHandle(STD_ERROR_HANDLE), buf, (DWORD)n, &w, NULL);
    }
    /* the faulting thread may have no stack left: report from a fresh thread */
    th = CreateThread(NULL, 1 << 20, crash_thread, NULL, 0, NULL);
    if (th) WaitForSingleObject(th, 10000);
    die();
    return EXCEPTION_EXECUTE_HANDLER;
}

static int __cdecl lc_rtc_error(int type, const wchar_t *file, int line, const wchar_t *module,
                                const wchar_t *format, ...)
{
    wchar_t w[1024];
    char msg[2048];
    va_list ap;
    const char *kind = "rtc", *title = "Run-time check failure", *text, *hash;
    int check = -1;
    (void)type; (void)file; (void)line; (void)module;
    va_start(ap, format);
    _vsnwprintf(w, 1023, format, ap);
    va_end(ap);
    w[1023] = 0;
    WideCharToMultiByte(CP_UTF8, 0, w, -1, msg, sizeof msg, NULL, NULL);
    /* "Run-Time Check Failure #3 - The variable 'x' is being used without being initialized." */
    text = msg;
    hash = strchr(msg, '#');
    if (hash) {
        check = atoi(hash + 1);
        text = strstr(hash, " - ");
        text = text ? text + 3 : msg;
    }
    switch (check) {
    case _RTC_CORRUPT_STACK:
        kind = "stack_corruption";
        title = "Stack buffer overflow";
        break;
    case _RTC_UNINIT_LOCAL_USE:
        kind = "uninit_var";
        title = "Using an uninitialized variable";
        break;
    case _RTC_CHKSTK:
        kind = "stack_pointer";
        title = "Stack pointer corrupted";
        break;
    case _RTC_CORRUPTED_ALLOCA:
        kind = "stack_corruption";
        title = "Stack buffer overflow (alloca)";
        break;
    }
    report_fatal(kind, title, NULL, 0, "%s", text);
    return 0;
}

static void __cdecl lc_invalid_param(const wchar_t *expr, const wchar_t *func, const wchar_t *file,
                                     unsigned int line, uintptr_t reserved)
{
    char e[512] = "", f[256] = "";
    (void)file; (void)line; (void)reserved;
    if (expr) WideCharToMultiByte(CP_UTF8, 0, expr, -1, e, sizeof e, NULL, NULL);
    if (func) WideCharToMultiByte(CP_UTF8, 0, func, -1, f, sizeof f, NULL, NULL);
    report_fatal("crt_invalid_param", "Invalid argument to a C library function", NULL, 0,
        "%s%s%s rejected one of its arguments%s%s%s. Typical causes: a NULL pointer passed to a function that "
        "needs a real one (fclose(NULL), strlen through a NULL stream...), or a destination buffer that is too small.",
        f[0] ? "The C library function " : "A C library function", f, f[0] ? "()" : "",
        e[0] ? " (the check '" : "", e, e[0] ? "' failed)" : "");
}

static int __cdecl lc_crt_hook(int type, char *message, int *ret)
{
    (void)type; (void)ret;
    if (message) {
        strncpy(G.crt_msg, message, sizeof G.crt_msg - 1);
        G.crt_msg[sizeof G.crt_msg - 1] = 0;
    }
    return FALSE;
}

static void __cdecl lc_on_abort(int sig)
{
    (void)sig;
    if (G.crt_msg[0])
        report_fatal("abort", "abort() was called", NULL, 0,
            "The program stopped itself by calling abort(), usually through a failed assert(). C library message: %s",
            G.crt_msg);
    report_fatal("abort", "abort() was called", NULL, 0,
        "The program stopped itself by calling abort(), usually through a failed assert(). "
        "The assertion message is shown in the stderr output.");
}

/* ======================================================================
 * Startup / shutdown
 * ====================================================================== */

static void leaks_json(LcBuf *b, int only_case, size_t *bytes, int *blocks);

static void check_quarantine_at_exit(void)
{
    LcBlock *x;
    for (x = G.quar.next; x != &G.quar; x = x->next) {
        const unsigned char *p = (const unsigned char *)x->user;
        size_t i;
        if (x->guarded) continue;
        for (i = 0; i < x->size; i++)
            if (p[i] != LC_FILL_FREED)
                report_block_fatal("write_after_free", "Write after free", x, NULL, 0,
                    "Byte %zu of this %zu-byte block was modified after the block had been freed. "
                    "Something kept using a dangling pointer.", i, x->size);
    }
}

static void __cdecl lc_at_exit(void)
{
    LcBuf b = { 0 };
    size_t bytes = 0;
    int blocks = 0;
    if (G.crashing) return;
    check_quarantine_at_exit();
    buf_printf(&b, "{\"t\":\"exit\",\"allocs\":%lld,\"frees\":%lld,\"peak\":%zu,\"leaks\":",
               G.allocs, G.frees, G.peak_bytes);
    leaks_json(&b, G.judge ? -1 : -2, &bytes, &blocks);
    buf_printf(&b, ",\"leakBytes\":%zu,\"leakBlocks\":%d}", bytes, blocks);
    rec_emit(&b);
    buf_free(&b);
}

static void load_input(void)
{
    char path[MAX_PATH * 2];
    DWORD n = GetEnvironmentVariableA("LC_INPUT", path, sizeof path);
    HANDLE h;
    size_t cap = 1 << 16, len = 0;
    char *data;
    if (n && n < sizeof path)
        h = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    else
        h = GetStdHandle(STD_INPUT_HANDLE);
    data = (char *)HeapAlloc(G.meta, 0, cap);
    for (;;) {
        DWORD got = 0;
        if (len + 4096 + 1 > cap) {
            cap *= 2;
            data = (char *)HeapReAlloc(G.meta, 0, data, cap);
        }
        if (h == INVALID_HANDLE_VALUE || !ReadFile(h, data + len, 4096, &got, NULL) || got == 0) break;
        len += got;
    }
    data[len] = 0;
    G.in = data;
    G.in_len = len;
}

static void lc_lazy_init(void)
{
    char buf[MAX_PATH * 2];
    DWORD n;
    char *slash;
    if (G.ready) return;
    G.ready = 1;
    G.meta = HeapCreate(0, 0, 0);
    G.canary_heap = HeapCreate(0, 0, 0);
    G.scratch = HeapCreate(0, 0, 0);
    InitializeCriticalSection(&G.lock);
    list_init(&G.live);
    list_init(&G.quar);
    G.table_bits = 14;
    G.table = (LcBlock **)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof(LcBlock *) << G.table_bits);
    G.limit = (size_t)256 << 20;
    G.case_idx = -1;
    G.out = INVALID_HANDLE_VALUE;
    QueryPerformanceFrequency(&G.freq);

    n = GetEnvironmentVariableA("LC_MEMLIMIT_MB", buf, sizeof buf);
    if (n && n < sizeof buf && atol(buf) > 0) G.limit = (size_t)atol(buf) << 20;
    n = GetEnvironmentVariableA("LC_RESULT", buf, sizeof buf);
    if (n && n < sizeof buf)
        G.out = CreateFileA(buf, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, NULL);
    n = GetEnvironmentVariableA("LC_MODE", buf, sizeof buf);
    G.judge = n && n < sizeof buf && strcmp(buf, "judge") == 0;

    GetModuleFileNameA(NULL, G.exe_dir, MAX_PATH);
    slash = strrchr(G.exe_dir, '\\');
    if (slash) *slash = 0;

    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
    {
        ULONG guarantee = 64 * 1024;
        SetThreadStackGuarantee(&guarantee);
    }
    SetUnhandledExceptionFilter(lc_unhandled);
    _set_invalid_parameter_handler(lc_invalid_param);
    _set_abort_behavior(0, _WRITE_ABORT_MSG | _CALL_REPORTFAULT);
    _set_error_mode(_OUT_TO_STDERR);
    _CrtSetReportMode(_CRT_WARN, _CRTDBG_MODE_FILE);
    _CrtSetReportFile(_CRT_WARN, _CRTDBG_FILE_STDERR);
    _CrtSetReportMode(_CRT_ERROR, _CRTDBG_MODE_FILE);
    _CrtSetReportFile(_CRT_ERROR, _CRTDBG_FILE_STDERR);
    _CrtSetReportMode(_CRT_ASSERT, _CRTDBG_MODE_FILE);
    _CrtSetReportFile(_CRT_ASSERT, _CRTDBG_FILE_STDERR);
    _CrtSetReportHook2(_CRT_RPTHOOK_INSTALL, lc_crt_hook);
    signal(SIGABRT, lc_on_abort);
    _RTC_SetErrorFuncW(lc_rtc_error);
    setvbuf(stdout, NULL, _IONBF, 0);
    atexit(lc_at_exit);
    if (G.judge) load_input();
}

static int __cdecl lc_crt_init(void)
{
    lc_lazy_init();
    return 0;
}

/* The CRT installs its own unhandled-exception filter from .CRT$XCAA, which
 * runs after every .CRT$XI* initializer, so ours is (re)installed from .CRT$XCU. */
static void __cdecl lc_crt_init_late(void)
{
    SetUnhandledExceptionFilter(lc_unhandled);
}

/* Run during C runtime startup, before main(). */
#pragma section(".CRT$XIU", long, read)
#pragma section(".CRT$XCU", long, read)
__declspec(allocate(".CRT$XIU")) int (__cdecl *lc_crt_init_ptr)(void) = lc_crt_init;
__declspec(allocate(".CRT$XCU")) void (__cdecl *lc_crt_init_late_ptr)(void) = lc_crt_init_late;
#pragma comment(linker, "/include:lc_crt_init_ptr")
#pragma comment(linker, "/include:lc_crt_init_late_ptr")

/* ======================================================================
 * Test harness: cases
 * ====================================================================== */

static void leaks_json(LcBuf *b, int only_case, size_t *bytes, int *blocks)
{
    /* only_case >= 0: that case; -1: blocks made outside any case; -2: everything */
    struct { const char *file; int line; size_t bytes; int count; LcBlock *first; } sites[12];
    int nsites = 0, i, more = 0;
    LcBlock *x;
    *bytes = 0;
    *blocks = 0;
    for (x = G.live.next; x != &G.live; x = x->next) {
        if (x->harness) continue;
        if (only_case != -2 && x->case_idx != only_case) continue;
        check_guards(x, NULL, 0, "checked for leaks");
        *bytes += x->size;
        (*blocks)++;
        for (i = 0; i < nsites; i++)
            if (sites[i].line == x->aline && strcmp(sites[i].file, x->afile) == 0) break;
        if (i == nsites) {
            if (nsites == 12) { more++; continue; }
            sites[i].file = x->afile;
            sites[i].line = x->aline;
            sites[i].bytes = 0;
            sites[i].count = 0;
            sites[i].first = x;
            nsites++;
        }
        sites[i].bytes += x->size;
        sites[i].count++;
    }
    buf_put(b, "[", 1);
    for (i = 0; i < nsites; i++) {
        if (i) buf_put(b, ",", 1);
        buf_printf(b, "{\"bytes\":%zu,\"count\":%d,\"site\":", sites[i].bytes, sites[i].count);
        buf_site(b, sites[i].file, sites[i].line);
        buf_puts(b, ",\"frames\":");
        buf_frames(b, sites[i].first->astack, sites[i].first->adepth, 0);
        buf_put(b, "}", 1);
    }
    buf_put(b, "]", 1);
}

static void in_skip_ws(void)
{
    while (G.in_pos < G.in_len && (isspace((unsigned char)G.in[G.in_pos]) || G.in[G.in_pos] == ',')) G.in_pos++;
}

static void free_case_harness_blocks(void)
{
    LcBlock *x = G.live.next;
    while (x != &G.live) {
        LcBlock *nx = x->next;
        if (x->harness && x->case_idx == G.case_idx) {
            check_guards(x, NULL, 0, "released by the harness");
            if (x->readonly) {
                DWORD old;
                VirtualProtect((void *)x->base, x->span, PAGE_READWRITE, &old);
            }
            release_block(x, "<harness>", 0, 0);
        }
        x = nx;
    }
}

int lc_next_case(void)
{
    lc_lazy_init();
    if (G.in_case) lc_end_case();
    in_skip_ws();
    if (G.in_pos >= G.in_len) return 0;
    G.case_idx = G.ncases++;
    G.in_case = 1;
    G.case_allocs = G.case_frees = 0;
    G.case_base = G.live_bytes;
    G.case_peak = 0;
    G.out_json.len = 0;
    if (G.out_json.p) G.out_json.p[0] = 0;
    G.fails.len = 0;
    G.nfails = 0;
    G.out_depth = 0;
    G.out_count[0] = 0;
    fprintf(stdout, "\x01LC%d\x02", G.case_idx);
    QueryPerformanceCounter(&G.t0);
    return 1;
}

void lc_end_case(void)
{
    LARGE_INTEGER t1;
    LcBuf b = { 0 };
    size_t bytes = 0;
    int blocks = 0;
    long long us;
    if (!G.in_case) return;
    QueryPerformanceCounter(&t1);
    us = (t1.QuadPart - G.t0.QuadPart) * 1000000 / G.freq.QuadPart;
    buf_printf(&b, "{\"t\":\"case\",\"i\":%d,\"out\":", G.case_idx);
    buf_json_str(&b, G.out_json.p ? G.out_json.p : "");
    buf_printf(&b, ",\"us\":%lld,\"allocs\":%lld,\"frees\":%lld,\"peak\":%zu,\"leaks\":",
               us, G.case_allocs, G.case_frees, G.case_peak);
    leaks_json(&b, G.case_idx, &bytes, &blocks);
    buf_printf(&b, ",\"leakBytes\":%zu,\"leakBlocks\":%d,\"fails\":[%s]}", bytes, blocks,
               G.fails.p ? G.fails.p : "");
    free_case_harness_blocks();
    G.in_case = 0;
    rec_emit(&b);
    buf_free(&b);
    HeapDestroy(G.scratch);
    G.scratch = HeapCreate(0, 0, 0);
}

int lc_finish(void)
{
    LcBuf b = { 0 };
    if (G.in_case) lc_end_case();
    buf_printf(&b, "{\"t\":\"done\",\"cases\":%d}", G.ncases);
    rec_emit(&b);
    buf_free(&b);
    return 0;
}

void lc_fail(const char *fmt, ...)
{
    LcBuf m = { 0 };
    va_list ap;
    va_start(ap, fmt);
    buf_vprintf(&m, fmt, ap);
    va_end(ap);
    if (G.nfails++) buf_put(&G.fails, ",", 1);
    buf_json_str(&G.fails, m.p ? m.p : "");
    buf_free(&m);
}

void lc_abort_case(const char *title, const char *fmt, ...)
{
    LcBuf b = { 0 };
    va_list ap;
    InterlockedExchange(&G.crashing, 1);
    fatal_head(&b, "harness_check", title);
    va_start(ap, fmt);
    fatal_vmsg(&b, fmt, ap);
    va_end(ap);
    fatal_finish_here(&b, NULL, 0);
}

long long lc_alloc_count(void) { return G.allocs; }
long long lc_free_count(void) { return G.frees; }

long long lc_block_size(const void *p)
{
    LcBlock *b;
    lc_lazy_init();
    b = table_find((uintptr_t)p);
    return b && b->state == LC_LIVE ? (long long)b->size : -1;
}

void lc_free_owned(void *p, const char *what, const char *file, int line)
{
    G.free_ctx = what;
    lc_free(p, file, line);
    G.free_ctx = NULL;
}

/* ======================================================================
 * Test harness: input
 * ====================================================================== */

LC_NORETURN static void bad_input(const char *fmt, ...)
{
    LcBuf b = { 0 };
    va_list ap;
    InterlockedExchange(&G.crashing, 1);
    fatal_head(&b, "bad_input", "Invalid test input");
    va_start(ap, fmt);
    fatal_vmsg(&b, fmt, ap);
    va_end(ap);
    buf_put(&b, "}", 1);
    rec_emit(&b);
    die();
}

static void *scratch_alloc(size_t n)
{
    void *p = HeapAlloc(G.scratch, HEAP_ZERO_MEMORY, n ? n : 1);
    if (!p) TerminateProcess(GetCurrentProcess(), 4);
    return p;
}

static LcJson *json_value(void);

static LcJson *json_string(void)
{
    LcJson *v = (LcJson *)scratch_alloc(sizeof *v);
    LcBuf s = { 0 };
    G.in_pos++; /* opening quote */
    for (;;) {
        char c;
        if (G.in_pos >= G.in_len) bad_input("A string is missing its closing quote.");
        c = G.in[G.in_pos++];
        if (c == '"') break;
        if (c == '\\') {
            char e = G.in_pos < G.in_len ? G.in[G.in_pos++] : 0;
            switch (e) {
            case 'n': c = '\n'; break;
            case 't': c = '\t'; break;
            case 'r': c = '\r'; break;
            case 'b': c = '\b'; break;
            case 'f': c = '\f'; break;
            case '0': c = '\0'; break;
            case 'u': {
                unsigned cp = 0;
                int k;
                for (k = 0; k < 4 && G.in_pos < G.in_len; k++) {
                    char h = G.in[G.in_pos++];
                    cp = cp * 16 + (unsigned)(isdigit((unsigned char)h) ? h - '0' : (tolower((unsigned char)h) - 'a' + 10));
                }
                if (cp < 0x80) { c = (char)cp; break; }
                if (cp < 0x800) {
                    char u[2] = { (char)(0xC0 | (cp >> 6)), (char)(0x80 | (cp & 0x3F)) };
                    buf_put(&s, u, 2);
                } else {
                    char u[3] = { (char)(0xE0 | (cp >> 12)), (char)(0x80 | ((cp >> 6) & 0x3F)), (char)(0x80 | (cp & 0x3F)) };
                    buf_put(&s, u, 3);
                }
                continue;
            }
            default: c = e;
            }
        }
        buf_put(&s, &c, 1);
    }
    v->type = LCJ_STR;
    v->len = (int)s.len;
    v->str = (char *)scratch_alloc(s.len + 1);
    if (s.len) memcpy(v->str, s.p, s.len);
    buf_free(&s);
    return v;
}

static LcJson *json_value(void)
{
    LcJson *v;
    char c;
    in_skip_ws();
    if (G.in_pos >= G.in_len) bad_input("The test case ended too early: a value is missing.");
    c = G.in[G.in_pos];
    if (c == '[') {
        int cap = 0;
        v = (LcJson *)scratch_alloc(sizeof *v);
        v->type = LCJ_ARR;
        G.in_pos++;
        for (;;) {
            while (G.in_pos < G.in_len && isspace((unsigned char)G.in[G.in_pos])) G.in_pos++;
            if (G.in_pos < G.in_len && G.in[G.in_pos] == ']') { G.in_pos++; break; }
            if (v->len == cap) {
                LcJson **ni;
                cap = cap ? cap * 2 : 8;
                ni = (LcJson **)scratch_alloc(sizeof(LcJson *) * (size_t)cap);
                if (v->len) memcpy(ni, v->items, sizeof(LcJson *) * (size_t)v->len);
                v->items = ni;
            }
            v->items[v->len++] = json_value();
            while (G.in_pos < G.in_len && isspace((unsigned char)G.in[G.in_pos])) G.in_pos++;
            if (G.in_pos < G.in_len && G.in[G.in_pos] == ',') { G.in_pos++; continue; }
            if (G.in_pos < G.in_len && G.in[G.in_pos] == ']') { G.in_pos++; break; }
            bad_input("Expected ',' or ']' in an array.");
        }
        return v;
    }
    if (c == '"') return json_string();
    v = (LcJson *)scratch_alloc(sizeof *v);
    if (strncmp(G.in + G.in_pos, "null", 4) == 0) { v->type = LCJ_NULL; G.in_pos += 4; return v; }
    if (strncmp(G.in + G.in_pos, "true", 4) == 0) { v->type = LCJ_BOOL; v->boolean = 1; v->num = 1; v->inum = 1; G.in_pos += 4; return v; }
    if (strncmp(G.in + G.in_pos, "false", 5) == 0) { v->type = LCJ_BOOL; G.in_pos += 5; return v; }
    if (c == '-' || isdigit((unsigned char)c)) {
        char *end;
        const char *start = G.in + G.in_pos;
        v->type = LCJ_NUM;
        v->num = strtod(start, &end);
        v->inum = _strtoi64(start, NULL, 10);
        if (end == start) bad_input("Invalid number.");
        G.in_pos += (size_t)(end - start);
        return v;
    }
    bad_input("Unexpected character '%c' in the test input.", c);
    return NULL;
}

const LcJson *lc_read_json(void)
{
    lc_lazy_init();
    return json_value();
}

static void expect(const LcJson *v, LcJsonType t, const char *what)
{
    if (!v || v->type != t) bad_input("Expected %s in the test input.", what);
}

int lc_json_len(const LcJson *v) { return v && (v->type == LCJ_ARR || v->type == LCJ_STR) ? v->len : 0; }

const LcJson *lc_json_at(const LcJson *v, int i)
{
    if (!v || v->type != LCJ_ARR || i < 0 || i >= v->len) bad_input("Missing array element %d.", i);
    return v->items[i];
}

long long lc_json_ll(const LcJson *v)
{
    if (!v || (v->type != LCJ_NUM && v->type != LCJ_BOOL)) bad_input("Expected a number.");
    return v->inum;
}

int lc_json_int(const LcJson *v) { return (int)lc_json_ll(v); }

const char *lc_json_str(const LcJson *v)
{
    if (v && v->type == LCJ_NULL) return NULL;
    expect(v, LCJ_STR, "a string");
    return v->str;
}

bool lc_json_is_null(const LcJson *v) { return !v || v->type == LCJ_NULL; }

int lc_read_int(void) { return lc_json_int(lc_read_json()); }
long long lc_read_ll(void) { return lc_json_ll(lc_read_json()); }

double lc_read_double(void)
{
    const LcJson *v = lc_read_json();
    expect(v, LCJ_NUM, "a number");
    return v->num;
}

bool lc_read_bool(void)
{
    const LcJson *v = lc_read_json();
    if (v->type == LCJ_NUM) return v->inum != 0;
    expect(v, LCJ_BOOL, "true or false");
    return v->boolean != 0;
}

void *lc_harness_alloc(size_t size) { return block_alloc(size, 0, "<harness>", 0, 1); }

char *lc_harness_str(const LcJson *v)
{
    char *s;
    if (v && v->type == LCJ_NULL) return NULL;
    expect(v, LCJ_STR, "a string");
    s = (char *)lc_harness_alloc((size_t)v->len + 1);
    memcpy(s, v->str, (size_t)v->len + 1);
    return s;
}

int *lc_harness_ints(const LcJson *arr, int *count)
{
    int i, *a;
    expect(arr, LCJ_ARR, "an array of integers");
    a = (int *)lc_harness_alloc((size_t)arr->len * sizeof(int));
    for (i = 0; i < arr->len; i++) a[i] = lc_json_int(arr->items[i]);
    if (count) *count = arr->len;
    return a;
}

char *lc_read_str(void) { return lc_harness_str(lc_read_json()); }
int *lc_read_int_array(int *count) { return lc_harness_ints(lc_read_json(), count); }

char **lc_read_str_array(int *count)
{
    const LcJson *v = lc_read_json();
    char **a;
    int i;
    expect(v, LCJ_ARR, "an array of strings");
    a = (char **)lc_harness_alloc((size_t)v->len * sizeof(char *));
    for (i = 0; i < v->len; i++) a[i] = lc_harness_str(v->items[i]);
    if (count) *count = v->len;
    return a;
}

int **lc_read_int_matrix(int *rows, int **cols)
{
    const LcJson *v = lc_read_json();
    int **m, *c, i;
    expect(v, LCJ_ARR, "a 2D array of integers");
    m = (int **)lc_harness_alloc((size_t)v->len * sizeof(int *));
    c = (int *)lc_harness_alloc((size_t)v->len * sizeof(int));
    for (i = 0; i < v->len; i++) m[i] = lc_harness_ints(v->items[i], &c[i]);
    if (rows) *rows = v->len;
    if (cols) *cols = c;
    return m;
}

void lc_harness_release(void *p)
{
    LcBlock *b = table_find((uintptr_t)p);
    if (!b || !b->harness || b->state != LC_LIVE) return;
    if (b->readonly) {
        DWORD old;
        VirtualProtect((void *)b->base, b->span, PAGE_READWRITE, &old);
    }
    check_guards(b, NULL, 0, "released by the harness");
    EnterCriticalSection(&G.lock);
    release_block(b, "<harness>", 0, 0);
    LeaveCriticalSection(&G.lock);
}

void lc_make_readonly(const void *p)
{
    LcBlock *b = table_find((uintptr_t)p);
    DWORD old;
    if (!b || !b->guarded || b->state != LC_LIVE) return;
    if (VirtualProtect((void *)b->base, b->span, PAGE_READONLY, &old)) b->readonly = 1;
}

/* ======================================================================
 * Test harness: output
 * ====================================================================== */

static void out_sep(void)
{
    if (G.out_count[G.out_depth]++ > 0) buf_put(&G.out_json, ",", 1);
}

void lc_out_int(long long v) { out_sep(); buf_printf(&G.out_json, "%lld", v); }
void lc_out_bool(bool v) { out_sep(); buf_puts(&G.out_json, v ? "true" : "false"); }
void lc_out_null(void) { out_sep(); buf_puts(&G.out_json, "null"); }
void lc_out_str(const char *s) { out_sep(); buf_json_str(&G.out_json, s); }

void lc_out_double(double v, int decimals)
{
    out_sep();
    if (isnan(v) || isinf(v)) buf_puts(&G.out_json, "null");
    else buf_printf(&G.out_json, "%.*f", decimals, v);
}

void lc_out_begin(void)
{
    out_sep();
    buf_put(&G.out_json, "[", 1);
    if (G.out_depth < 63) G.out_count[++G.out_depth] = 0;
}

void lc_out_end(void)
{
    buf_put(&G.out_json, "]", 1);
    if (G.out_depth > 0) G.out_depth--;
}

void lc_out_int_array(const int *a, int n)
{
    int i;
    if (!a && n > 0) { lc_out_null(); return; }
    lc_out_begin();
    for (i = 0; i < n; i++) lc_out_int(a[i]);
    lc_out_end();
}

void lc_out_str_array(char *const *a, int n)
{
    int i;
    if (!a && n > 0) { lc_out_null(); return; }
    lc_out_begin();
    for (i = 0; i < n; i++) lc_out_str(a[i]);
    lc_out_end();
}
