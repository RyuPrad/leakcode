/* lc_trace.c - step-by-step tracing for the memory visualizer.
 *
 * #included at the end of lc_rt.c, whose state it shares. Active when
 * LC_MODE=trace, for complete programs (main.c):
 *
 *  - main() starts with a software breakpoint. From there the CPU's trap flag
 *    makes every instruction of the user's code raise a single-step exception.
 *  - When that code calls anything else (the C library, the allocator), the
 *    callee runs at full speed: a breakpoint on the return address turns
 *    stepping back on when it returns.
 *  - At the first instruction of each source line the active stack frames
 *    (local variables, found and decoded with DbgHelp's type information) and
 *    the heap blocks are written as a "step" record. Pointers are resolved to
 *    the variable or heap block they point into, so the UI can draw arrows.
 */

#define LC_TRACE_MAX_STEPS   1000
#define LC_TRACE_MAX_FRAMES  32
#define LC_TRACE_MAX_VARS    40
#define LC_TRACE_MAX_ITEMS   32
#define LC_TRACE_MAX_BLOCKS  64
#define LC_TRACE_MAX_DEPTH   4
#define LC_TRACE_MAX_FREED   16
#define LC_CV_RBP            334
#define LC_CV_RSP            335
#define LC_TRAP_FLAG         0x100

/* DbgHelp symbol tags and basic types (cvconst.h) */
enum { LC_TAG_DATA = 7, LC_TAG_UDT = 11, LC_TAG_ENUM = 12, LC_TAG_FUNCTION_TYPE = 13, LC_TAG_POINTER = 14,
       LC_TAG_ARRAY = 15, LC_TAG_BASE = 16, LC_TAG_TYPEDEF = 17 };
enum { LC_BT_VOID = 1, LC_BT_CHAR = 2, LC_BT_WCHAR = 3, LC_BT_INT = 6, LC_BT_UINT = 7, LC_BT_FLOAT = 8,
       LC_BT_BOOL = 10, LC_BT_LONG = 13, LC_BT_ULONG = 14 };

typedef struct { uintptr_t addr; int line; unsigned char used, user, start, entry; } LcCode;

typedef struct { char name[48]; DWORD type; ULONG64 mod; ULONG flags, reg; LONG64 off; } LcVarDesc;
typedef struct { uintptr_t pc; int nvars; LcVarDesc vars[LC_TRACE_MAX_VARS]; } LcScope;

typedef struct { char name[48]; DWORD offset, type; } LcField;
typedef struct {
    DWORD id;
    ULONG64 mod;
    int used;
    DWORD tag, base, inner, count;
    ULONG64 len;
    int nfields;
    LcField *fields;
    char name[96];
} LcType;

typedef struct { const LcVarDesc *d; uintptr_t addr; ULONG64 size; } LcVar;
typedef struct { char fn[96]; int line, nvars; LcVar vars[LC_TRACE_MAX_VARS]; } LcFrameSnap;
typedef struct { LcBlock *b; DWORD type; ULONG64 mod; int hinted, done; LcBuf json; } LcBlockSnap;
typedef struct {
    int nframes, nblocks;
    LcFrameSnap frames[LC_TRACE_MAX_FRAMES];
    LcBlockSnap blocks[LC_TRACE_MAX_BLOCKS];
} LcSnap;

#define LC_SCOPE_SLOTS 1024
#define LC_TYPE_SLOTS  4096

static struct {
    int armed, on, steps;
    uintptr_t main_addr, bp_addr;
    uintptr_t fresh_rsp;             /* stack pointer at the entry of a call not yet recorded */
    unsigned char main_byte, bp_byte;
    LcCode *code;                    /* direct-mapped cache, 1 << 16 slots */
    LcScope **scopes;                /* open addressing, never evicted */
    LcType *types;                   /* open addressing, never evicted */
    LcBuf events;
    int nevents, nfreed;
    LcBlock *freed[LC_TRACE_MAX_FREED];
} T;

static void trace_record(CONTEXT *c, int line, int final);

/* ---------------------------------------------------------------- code */

static int trace_in_prologue(uintptr_t a)
{
    DWORD64 base = 0;
    PRUNTIME_FUNCTION fe = RtlLookupFunctionEntry(a, &base, NULL);
    const unsigned char *ui;
    if (!fe) return 0;
    ui = (const unsigned char *)(uintptr_t)(base + fe->UnwindData);
    return a - (uintptr_t)(base + fe->BeginAddress) < ui[1];   /* UNWIND_INFO.SizeOfProlog */
}

static int trace_is_entry(uintptr_t a)
{
    DWORD64 base = 0;
    PRUNTIME_FUNCTION fe = RtlLookupFunctionEntry(a, &base, NULL);
    return fe && (uintptr_t)(base + fe->BeginAddress) == a;
}

/* Line information for a code address: is it in main.c, is it the first
 * instruction of a source line (outside the function prologue), and is it
 * the first instruction of a function? */
