'use strict';
// Verifies the problem set:
//   - the reference solution passes every test with no leaks or failed checks,
//   - each example's stated output matches what the reference produces,
//   - the starter code compiles (and, for bug hunts, fails the way it should).
//   node tools/verify.js [id-substring]

const path = require('path');
const os = require('os');
const { Judge } = require('../src/judge');
const { loadProblems } = require('../src/problems');

const norm = (s) => {
  try { return JSON.stringify(JSON.parse(s)); } catch { return String(s); }
};

(async () => {
  const filter = process.argv[2];
  const root = path.join(__dirname, '..');
  const { sections, byId } = loadProblems(path.join(root, 'problems'));
  const judge = new Judge({ runtimeDir: path.join(root, 'runtime'), cacheDir: path.join(os.tmpdir(), 'leakcode-verify') });
  const info = await judge.compilerInfo();
  if (!info.ok) throw new Error(info.message);
  let failures = 0, count = 0;
  for (const section of sections) {
    for (const id of section.problems) {
      if (filter && !id.includes(filter)) continue;
      const p = byId.get(id);
      count++;
      const problems = [];
      const ref = await judge.judge(p, p.solution, p.tests, { submit: true });
      if (ref.verdict !== 'accepted') {
        problems.push(`reference: ${ref.verdict} ${ref.message || ''} ${ref.fatal ? JSON.stringify(ref.fatal).slice(0, 600) : ''}`);
        if (ref.diagnostics) problems.push(ref.compileOutput || JSON.stringify(ref.diagnostics));
        const bad = ref.cases && ref.cases[ref.failedCase];
        if (bad) problems.push(`case ${bad.index}: ${JSON.stringify(bad).slice(0, 600)}`);
      } else {
        p.examples.forEach((e, i) => {
          if (e.output !== undefined && norm(ref.cases[i].output) !== norm(e.output)) {
            problems.push(`example ${i + 1}: stated ${e.output}, reference gives ${ref.cases[i].output}`);
          }
        });
      }
      const starter = await judge.judge(p, p.starter, p.tests.slice(0, Math.max(1, p.examples.length)), {});
      if (starter.verdict === 'compile_error') {
        problems.push(`starter does not compile: ${starter.compileOutput}`);
      } else if (p.starterShould) {
        const [verdict, kind] = p.starterShould.split(':');
        const all = await judge.judge(p, p.starter, p.tests, { submit: true });
        if (all.verdict !== verdict || (kind && (!all.fatal || all.fatal.kind !== kind))) {
          problems.push(`starter should be ${p.starterShould}, got ${all.verdict}${all.fatal ? `:${all.fatal.kind}` : ''}`);
        }
      }
      const warn = (ref.diagnostics || []).filter((d) => d.severity === 'warning');
      if (warn.length) problems.push(`reference warnings: ${warn.map((d) => `${d.line}: ${d.message}`).join(' | ')}`);
      if (problems.length) failures++;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} #${String(p.number).padStart(2)} ${id.padEnd(34)} `
        + `${ref.verdict} ${ref.passed}/${ref.total} ${ref.runtimeMs}ms peak=${ref.peakBytes}B`);
      for (const x of problems) console.log(`      ${x}`);
    }
  }
  console.log(`\n${count - failures}/${count} problems ok`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
