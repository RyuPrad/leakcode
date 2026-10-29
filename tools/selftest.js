'use strict';
// Runtime self-test: compiles small programs with known bugs in the
// playground pipeline and checks that each bug is reported as expected.
//   node tools/selftest.js [filter]

const path = require('path');
const os = require('os');
const { Judge } = require('../src/judge');

const H = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n';
const T = [
  { name: 'clean program', expect: { verdict: 'ok' }, stdin: '21',
    code: H + 'int main(void){int x; if(scanf("%d",&x)!=1) return 1; int *p=malloc(4); *p=x*2; printf("%d\\n",*p); free(p); return 0;}' },
  { name: 'leak', expect: { verdict: 'memory_leak', leakBlocks: 2, line: 7 },
    code: H + 'int main(void){\n char *a = malloc(10);\n strcpy(a, "hi");\n int *b = malloc(40); (void)b; printf("%s\\n", a);\n return 0; }' },
  { name: 'heap overflow write (strcpy)', expect: { kind: 'heap_overflow', line: 7 },
    code: H + 'int main(void){\n char *s = malloc(5);\n\n strcpy(s, "hello");\n printf("%s", s); free(s); return 0; }' },
  { name: 'heap overflow read (loop <=)', expect: { kind: 'heap_overflow', line: 7 },
    code: H + 'int main(void){\n int *a = calloc(10, sizeof(int)); long s = 0;\n\n for (int i = 0; i <= 10; i++) s += a[i];\n printf("%ld", s); free(a); return 0; }' },
  { name: 'use after free', expect: { kind: 'use_after_free', line: 8 },
    code: H + 'typedef struct N { int v; struct N *next; } N;\nint main(void){\n N *n = malloc(sizeof *n); n->v = 1; n->next = NULL;\n free(n);\n printf("%d", n->v); return 0; }' },
  { name: 'double free', expect: { kind: 'double_free', line: 7 },
    code: H + 'int main(void){\n char *p = malloc(8);\n free(p);\n free(p);\n return 0; }' },
  { name: 'free stack memory', expect: { kind: 'invalid_free', line: 6 },
    code: H + 'int main(void){\n int x = 5;\n free(&x);\n return 0; }' },
  { name: 'free string literal', expect: { kind: 'invalid_free', line: 6 },
    code: H + 'int main(void){\n char *s = "abc";\n free(s);\n return 0; }' },
  { name: 'free middle of block', expect: { kind: 'invalid_free', line: 7 },
    code: H + 'int main(void){\n char *p = malloc(8);\n p++;\n free(p);\n return 0; }' },
  { name: 'heap underflow', expect: { kind: 'heap_underflow', line: 8 },
    code: H + 'int main(void){\n int *p = malloc(16);\n p[-1] = 7;\n\n free(p);\n return 0; }' },
  { name: 'NULL dereference', expect: { kind: 'null_deref', line: 7 },
    code: H + 'typedef struct N { int v; struct N *next; } N;\nint main(void){\n N *n = NULL;\n printf("%d", n->next->v);\n return 0; }' },
  { name: 'uninitialized pointer from malloc', expect: { kind: 'uninit_pointer', line: 7 },
    code: H + 'typedef struct N { int v; struct N *next; } N;\nint main(void){\n N *n = malloc(sizeof *n);\n printf("%d", n->next->v);\n return 0; }' },
  { name: 'stack overflow', expect: { kind: 'stack_overflow', line: [4, 6] },
    code: H + 'int depth(int n) {\n volatile char pad[64]; pad[0] = (char)n;\n return depth(n + 1) + pad[0]; }\nint main(void){ printf("%d", depth(0)); return 0; }' },
  { name: 'uninitialized local (RTC)', expect: { kind: 'uninit_var' },
    code: H + 'int main(void){\n int x;\n if (getchar() == 99) x = 1;\n printf("%d", x);\n return 0; }' },
  { name: 'local array overflow (RTC)', expect: { kind: 'stack_corruption' },
    code: H + 'void f(int n){\n int a[4];\n for (int i = 0; i <= n; i++) a[i] = i;\n printf("%d", a[0]); }\nint main(void){ f(4); return 0; }' },
  { name: 'divide by zero', expect: { kind: 'div_zero', line: 6 },
    code: H + 'int main(void){\n int z = 0;\n printf("%d", 10 / z);\n return 0; }' },
  { name: 'assert', expect: { kind: 'abort' },
    code: H + '#include <assert.h>\nint main(void){\n int x = 3;\n assert(x == 4);\n return 0; }' },
  { name: 'stale pointer after realloc', expect: { kind: 'use_after_free', line: 8 },
    code: H + 'int main(void){\n int *a = malloc(4 * sizeof(int)); a[0] = 1;\n int *first = &a[0];\n a = realloc(a, 100 * sizeof(int));\n printf("%d", *first); free(a); return 0; }' },
  { name: 'NULL function pointer', expect: { kind: 'bad_call' },
    code: H + 'int main(void){\n int (*f)(int) = NULL;\n printf("%d", f(1));\n return 0; }' },
  { name: 'CRT invalid parameter', expect: { kind: 'crt_invalid_param' },
    code: H + 'int main(void){\n FILE *f = NULL;\n fclose(f);\n return 0; }' },
  { name: 'negative malloc size', expect: { kind: 'huge_alloc', line: 6 },
    code: H + 'int main(void){\n int n = -1;\n int *a = malloc(n * sizeof(int));\n free(a); return 0; }' },
  { name: 'memory limit', expect: { kind: 'memory_limit' },
    code: H + 'int main(void){\n for (;;) { char *p = malloc(1 << 20); p[0] = 1; }\n return 0; }' },
  { name: 'infinite loop', expect: { verdict: 'time_limit' },
    code: H + 'int main(void){ volatile int x = 0; for (;;) x++; return 0; }' },
  { name: 'many small allocations (canary fallback)', expect: { verdict: 'ok' },
    code: H + 'int main(void){\n enum { N = 120000 };\n int **p = malloc(N * sizeof *p);\n for (int i = 0; i < N; i++) { p[i] = malloc(sizeof(int)); *p[i] = i; }\n long long s = 0; for (int i = 0; i < N; i++) { s += *p[i]; free(p[i]); }\n free(p); printf("%lld\\n", s); return 0; }' },
  { name: 'compile error', expect: { verdict: 'compile_error' },
    code: H + 'int main(void){\n int x = y + 1;\n return 0; }' },
];