static LcCode trace_code(uintptr_t a)
{
    LcCode *e = &T.code[(size_t)(((uint64_t)a * 0x9E3779B97F4A7C15ull) >> 48)];
    IMAGEHLP_LINE64 ln;
    DWORD disp = 0;
    if (e->used && e->addr == a) return *e;
    memset(e, 0, sizeof *e);
    e->used = 1;
    e->addr = a;
    memset(&ln, 0, sizeof ln);
    ln.SizeOfStruct = sizeof ln;
    if (SymGetLineFromAddr64(GetCurrentProcess(), a, &disp, &ln) &&
        _stricmp(base_name(ln.FileName), "main.c") == 0 && classify_file(ln.FileName) == K_USER) {
        e->user = 1;
        e->line = (int)ln.LineNumber;
        e->start = disp == 0 && !trace_in_prologue(a);
        e->entry = (unsigned char)trace_is_entry(a);
    }
    return *e;
}

/* ---------------------------------------------------------------- types */

static void trace_wide(const WCHAR *w, char *out, size_t n)
{
    out[0] = 0;
    if (w) WideCharToMultiByte(CP_UTF8, 0, w, -1, out, (int)n, NULL, NULL);
    out[n - 1] = 0;
}

static int trace_symname(ULONG64 mod, DWORD id, char *out, size_t n)
{
    WCHAR *w = NULL;
    out[0] = 0;
    if (!SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_SYMNAME, &w) || !w) return 0;
    trace_wide(w, out, n);
    LocalFree(w);
    return 1;
}

static const char *trace_base_name(DWORD base, ULONG64 len)
{
    switch (base) {
    case LC_BT_VOID: return "void";
    case LC_BT_CHAR: return "char";
    case LC_BT_WCHAR: return "wchar_t";
    case LC_BT_BOOL: return "bool";
    case LC_BT_FLOAT: return len == 4 ? "float" : "double";
    case LC_BT_LONG: return "long";
    case LC_BT_ULONG: return "unsigned long";
    case LC_BT_INT: return len == 1 ? "signed char" : len == 2 ? "short" : len == 8 ? "long long" : "int";
    case LC_BT_UINT: return len == 1 ? "unsigned char" : len == 2 ? "unsigned short" : len == 8 ? "unsigned long long" : "unsigned int";
    }
    return "?";
}

static DWORD trace_resolve_typedefs(ULONG64 mod, DWORD id, DWORD *tag)
{
    int guard;
    *tag = 0;
    for (guard = 0; guard < 8; guard++) {
        if (!SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_SYMTAG, tag) || *tag != LC_TAG_TYPEDEF) break;
        if (!SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_TYPEID, &id)) break;
    }
    return id;
}

static LcType *trace_type(ULONG64 mod, DWORD id);

/* The C spelling of a type, keeping typedef names such as size_t or Node. */
static void trace_type_name(ULONG64 mod, DWORD id, char *out, size_t n)
{
    DWORD tag = 0;
    if (SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_SYMTAG, &tag) && tag == LC_TAG_TYPEDEF &&
        trace_symname(mod, id, out, n))
        return;
    strncpy(out, trace_type(mod, id)->name, n - 1);
    out[n - 1] = 0;
}

