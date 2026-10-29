'use strict';
// Runs every complete program in the lessons through the playground
// pipeline and prints its verdict, so lesson text and behaviour stay in sync.
//   node tools/check-lessons.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Judge } = require('../src/judge');
const { loadLessons, loadExamples } = require('../src/content');

(async () => {
  const root = path.join(__dirname, '..');
  const judge = new Judge({ runtimeDir: path.join(root, 'runtime'), cacheDir: path.join(os.tmpdir(), 'leakcode-verify') });
  const programs = [];
  for (const l of loadLessons(path.join(root, 'lessons'))) {
    const re = /```c\n([\s\S]*?)```/g;
    let m, k = 0;
    while ((m = re.exec(l.body))) if (/\bint\s+main\s*\(/.test(m[1])) programs.push({ name: `${l.id} #${++k}`, code: m[1] });
  }
  for (const e of loadExamples(path.join(root, 'playground', 'examples.lc'))) programs.push({ name: `example ${e.id}`, code: e.code, stdin: e.id === 'input' ? '3 1 4 1 5' : '' });
  for (const p of programs) {
    const r = await judge.play(p.code, p.stdin || '');
    const what = r.fatal ? `${r.fatal.kind} @${(r.fatal.frames || []).filter((f) => f.k === 'user').map((f) => f.line).join(',')}`
      : r.verdict === 'memory_leak' ? `leak ${r.exit.leakBytes}B` : r.verdict === 'compile_error' ? r.compileOutput.slice(0, 300) : '';
    const warn = (r.diagnostics || []).filter((d) => d.severity === 'warning').map((d) => d.code).join(',');
    console.log(`${p.name.padEnd(28)} ${r.verdict.padEnd(14)} ${what} ${warn ? `[warn ${warn}]` : ''} | ${(r.stdout || '').split('\n')[0].slice(0, 50)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