function frameLine(fatal) {
  const f = (fatal.frames || []).find((x) => x.k === 'user');
  return f ? f.line : (fatal.site && fatal.site.line);
}

(async () => {
  const filter = process.argv[2];
  const judge = new Judge({
    runtimeDir: path.join(__dirname, '..', 'runtime'),
    cacheDir: path.join(os.tmpdir(), 'leakcode-selftest'),
  });
  const info = await judge.compilerInfo();
  if (!info.ok) { console.error('No compiler:', info.message); process.exit(1); }
  console.log(`Compiler: ${info.displayName} ${info.version}`);
  let failures = 0;
  for (const t of T) {
    if (filter && !t.name.includes(filter)) continue;
    const r = await judge.play(t.code, t.stdin || '');
    const problems = [];
    const e = t.expect;
    const verdict = e.verdict || 'runtime_error';
    if (r.verdict !== verdict) problems.push(`verdict ${r.verdict} != ${verdict}`);
    if (e.kind && (!r.fatal || r.fatal.kind !== e.kind)) problems.push(`kind ${r.fatal && r.fatal.kind} != ${e.kind}`);
    if (e.line && r.fatal && ![e.line].flat().includes(frameLine(r.fatal))) problems.push(`line ${frameLine(r.fatal)} != ${e.line}`);
    if (e.leakBlocks !== undefined && (!r.exit || r.exit.leakBlocks !== e.leakBlocks)) problems.push(`leakBlocks ${r.exit && r.exit.leakBlocks}`);
    if (e.line && e.verdict === 'memory_leak' && r.exit) {
      const lines = r.exit.leaks.map((l) => l.site.line);
      if (!lines.includes(e.line)) problems.push(`leak lines ${lines}`);
    }
    const status = problems.length ? 'FAIL' : 'ok  ';
    if (problems.length) failures++;
    console.log(`${status} ${t.name.padEnd(42)} ${r.fatal ? `${r.fatal.kind}: ${r.fatal.title}` : r.verdict}`
      + `${problems.length ? `\n      ${problems.join('; ')}` : ''}`);
    if (problems.length || process.env.VERBOSE) {
      console.log('      ', JSON.stringify(r.fatal || r.exit || r.diagnostics).slice(0, 1500));
      if (r.compileOutput) console.log(r.compileOutput);
      if (r.stderr) console.log('      stderr:', r.stderr.slice(0, 500));
    }
  }
  console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
