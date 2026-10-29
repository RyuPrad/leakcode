'use strict';
// Judges typical wrong solutions and checks that each gets the verdict a
// learner should see. Guards the extra checks the drivers perform.
//   node tools/mistakes.js [filter]

const path = require('path');
const os = require('os');
const { Judge } = require('../src/judge');
const { loadProblems } = require('../src/problems');

const M = [
  { id: 'dynamic-array', why: 'grows by one element per push', expect: 'wrong_answer', fail: /allocations for \d+ pushes/,
    code: `#include <stdlib.h>
struct IntVec { int *data; int size; };
IntVec *vecCreate(void) { return calloc(1, sizeof(IntVec)); }
void vecPush(IntVec *v, int x) { v->data = realloc(v->data, (v->size + 1) * sizeof(int)); v->data[v->size++] = x; }
int vecGet(const IntVec *v, int i) { return v->data[i]; }
void vecSet(IntVec *v, int i, int x) { v->data[i] = x; }
int vecPop(IntVec *v) { return v->data[--v->size]; }
int vecSize(const IntVec *v) { return v->size; }
void vecFree(IntVec *v) { free(v->data); free(v); }` },
  { id: 'dynamic-array', why: 'vecFree forgets the element array', expect: 'memory_leak',
    code: `#include <stdlib.h>
struct IntVec { int *data; int size, cap; };
IntVec *vecCreate(void) { return calloc(1, sizeof(IntVec)); }
void vecPush(IntVec *v, int x) { if (v->size == v->cap) { v->cap = v->cap ? v->cap * 2 : 4; v->data = realloc(v->data, v->cap * sizeof(int)); } v->data[v->size++] = x; }
int vecGet(const IntVec *v, int i) { return v->data[i]; }
void vecSet(IntVec *v, int i, int x) { v->data[i] = x; }
int vecPop(IntVec *v) { return v->data[--v->size]; }
int vecSize(const IntVec *v) { return v->size; }
void vecFree(IntVec *v) { free(v); }` },
  { id: 'string-builder', why: 'stores the borrowed pointer instead of copying', expect: 'runtime_error', kind: 'use_after_free',
    code: `#include <stdlib.h>
#include <string.h>
struct StrBuilder { const char *parts[64]; int n; };
StrBuilder *sbCreate(void) { return calloc(1, sizeof(StrBuilder)); }
void sbAppend(StrBuilder *sb, const char *s) { sb->parts[sb->n++] = s; }
void sbAppendChar(StrBuilder *sb, char c) { (void)sb; (void)c; }
int sbLength(const StrBuilder *sb) { int t = 0; for (int i = 0; i < sb->n; i++) t += (int)strlen(sb->parts[i]); return t; }
char *sbBuild(const StrBuilder *sb) { char *o = malloc(sbLength(sb) + 1); o[0] = 0; for (int i = 0; i < sb->n; i++) strcat(o, sb->parts[i]); return o; }
void sbFree(StrBuilder *sb) { free(sb); }` },
  { id: 'remove-linked-list-elements', why: 'unlinks without freeing', expect: 'memory_leak',
    code: `struct ListNode *removeElements(struct ListNode *head, int val) {
    struct ListNode **link = &head;
    while (*link) { if ((*link)->val == val) *link = (*link)->next; else link = &(*link)->next; }
    return head;
}` },
  { id: 'reverse-linked-list', why: 'builds a reversed copy', expect: 'wrong_answer', fail: /allocated/,
    code: `#include <stdlib.h>
struct ListNode *reverseList(struct ListNode *head) {
    struct ListNode *out = NULL;
    while (head) { struct ListNode *n = malloc(sizeof *n); n->val = head->val; n->next = out; out = n;
        struct ListNode *next = head->next; free(head); head = next; }
    return out;
}` },
  { id: 'merge-two-sorted-lists', why: 'loses the tail when one list runs out', expect: 'wrong_answer', fail: /inputs had/,
    code: `struct ListNode *mergeTwoLists(struct ListNode *a, struct ListNode *b) {
    struct ListNode dummy = {0, 0}, *t = &dummy;
    while (a && b) { if (a->val <= b->val) { t->next = a; a = a->next; } else { t->next = b; b = b->next; } t = t->next; }
    t->next = 0;
    return dummy.next;
}` },
  { id: 'free-a-binary-tree', why: 'frees the parent before reading its children', expect: 'runtime_error', kind: 'use_after_free',
    code: `#include <stdlib.h>
int freeTree(struct TreeNode *root) {
    if (!root) return 0;
    free(root);
    return 1 + freeTree(root->left) + freeTree(root->right);
}` },
  { id: 'deep-copy-a-list', why: 'returns the original list', expect: 'wrong_answer', fail: /shares nodes/,
    code: `struct ListNode *copyList(const struct ListNode *head) { return (struct ListNode *)head; }` },
  { id: 'duplicate-a-string', why: 'forgets the +1 for the terminator', expect: 'runtime_error', kind: 'heap_overflow',
    code: `#include <stdlib.h>
#include <string.h>
char *myStrdup(const char *s) { char *c = malloc(strlen(s)); strcpy(c, s); return c; }` },
  { id: 'duplicate-a-string', why: 'returns a string literal', expect: 'runtime_error', kind: 'invalid_free',
    code: `char *myStrdup(const char *s) { (void)s; return "hello"; }` },
  { id: 'filter-even-numbers', why: 'allocates numsSize ints without shrinking', expect: 'wrong_answer', fail: /exactly/,
    code: `#include <stdlib.h>
int *filterEven(const int *nums, int n, int *rs) { int *o = malloc((n ? n : 1) * sizeof(int)); int k = 0;
    for (int i = 0; i < n; i++) if (nums[i] % 2 == 0) o[k++] = nums[i];
    *rs = k; if (!k) { free(o); return NULL; } return o; }` },
  { id: 'hash-map-with-chaining', why: 'keeps the borrowed key pointer', expect: 'runtime_error', kind: 'use_after_free',
    code: `#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
typedef struct E { const char *k; int v; struct E *next; } E;
struct HashMap { E *head; int size; };
HashMap *hmCreate(int b) { (void)b; return calloc(1, sizeof(HashMap)); }
static E *find(const HashMap *m, const char *k) { for (E *e = m->head; e; e = e->next) if (!strcmp(e->k, k)) return e; return NULL; }
void hmPut(HashMap *m, const char *k, int v) { E *e = find(m, k); if (e) { e->v = v; return; } e = malloc(sizeof *e); e->k = k; e->v = v; e->next = m->head; m->head = e; m->size++; }
bool hmGet(const HashMap *m, const char *k, int *out) { E *e = find(m, k); if (!e) return false; *out = e->v; return true; }
bool hmRemove(HashMap *m, const char *k) { for (E **l = &m->head; *l; l = &(*l)->next) if (!strcmp((*l)->k, k)) { E *e = *l; *l = e->next; free(e); m->size--; return true; } return false; }
int hmSize(const HashMap *m) { return m->size; }
void hmFree(HashMap *m) { while (m->head) { E *n = m->head->next; free(m->head); m->head = n; } free(m); }` },
  { id: 'lru-cache', why: 'never frees evicted entries', expect: 'memory_leak',
    code: `#include <stdlib.h>
typedef struct Node { int key, value; struct Node *prev, *next; } Node;
struct LRUCache { int cap, size; Node head; Node *index[10001]; };
static void rm(Node *n) { n->prev->next = n->next; n->next->prev = n->prev; }
static void front(LRUCache *c, Node *n) { n->next = c->head.next; n->prev = &c->head; c->head.next->prev = n; c->head.next = n; }
LRUCache *lruCreate(int cap) { LRUCache *c = calloc(1, sizeof *c); c->cap = cap; c->head.next = c->head.prev = &c->head; return c; }
int lruGet(LRUCache *c, int k) { Node *n = c->index[k]; if (!n) return -1; rm(n); front(c, n); return n->value; }
void lruPut(LRUCache *c, int k, int v) { Node *n = c->index[k]; if (n) { n->value = v; rm(n); front(c, n); return; }
    if (c->size == c->cap) { Node *o = c->head.prev; rm(o); c->index[o->key] = NULL; c->size--; }
    n = malloc(sizeof *n); n->key = k; n->value = v; front(c, n); c->index[k] = n; c->size++; }
void lruFree(LRUCache *c) { Node *n = c->head.next; while (n != &c->head) { Node *x = n->next; free(n); n = x; } free(c); }` },
  { id: 'fixed-size-pool-allocator', why: 'calls malloc in poolAlloc', expect: 'wrong_answer', fail: /called malloc or free/,
    code: `#include <stdlib.h>
struct Pool { size_t bs; int avail; };
Pool *poolCreate(size_t bs, int n) { Pool *p = malloc(sizeof *p); p->bs = bs; p->avail = n; return p; }
void *poolAlloc(Pool *p) { if (!p->avail) return NULL; p->avail--; return malloc(p->bs); }
void poolFree(Pool *p, void *b) { if (b) { free(b); p->avail++; } }
int poolAvailable(const Pool *p) { return p->avail; }
void poolDestroy(Pool *p) { free(p); }` },
  { id: 'implement-malloc', why: 'never coalesces free blocks', expect: 'wrong_answer',
    code: `#include <stddef.h>
typedef struct H { size_t size, free; } H;
static unsigned char *st; static size_t sz;
static H *nx(H *h) { unsigned char *n = (unsigned char *)h + h->size; return n < st + sz ? (H *)n : NULL; }
void heapInit(void *b, size_t s) { st = b; sz = s; ((H *)st)->size = s; ((H *)st)->free = 1; }
void *heapAlloc(size_t s) { size_t need = sizeof(H) + ((s + 15) & ~(size_t)15);
    for (H *h = (H *)st; h; h = nx(h)) { if (!h->free || h->size < need) continue;
        if (h->size - need >= sizeof(H) + 16) { H *r = (H *)((unsigned char *)h + need); r->size = h->size - need; r->free = 1; h->size = need; }
        h->free = 0; return h + 1; } return NULL; }
void heapFree(void *p) { if (p) ((H *)p - 1)->free = 1; }` },
  { id: 'implement-malloc', why: 'returns 8-byte aligned blocks', expect: 'wrong_answer', fail: /16-byte aligned/,
    code: `#include <stddef.h>
static unsigned char *st; static size_t used, cap;
void heapInit(void *b, size_t s) { st = b; cap = s; used = 0; }
void *heapAlloc(size_t s) { size_t off = used + 8; if (off + s > cap) return NULL; used = off + ((s + 7) & ~(size_t)7); return st + off; }
void heapFree(void *p) { (void)p; }` },
  { id: 'bump-allocator', why: 'ignores alignment', expect: 'wrong_answer',
    code: `#include <stddef.h>
void arenaInit(Arena *a, void *b, size_t c) { a->base = b; a->capacity = c; a->used = 0; }
void *arenaAlloc(Arena *a, size_t s, size_t al) { (void)al; if (s > a->capacity - a->used) return NULL; void *p = a->base + a->used; a->used += s; return p; }
void arenaReset(Arena *a) { a->used = 0; }` },
  { id: 'safe-string-copy', why: 'writes the terminator at dst[dstSize]', expect: 'runtime_error', kind: 'heap_overflow',
    code: `#include <string.h>
size_t safeCopy(char *dst, size_t n, const char *src) { size_t len = strlen(src); size_t k = len < n ? len : n; memcpy(dst, src, k); dst[k] = 0; return len; }` },
  { id: 'reference-counted-strings', why: 'frees on every release', expect: 'runtime_error', kind: 'use_after_free',
    code: `#include <stdlib.h>
#include <string.h>
struct RcStr { int refs; char text[]; };
RcStr *rcNew(const char *s) { RcStr *r = malloc(sizeof *r + strlen(s) + 1); r->refs = 1; strcpy(r->text, s); return r; }
RcStr *rcRetain(RcStr *r) { r->refs++; return r; }
void rcRelease(RcStr *r) { r->refs--; free(r); }
const char *rcGet(const RcStr *r) { return r->text; }
int rcCount(const RcStr *r) { return r->refs; }` },
  { id: 'allocate-a-matrix', why: 'frees the row array before the rows', expect: 'runtime_error', kind: 'use_after_free',
    code: `#include <stdlib.h>
int **createMatrix(int r, int c, int v) { int **m = malloc(r * sizeof *m); for (int i = 0; i < r; i++) { m[i] = malloc(c * sizeof **m); for (int j = 0; j < c; j++) m[i][j] = v; } return m; }
void freeMatrix(int **m, int r) { free(m); for (int i = 0; i < r; i++) free(m[i]); }` },
  { id: 'split-a-string', why: 'misspells the function name', expect: 'compile_error',
    code: `char **splitStr(const char *s, char d, int *n) { (void)s; (void)d; *n = 0; return 0; }` },
];