static LcType *trace_type(ULONG64 mod, DWORD id)
{
    static LcType unknown = { 0, 0, 1, 0, 0, 0, 0, 0, 0, NULL, "?" };
    DWORD tag;
    size_t slot, probe;
    LcType tmp, *t;
    id = trace_resolve_typedefs(mod, id, &tag);
    slot = (size_t)((id * 2654435761u) % LC_TYPE_SLOTS);
    for (probe = 0; probe < LC_TYPE_SLOTS; probe++) {
        t = &T.types[(slot + probe) % LC_TYPE_SLOTS];
        if (!t->used) break;
        if (t->id == id && t->mod == mod) return t;
    }
    if (probe == LC_TYPE_SLOTS) return &unknown;

    memset(&tmp, 0, sizeof tmp);
    tmp.id = id;
    tmp.mod = mod;
    tmp.tag = tag;
    SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_LENGTH, &tmp.len);
    strcpy(tmp.name, "?");
    switch (tag) {
    case LC_TAG_BASE:
        SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_BASETYPE, &tmp.base);
        strcpy(tmp.name, trace_base_name(tmp.base, tmp.len));
        break;
    case LC_TAG_POINTER: {
        char inner[80];
        SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_TYPEID, &tmp.inner);
        trace_type_name(mod, tmp.inner, inner, sizeof inner);
        snprintf(tmp.name, sizeof tmp.name, "%s%s*", inner, inner[strlen(inner) - 1] == '*' ? "" : " ");
        break;
    }
    case LC_TAG_ARRAY: {
        char inner[80];
        SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_TYPEID, &tmp.inner);
        SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_COUNT, &tmp.count);
        trace_type_name(mod, tmp.inner, inner, sizeof inner);
        snprintf(tmp.name, sizeof tmp.name, "%s[%lu]", inner, tmp.count);
        break;
    }
    case LC_TAG_UDT: {
        char nm[64];
        DWORD n = 0, i, kind = 0;
        TI_FINDCHILDREN_PARAMS *kids;
        trace_symname(mod, id, nm, sizeof nm);
        SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_UDTKIND, &kind);
        if (!nm[0] || nm[0] == '<') snprintf(tmp.name, sizeof tmp.name, "%s", kind == 2 ? "union" : "struct");
        else snprintf(tmp.name, sizeof tmp.name, "%s %s", kind == 2 ? "union" : "struct", nm);
        SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_GET_CHILDRENCOUNT, &n);
        if (n > 64) n = 64;
        kids = n ? (TI_FINDCHILDREN_PARAMS *)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof(*kids) + n * sizeof(ULONG)) : NULL;
        if (kids) {
            kids->Count = n;
            if (SymGetTypeInfo(GetCurrentProcess(), mod, id, TI_FINDCHILDREN, kids)) {
                tmp.fields = (LcField *)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof(LcField) * n);
                for (i = 0; tmp.fields && i < n; i++) {
                    DWORD ctag = 0;
                    LcField *f = &tmp.fields[tmp.nfields];
                    SymGetTypeInfo(GetCurrentProcess(), mod, kids->ChildId[i], TI_GET_SYMTAG, &ctag);
                    if (ctag != LC_TAG_DATA) continue;
                    trace_symname(mod, kids->ChildId[i], f->name, sizeof f->name);
                    SymGetTypeInfo(GetCurrentProcess(), mod, kids->ChildId[i], TI_GET_OFFSET, &f->offset);
                    SymGetTypeInfo(GetCurrentProcess(), mod, kids->ChildId[i], TI_GET_TYPEID, &f->type);
                    tmp.nfields++;
                }
            }
            HeapFree(G.meta, 0, kids);
        }
        break;
    }
    case LC_TAG_ENUM: {
        char nm[64];
        trace_symname(mod, id, nm, sizeof nm);
        snprintf(tmp.name, sizeof tmp.name, "enum %s", nm);
        break;
    }
    case LC_TAG_FUNCTION_TYPE:
        strcpy(tmp.name, "function");
        break;
    }
    /* the slot may have been taken while the inner types were resolved */
    for (probe = 0; probe < LC_TYPE_SLOTS; probe++) {
        t = &T.types[(slot + probe) % LC_TYPE_SLOTS];
        if (!t->used) break;
        if (t->id == id && t->mod == mod) return t;
    }
    if (probe == LC_TYPE_SLOTS) return &unknown;
    *t = tmp;
    t->used = 1;
    return t;
}

/* ---------------------------------------------------------------- scopes */

static BOOL CALLBACK trace_enum_var(PSYMBOL_INFO si, ULONG size, PVOID ctx)
{
    LcScope *sc = (LcScope *)ctx;
    LcVarDesc *v;
    (void)size;
    if (!(si->Flags & (SYMFLAG_LOCAL | SYMFLAG_PARAMETER))) return TRUE;
    if (si->Name[0] == '_' && si->Name[1] == '_') return TRUE;     /* compiler temporaries */
    if (sc->nvars >= LC_TRACE_MAX_VARS) return FALSE;
    v = &sc->vars[sc->nvars++];
    strncpy(v->name, si->Name, sizeof v->name - 1);
    v->type = si->TypeIndex;
    v->mod = si->ModBase;
    v->flags = si->Flags;
    v->reg = si->Register;
    v->off = (LONG64)si->Address;
    return TRUE;
}

/* The parameters and locals visible at a code address (cached). */
static LcScope *trace_scope(uintptr_t pc)
{
    static LcScope empty;
    size_t slot = (size_t)(((uint64_t)pc * 0x9E3779B97F4A7C15ull) >> 54), probe;
    LcScope *sc;
    IMAGEHLP_STACK_FRAME sf;
    LcVarDesc tmp[LC_TRACE_MAX_VARS];
    int i, n = 0;
    for (probe = 0; probe < LC_SCOPE_SLOTS; probe++) {
        LcScope *s = T.scopes[(slot + probe) % LC_SCOPE_SLOTS];
        if (!s) break;
        if (s->pc == pc) return s;
    }
    if (probe == LC_SCOPE_SLOTS) return &empty;
    sc = (LcScope *)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof *sc);
    if (!sc) return &empty;
    sc->pc = pc;
    memset(&sf, 0, sizeof sf);
    sf.InstructionOffset = pc;
    SymSetContext(GetCurrentProcess(), &sf, NULL);
    SymEnumSymbols(GetCurrentProcess(), 0, NULL, trace_enum_var, sc);
    /* parameters first, then locals in declaration order (DbgHelp lists locals
       innermost block first, each block in reverse order) */
    for (i = 0; i < sc->nvars; i++) if (sc->vars[i].flags & SYMFLAG_PARAMETER) tmp[n++] = sc->vars[i];
    for (i = sc->nvars - 1; i >= 0; i--) if (!(sc->vars[i].flags & SYMFLAG_PARAMETER)) tmp[n++] = sc->vars[i];
    memcpy(sc->vars, tmp, sizeof(LcVarDesc) * (size_t)n);
    T.scopes[(slot + probe) % LC_SCOPE_SLOTS] = sc;
    return sc;
}

