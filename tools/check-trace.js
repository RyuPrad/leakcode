'use strict';
// Traces a C program the way the visualizer does and prints every step in a
// compact text form, to check what the tracer records.
//   node tools/check-trace.js [file.c] [--json]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Judge } = require('../src/judge');

const SAMPLE = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Node { int val; struct Node *next; } Node;

int square(int x) {
    int r = x * x;
    return r;
}

int main(void) {
    int a = 5;
    int *p = &a;
    *p = square(a);
    int arr[3] = { 1, 2, 3 };
    int *heap = malloc(3 * sizeof *heap);
    for (int i = 0; i < 3; i++) heap[i] = arr[i] * 10;
    char *s = malloc(6);
    strcpy(s, "hello");
    Node *head = NULL;
    for (int i = 0; i < 2; i++) {
        Node *n = malloc(sizeof *n);
        n->val = i;
        n->next = head;
        head = n;
    }
    printf("%d %s\\n", heap[1], s);
    free(heap);
    free(s);
    while (head) { Node *next = head->next; free(head); head = next; }
    return 0;
}
`;

function show(v) {
  if (!v) return '?';
  switch (v.k) {
    case 'int': case 'num': return v.v;
    case 'bool': return String(v.v);
    case 'char': return v.c === 0 ? "'\\0'" : v.c >= 32 && v.c < 127 ? `'${String.fromCharCode(v.c)}'` : String(v.c);
    case 'g': return v.g === 2 ? '?heap' : '?';
    case 'ptr': {
      const t = v.to || {};
      if (t.null) return 'NULL';
      if (t.garbage) return '?ptr';
      if (t.h !== undefined) return `->#${t.h}${t.o ? `+${t.o}` : ''}${t.freed ? '(FREED)' : ''}`;
      if (t.f !== undefined) return `->frame${t.f}.var${t.v}${t.o ? `+${t.o}` : ''}`;
      if (t.lit !== undefined) return `->"${t.lit}"`;
      if (t.fn) return `->${t.fn}()`;
      return t.bad ? '->BAD' : '->static';
    }
    case 'arr': return `[${v.items.map(show).join(',')}${v.n > v.items.length ? ',...' : ''}]${v.s !== undefined ? ` "${v.s}"` : ''}`;
    case 'struct': return `{${v.f.map((f) => `${f.n}:${show(f.v)}`).join(' ')}}`;
    case 'bytes': return `bytes(${v.n})`;
    default: return v.k;
  }
}

// --examples: trace every visualizer example and summarize each run
async function checkExamples(judge) {
  const { loadExamples } = require('../src/content');
  const expected = { leak: 'leak', dangling: 'use_after_free', overflow: 'heap_overflow' };
  let failures = 0;
  for (const ex of loadExamples(path.join(__dirname, '..', 'visualizer', 'examples.lc'))) {
    const r = await judge.trace(ex.code, '');
    const steps = r.steps || [];
    const last = steps[steps.length - 1];
    const leaked = last && last.final ? last.heap.filter((b) => !b.freed).length : 0;
    const outcome = r.fatal ? r.fatal.kind : leaked ? 'leak' : r.verdict;
    const want = expected[ex.id] || 'ok';
    const ok = outcome === want && steps.length > 3 && !r.truncated;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${ex.id.padEnd(10)} ${String(steps.length).padStart(3)} steps  ${outcome}${ok ? '' : ` (expected ${want})`}`);
  }
  console.log(failures ? `\n${failures} failure(s)` : '\nall examples traced as expected');
  process.exit(failures ? 1 : 0);
}

(async () => {
  const judge = new Judge({ runtimeDir: path.join(__dirname, '..', 'runtime'), cacheDir: path.join(os.tmpdir(), 'leakcode-verify') });
  if (process.argv.includes('--examples')) return checkExamples(judge);
  const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const code = file ? fs.readFileSync(file, 'utf8') : SAMPLE;
  const t0 = Date.now();
  const r = await judge.trace(code, '');
  console.log(`verdict ${r.verdict}, ${r.steps ? r.steps.length : 0} steps${r.truncated ? ' (truncated)' : ''}, ${Date.now() - t0} ms`);
  if (r.compileOutput) console.log(r.compileOutput);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r.steps.slice(0, 3), null, 1));
    return;
  }
  for (const st of r.steps || []) {
    const ev = (st.ev || []).map((e) => `${e.e}#${e.h}`).join(' ');
    const frames = st.frames.map((f) => `${f.fn}(${f.vars.map((v) => `${v.n}=${show(v.v)}`).join(' ')})`).join(' | ');
    const heap = st.heap.map((h) => `#${h.id}${h.freed ? ' freed' : ''}${h.t ? ` ${h.t}` : ''}=${h.v ? show(h.v) : ''}`).join('  ');
    console.log(`${String(st.n).padStart(3)} L${String(st.line).padEnd(3)}${st.final ? ` END ret=${st.ret}` : ''} ${ev ? `[${ev}] ` : ''}${frames}${heap ? `  HEAP ${heap}` : ''}`);
  }
  if (r.fatal) console.log('FATAL', r.fatal.kind, r.fatal.msg);
  if (r.exit) console.log('EXIT leaks:', r.exit.leakBlocks);
  console.log('stdout:', JSON.stringify(r.stdout));
})().catch((e) => { console.error(e); process.exit(1); });