(async () => {
  const filter = process.argv[2];
  const root = path.join(__dirname, '..');
  const { byId } = loadProblems(path.join(root, 'problems'));
  const judge = new Judge({ runtimeDir: path.join(root, 'runtime'), cacheDir: path.join(os.tmpdir(), 'leakcode-verify') });
  let failures = 0;
  for (const m of M) {
    if (filter && !m.id.includes(filter)) continue;
    const p = byId.get(m.id);
    const r = await judge.judge(p, m.code, p.tests, { submit: true });
    const failMsgs = (r.cases || []).flatMap((c) => c.fails || []);
    const problems = [];
    if (r.verdict !== m.expect) problems.push(`verdict ${r.verdict} != ${m.expect}`);
    if (m.kind && (!r.fatal || r.fatal.kind !== m.kind)) problems.push(`kind ${r.fatal && r.fatal.kind} != ${m.kind}`);
    if (m.fail && !failMsgs.some((f) => m.fail.test(f))) problems.push(`no failure message matching ${m.fail}: ${JSON.stringify(failMsgs)}`);
    if (problems.length) failures++;
    const detail = r.fatal ? `${r.fatal.kind}` : failMsgs[0] ? failMsgs[0].slice(0, 70) : (r.diagnostics || []).map((d) => d.code).join(',');
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${m.id.padEnd(28)} ${m.why.padEnd(46)} ${r.verdict} ${detail}`);
    for (const x of problems) console.log(`      ${x}`);
  }
  console.log(failures ? `\n${failures} failure(s)` : '\nall mistakes caught');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