/* ---------------------------------------------------------------- values */

static int trace_snap_block(LcSnap *s, LcBlock *b)
{
    int i;
    for (i = 0; i < s->nblocks; i++)
        if (s->blocks[i].b == b) return i;
    if (s->nblocks == LC_TRACE_MAX_BLOCKS) return -1;
    s->blocks[s->nblocks].b = b;
    return s->nblocks++;
}

static void trace_value(LcSnap *s, LcBuf *b, uintptr_t addr, ULONG64 mod, DWORD type, int depth);

static int trace_garbage(const unsigned char *p, ULONG64 n)
{
    ULONG64 i;
    if (n == 0 || (p[0] != 0xCC && p[0] != 0xCD)) return 0;
    for (i = 1; i < n; i++)
        if (p[i] != p[0]) return 0;
    return p[0] == 0xCD ? 2 : 1;   /* 2: fresh malloc memory, 1: uninitialized local */
}

static void trace_base(LcBuf *b, const unsigned char *p, const LcType *t)
{
    int g = trace_garbage(p, t->len);
    if (g) {
        buf_printf(b, "{\"k\":\"g\",\"g\":%d}", g);
        return;
    }
    switch (t->base) {
    case LC_BT_CHAR:
        buf_printf(b, "{\"k\":\"char\",\"c\":%d}", (int)*(const signed char *)p);
        return;
    case LC_BT_BOOL:
        buf_printf(b, "{\"k\":\"bool\",\"v\":%s}", *p ? "true" : "false");
        return;
    case LC_BT_FLOAT: {
        double d = t->len == 4 ? (double)*(const float *)p : *(const double *)p;
        if (isnan(d) || isinf(d)) buf_printf(b, "{\"k\":\"num\",\"v\":\"%s\"}", isnan(d) ? "nan" : d > 0 ? "inf" : "-inf");
        else buf_printf(b, "{\"k\":\"num\",\"v\":\"%.6g\"}", d);
        return;
    }
    case LC_BT_UINT:
    case LC_BT_ULONG: {
        unsigned long long u = t->len == 1 ? *p : t->len == 2 ? *(const unsigned short *)p
                             : t->len == 8 ? *(const unsigned long long *)p : *(const unsigned int *)p;
        buf_printf(b, "{\"k\":\"int\",\"v\":\"%llu\"}", u);
        return;
    }
    default: {
        long long v = t->len == 1 ? *(const signed char *)p : t->len == 2 ? *(const short *)p
                    : t->len == 8 ? *(const long long *)p : *(const int *)p;
        buf_printf(b, "{\"k\":\"int\",\"v\":\"%lld\"}", v);
    }
    }
}

static void trace_pointer(LcSnap *s, LcBuf *b, uintptr_t p, ULONG64 mod, DWORD pointee)
{
    LcType *pt = trace_type(mod, pointee);
    int fi, vi, i;
    buf_printf(b, "{\"k\":\"ptr\",\"v\":\"0x%llx\",\"to\":", (unsigned long long)p);
    if (p == 0) {
        buf_puts(b, "{\"null\":1}}");
        return;
    }
    switch (p >> 48) {
    case 0xCCCC: case 0xCDCD: case 0xDDDD: case 0xFDFD:
        buf_printf(b, "{\"garbage\":%d}}", (int)((p >> 48) & 0xFF));
        return;
    }
    /* a heap block (also one past its end) */
    for (i = 0; i < s->nblocks; i++) {
        LcBlock *blk = s->blocks[i].b;
        if (p >= blk->user && p <= blk->user + blk->size) break;
    }
    if (i == s->nblocks) {
        LcBlock *blk = find_block_containing(p);
        if (blk && !blk->harness) i = trace_snap_block(s, blk);
        else i = -1;
    }
    if (i >= 0 && i < s->nblocks) {
        LcBlockSnap *bs = &s->blocks[i];
        size_t off = (size_t)(p - bs->b->user);
        if (bs->b->state == LC_LIVE && !bs->hinted && pt->len && off % pt->len == 0 &&
            pt->tag != LC_TAG_FUNCTION_TYPE && !(pt->tag == LC_TAG_BASE && pt->base == LC_BT_VOID)) {
            bs->type = bs->b->ttype = pt->id;
            bs->mod = bs->b->tmod = mod;
            bs->hinted = 1;
        }
        buf_printf(b, "{\"h\":%lld,\"o\":%zu%s}}", bs->b->seq, off, bs->b->state == LC_FREED ? ",\"freed\":1" : "");
        return;
    }
    /* a variable on the stack */
    for (fi = 0; fi < s->nframes; fi++)
        for (vi = 0; vi < s->frames[fi].nvars; vi++) {
            LcVar *v = &s->frames[fi].vars[vi];
            if (p >= v->addr && p <= v->addr + v->size && v->size) {
                buf_printf(b, "{\"f\":%d,\"v\":%d,\"o\":%zu}}", fi, vi, (size_t)(p - v->addr));
                return;
            }
        }
    /* a string literal, a global or a function in the program image */
    {
        HMODULE m = NULL;
        if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                               (LPCSTR)p, &m) && is_readable((void *)p, 1)) {
            if (pt->tag == LC_TAG_FUNCTION_TYPE) {
                LcFrame f;
                sym_frame((void *)p, 0, &f);
                buf_puts(b, "{\"fn\":");
                buf_json_str(b, f.fn);
                buf_puts(b, "}}");
                return;
            }
            if (pt->tag == LC_TAG_BASE && pt->base == LC_BT_CHAR) {
                char lit[84];
                size_t k = 0;
                while (k < 80 && is_readable((const char *)p + k, 1) && ((const char *)p)[k]) {
                    lit[k] = ((const char *)p)[k];
                    k++;
                }
                lit[k] = 0;
                buf_puts(b, "{\"lit\":");
                buf_json_str(b, lit);
                buf_puts(b, "}}");
                return;
            }
            buf_puts(b, "{\"static\":1}}");
            return;
        }
    }
    buf_puts(b, "{\"bad\":1}}");
}

static void trace_array(LcSnap *s, LcBuf *b, uintptr_t addr, ULONG64 mod, DWORD elem, ULONG64 count, int depth)
{
    LcType *et = trace_type(mod, elem);
    ULONG64 i, shown = count < LC_TRACE_MAX_ITEMS ? count : LC_TRACE_MAX_ITEMS;
    char en[80];
    trace_type_name(mod, elem, en, sizeof en);
    buf_puts(b, "{\"k\":\"arr\",\"t\":");
    buf_json_str(b, en);
    buf_printf(b, ",\"es\":%llu,\"n\":%llu,\"items\":[", et->len, count);
    for (i = 0; i < shown; i++) {
        if (i) buf_put(b, ",", 1);
        trace_value(s, b, addr + (uintptr_t)(i * et->len), mod, elem, depth + 1);
    }
    buf_put(b, "]", 1);
    if (et->tag == LC_TAG_BASE && et->base == LC_BT_CHAR) {   /* also as a string */
        char str[LC_TRACE_MAX_ITEMS * 2 + 1];
        ULONG64 k = 0;
        while (k < shown && ((const char *)addr)[k] && !trace_garbage((const unsigned char *)addr + k, 1)) {
            str[k] = ((const char *)addr)[k];
            k++;
        }
        str[k] = 0;
        buf_puts(b, ",\"s\":");
        buf_json_str(b, str);
        buf_printf(b, ",\"term\":%d", k < shown && ((const char *)addr)[k] == 0);
    }
    buf_put(b, "}", 1);
}

static void trace_value(LcSnap *s, LcBuf *b, uintptr_t addr, ULONG64 mod, DWORD type, int depth)
{
    LcType *t = trace_type(mod, type);
    int i;
    if (depth > LC_TRACE_MAX_DEPTH) {
        buf_puts(b, "{\"k\":\"more\"}");
        return;
    }
    switch (t->tag) {
    case LC_TAG_BASE:
    case LC_TAG_ENUM:
        if (t->tag == LC_TAG_ENUM) {
            LcType copy = *t;
            copy.base = LC_BT_INT;
            trace_base(b, (const unsigned char *)addr, &copy);
        } else {
            trace_base(b, (const unsigned char *)addr, t);
        }
        return;
    case LC_TAG_POINTER: {
        uintptr_t p = *(const uintptr_t *)addr;
        if (trace_garbage((const unsigned char *)addr, 8)) {
            buf_printf(b, "{\"k\":\"ptr\",\"to\":{\"garbage\":%d}}", trace_garbage((const unsigned char *)addr, 8));
            return;
        }
        trace_pointer(s, b, p, mod, t->inner);
        return;
    }
    case LC_TAG_ARRAY:
        trace_array(s, b, addr, mod, t->inner, t->count, depth);
        return;
    case LC_TAG_UDT:
        buf_puts(b, "{\"k\":\"struct\",\"t\":");
        buf_json_str(b, t->name);
        buf_puts(b, ",\"f\":[");
        for (i = 0; i < t->nfields; i++) {
            char tn[80];
            if (i) buf_put(b, ",", 1);
            trace_type_name(mod, t->fields[i].type, tn, sizeof tn);
            buf_puts(b, "{\"n\":");
            buf_json_str(b, t->fields[i].name);
            buf_puts(b, ",\"t\":");
            buf_json_str(b, tn);
            buf_puts(b, ",\"v\":");
            trace_value(s, b, addr + t->fields[i].offset, mod, t->fields[i].type, depth + 1);
            buf_put(b, "}", 1);
        }
        buf_puts(b, "]}");
        return;
    }
    buf_puts(b, "{\"k\":\"?\"}");
}

/* ---------------------------------------------------------------- snapshot */

static void trace_frames(LcSnap *s, const CONTEXT *c)
{
    struct { uintptr_t pc, rsp, rbp; int top; } raw[LC_TRACE_MAX_FRAMES];
    CONTEXT ctx = *c;
    int n = 0, i, top = 1;
    while (n < LC_TRACE_MAX_FRAMES) {
        uintptr_t pc = (uintptr_t)ctx.Rip;
        DWORD64 image = 0;
        PRUNTIME_FUNCTION fe;
        PVOID hd;
        DWORD64 est;
        if (!trace_code(top ? pc : pc - 1).user) break;
        raw[n].pc = pc;
        raw[n].rsp = (uintptr_t)ctx.Rsp;
        raw[n].rbp = (uintptr_t)ctx.Rbp;
        raw[n].top = top;
        n++;
        fe = RtlLookupFunctionEntry(ctx.Rip, &image, NULL);
        if (!fe) break;
        RtlVirtualUnwind(UNW_FLAG_NHANDLER, image, ctx.Rip, fe, &ctx, &hd, &est, NULL);
        top = 0;
    }
    /* outermost (main) first */
    for (i = 0; i < n; i++) {
        int k = n - 1 - i, vi;
        uintptr_t look = raw[k].top ? raw[k].pc : raw[k].pc - 1;
        LcScope *sc = trace_scope(look);
        LcFrameSnap *f = &s->frames[s->nframes++];
        LcFrame sym;
        sym_frame((void *)raw[k].pc, !raw[k].top, &sym);
        strncpy(f->fn, sym.fn, sizeof f->fn - 1);
        f->line = trace_code(look).line;
        for (vi = 0; vi < sc->nvars; vi++) {
            const LcVarDesc *d = &sc->vars[vi];
            LcVar *v = &f->vars[f->nvars];
            if (d->flags & SYMFLAG_REGREL)
                v->addr = (d->reg == LC_CV_RBP ? raw[k].rbp : raw[k].rsp) + (uintptr_t)d->off;
            else if (d->flags & SYMFLAG_FRAMEREL)
                v->addr = raw[k].rsp + (uintptr_t)d->off;
            else if (d->flags & SYMFLAG_REGISTER)
                continue;                                    /* lives in a register: not addressable */
            else
                v->addr = (uintptr_t)d->off;                 /* static local */
            v->d = d;
            v->size = trace_type(d->mod, d->type)->len;
            f->nvars++;
        }
    }
}

/* MSVC fills a new stack frame with 0xCC (/RTCs) only when it holds arrays or
 * variables whose address is taken; other calls start with whatever an
 * earlier call left on the stack. Fill the locals of a call that has just
 * started the same way, so a variable without a value always shows as one.
 * Only the frame itself, between the stack pointer and the return address,
 * is written. */
static void trace_poison_locals(const LcFrameSnap *f, uintptr_t lo, uintptr_t hi)
{
    int i;
    for (i = 0; i < f->nvars; i++) {
        const LcVar *v = &f->vars[i];
        if (v->d->flags & SYMFLAG_PARAMETER) continue;
        if (!(v->d->flags & (SYMFLAG_REGREL | SYMFLAG_FRAMEREL))) continue;
        if (v->size && v->addr >= lo && v->addr + v->size <= hi)
            memset((void *)v->addr, 0xCC, (size_t)v->size);
    }
}

static void trace_emit_frames(LcSnap *s, LcBuf *b)
{
    int fi, vi;
    for (fi = 0; fi < s->nframes; fi++) {
        LcFrameSnap *f = &s->frames[fi];
        if (fi) buf_put(b, ",", 1);
        buf_puts(b, "{\"fn\":");
        buf_json_str(b, f->fn);
        buf_printf(b, ",\"line\":%d,\"vars\":[", f->line);
        for (vi = 0; vi < f->nvars; vi++) {
            LcVar *v = &f->vars[vi];
            char tn[96];
            if (vi) buf_put(b, ",", 1);
            trace_type_name(v->d->mod, v->d->type, tn, sizeof tn);
            buf_puts(b, "{\"n\":");
            buf_json_str(b, v->d->name);
            buf_puts(b, ",\"t\":");
            buf_json_str(b, tn);
            buf_printf(b, ",\"a\":\"0x%llx\",\"p\":%d,\"v\":", (unsigned long long)v->addr,
                       (v->d->flags & SYMFLAG_PARAMETER) != 0);
            trace_value(s, b, v->addr, v->d->mod, v->d->type, 0);
            buf_put(b, "}", 1);
        }
        buf_puts(b, "]}");
    }
}

static void trace_block_value(LcSnap *s, LcBlockSnap *bs)
{
    LcBlock *blk = bs->b;
    LcBuf *b = &bs->json;
    buf_printf(b, "{\"id\":%lld,\"size\":%zu,\"line\":%d", blk->seq, blk->size, blk->aline);
    if (blk->state == LC_FREED) {
        buf_printf(b, ",\"freed\":1,\"fline\":%d,\"realloc\":%d}", blk->fline, blk->by_realloc);
        return;
    }
    if (bs->hinted) {
        LcType *t = trace_type(bs->mod, bs->type);
        ULONG64 count = t->len ? blk->size / t->len : 0;
        char tn[96];
        trace_type_name(bs->mod, bs->type, tn, sizeof tn);
        buf_puts(b, ",\"t\":");
        buf_json_str(b, tn);
        buf_puts(b, ",\"v\":");
        if (count == 1 && blk->size == t->len) trace_value(s, b, blk->user, bs->mod, bs->type, 0);
        else trace_array(s, b, blk->user, bs->mod, bs->type, count, 0);
    } else {
        /* nothing typed points here: show the raw bytes */
        const unsigned char *p = (const unsigned char *)blk->user;
        size_t i, shown = blk->size < LC_TRACE_MAX_ITEMS ? blk->size : LC_TRACE_MAX_ITEMS;
        buf_printf(b, ",\"v\":{\"k\":\"bytes\",\"n\":%zu,\"items\":[", blk->size);
        for (i = 0; i < shown; i++) buf_printf(b, "%s%d", i ? "," : "", p[i]);
        buf_puts(b, "]}");
    }
    buf_put(b, "}", 1);
}

static void trace_emit_heap(LcSnap *s, LcBuf *b)
{
    int i, j, progress = 1, order[LC_TRACE_MAX_BLOCKS];
    /* typed blocks first: decoding them can reveal the types of more blocks */
    while (progress) {
        progress = 0;
        for (i = 0; i < s->nblocks; i++)
            if (s->blocks[i].hinted && !s->blocks[i].done) {
                s->blocks[i].done = 1;
                trace_block_value(s, &s->blocks[i]);
                progress = 1;
            }
        /* no pointer leads to a block any more (a leak): keep its last type */
        if (!progress)
            for (i = 0; i < s->nblocks; i++) {
                LcBlockSnap *bs = &s->blocks[i];
                if (!bs->done && !bs->hinted && bs->b->ttype && bs->b->state == LC_LIVE) {
                    bs->type = bs->b->ttype;
                    bs->mod = bs->b->tmod;
                    bs->hinted = 1;
                    progress = 1;
                }
            }
    }
    for (i = 0; i < s->nblocks; i++)
        if (!s->blocks[i].done) {
            s->blocks[i].done = 1;
            trace_block_value(s, &s->blocks[i]);
        }
    for (i = 0; i < s->nblocks; i++) order[i] = i;
    for (i = 1; i < s->nblocks; i++)            /* allocation order */
        for (j = i; j > 0 && s->blocks[order[j - 1]].b->seq > s->blocks[order[j]].b->seq; j--) {
            int tmp = order[j];
            order[j] = order[j - 1];
            order[j - 1] = tmp;
        }
    for (i = 0; i < s->nblocks; i++) {
        if (i) buf_put(b, ",", 1);
        buf_put(b, s->blocks[order[i]].json.p, s->blocks[order[i]].json.len);
        buf_free(&s->blocks[order[i]].json);
    }
}

static long long trace_stdout_size(void)
{
    LARGE_INTEGER sz;
    return GetFileSizeEx(GetStdHandle(STD_OUTPUT_HANDLE), &sz) ? sz.QuadPart : -1;
}

static void trace_record(CONTEXT *c, int line, int final)
{
    LcBuf b = { 0 }, frames = { 0 }, heap = { 0 };
    LcSnap *s;
    LcBlock *x;
    int i;
    if (T.steps >= LC_TRACE_MAX_STEPS) {
        T.on = 0;
        buf_puts(&b, "{\"t\":\"trace_truncated\"}");
        rec_emit(&b);
        buf_free(&b);
        return;
    }
    s = (LcSnap *)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof *s);
    if (!s) return;
    if (!final) trace_frames(s, c);
    if (T.fresh_rsp) {          /* the first line of a new call: still inside it? */
        if (!final && s->nframes && (uintptr_t)c->Rsp < T.fresh_rsp)
            trace_poison_locals(&s->frames[s->nframes - 1], (uintptr_t)c->Rsp, T.fresh_rsp);
        T.fresh_rsp = 0;
    }
    for (x = G.live.next; x != &G.live; x = x->next)
        if (!x->harness) trace_snap_block(s, x);
    for (i = 0; i < T.nfreed; i++) trace_snap_block(s, T.freed[i]);   /* just freed: show them once */
    T.nfreed = 0;
    trace_emit_frames(s, &frames);
    trace_emit_heap(s, &heap);
    buf_printf(&b, "{\"t\":\"step\",\"n\":%d,\"line\":%d,\"out\":%lld", T.steps++, line, trace_stdout_size());
    if (final) buf_printf(&b, ",\"final\":1,\"ret\":%d", (int)c->Rax);
    if (T.nevents) {
        buf_puts(&b, ",\"ev\":[");
        buf_put(&b, T.events.p, T.events.len);
        buf_put(&b, "]", 1);
        T.events.len = 0;
        T.nevents = 0;
    }
    buf_puts(&b, ",\"frames\":[");
    if (frames.len) buf_put(&b, frames.p, frames.len);
    buf_puts(&b, "],\"heap\":[");
    if (heap.len) buf_put(&b, heap.p, heap.len);
    buf_puts(&b, "]}");
    rec_emit(&b);
    buf_free(&b);
    buf_free(&frames);
    buf_free(&heap);
    HeapFree(G.meta, 0, s);
}

/* ---------------------------------------------------------------- events */

static void trace_event(LcBlock *blk, const char *what)
{
    if (!T.on || blk->harness) return;
    if (T.nevents++) buf_put(&T.events, ",", 1);
    if (blk->state == LC_FREED) {
        buf_printf(&T.events, "{\"e\":\"%s\",\"h\":%lld,\"line\":%d}", what, blk->seq, blk->fline);
        if (T.nfreed < LC_TRACE_MAX_FREED) T.freed[T.nfreed++] = blk;
    } else {
        buf_printf(&T.events, "{\"e\":\"%s\",\"h\":%lld,\"size\":%zu,\"line\":%d}", what, blk->seq, blk->size, blk->aline);
    }
}

/* ---------------------------------------------------------------- stepping */

static void trace_patch(uintptr_t at, unsigned char byte)
{
    DWORD old;
    VirtualProtect((void *)at, 1, PAGE_EXECUTE_READWRITE, &old);
    *(volatile unsigned char *)at = byte;
    FlushInstructionCache(GetCurrentProcess(), (void *)at, 1);
}

static LONG CALLBACK trace_veh(EXCEPTION_POINTERS *ep)
{
    CONTEXT *c = ep->ContextRecord;
    DWORD code = ep->ExceptionRecord->ExceptionCode;
    uintptr_t at = (uintptr_t)ep->ExceptionRecord->ExceptionAddress;

    if (code == EXCEPTION_BREAKPOINT) {
        if (T.armed && at == T.main_addr) {             /* main() is starting: begin stepping */
            trace_patch(at, T.main_byte);
            T.armed = 0;
            T.on = 1;
            T.fresh_rsp = (uintptr_t)c->Rsp;
            c->Rip = at;
            c->EFlags |= LC_TRAP_FLAG;
            return EXCEPTION_CONTINUE_EXECUTION;
        }
        if (T.bp_addr && at == T.bp_addr) {             /* a library call returned to main.c */
            LcCode ci = trace_code(at);
            trace_patch(at, T.bp_byte);
            T.bp_addr = 0;
            c->Rip = at;
            if (T.on && ci.start) trace_record(c, ci.line, 0);
            if (T.on) c->EFlags |= LC_TRAP_FLAG;
            return EXCEPTION_CONTINUE_EXECUTION;
        }
        return EXCEPTION_CONTINUE_SEARCH;
    }
    if (code == EXCEPTION_SINGLE_STEP) {
        LcCode ci;
        uintptr_t ret = 0;
        if (!T.on) {
            c->EFlags &= ~(DWORD)LC_TRAP_FLAG;
            return EXCEPTION_CONTINUE_EXECUTION;
        }
        ci = trace_code((uintptr_t)c->Rip);
        if (ci.user) {
            if (ci.entry) T.fresh_rsp = (uintptr_t)c->Rsp;    /* a call into main.c */
            if (ci.start) trace_record(c, ci.line, 0);
            if (T.on) c->EFlags |= LC_TRAP_FLAG;
            return EXCEPTION_CONTINUE_EXECUTION;
        }
        /* left main.c: either a call into other code, or main() returning */
        if (is_readable((void *)(uintptr_t)c->Rsp, 8)) ret = *(const uintptr_t *)(uintptr_t)c->Rsp;
        if (ret && trace_code(ret).user) {
            T.bp_addr = ret;
            T.bp_byte = *(const unsigned char *)ret;
            trace_patch(ret, 0xCC);
        } else {
            trace_record(c, 0, 1);
            T.on = 0;
        }
        return EXCEPTION_CONTINUE_EXECUTION;
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

extern int main();

static void trace_init(void)
{
    T.code = (LcCode *)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof(LcCode) << 16);
    T.scopes = (LcScope **)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof(LcScope *) * LC_SCOPE_SLOTS);
    T.types = (LcType *)HeapAlloc(G.meta, HEAP_ZERO_MEMORY, sizeof(LcType) * LC_TYPE_SLOTS);
    if (!T.code || !T.scopes || !T.types) return;
    sym_init();
    AddVectoredExceptionHandler(1, trace_veh);
    T.main_addr = (uintptr_t)main;
    T.main_byte = *(const unsigned char *)T.main_addr;
    trace_patch(T.main_addr, 0xCC);
    T.armed = 1;
}
