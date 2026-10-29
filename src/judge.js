'use strict';
// Builds and runs C programs against the LeakCode runtime, and judges
// solutions by comparing them case by case with the reference solution.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Msvc, parseDiagnostics, USER_FLAGS, LINK_FLAGS, RUNTIME_FLAGS } = require('./compiler');

const RUNTIME_FILES = ['lc_rt.c', 'lc_mem.h', 'lc_driver.h', 'lc_ds.h'];
const MAX_STDOUT = 1 << 20;
const MAX_STDERR = 64 << 10;
const STATUS_STACK_BUFFER_OVERRUN = 0xC0000409;
const STATUS_STACK_OVERFLOW = 0xC00000FD;
const STATUS_ACCESS_VIOLATION = 0xC0000005;

class CompilerMissingError extends Error {
  constructor(info) {
    super(info.message);
    this.info = info;
  }
}

function sha(...parts) {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(String(p));
  return h.digest('hex').slice(0, 16);
}

function removeDir(dir) {
  fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }, () => {});
}

// Splits the program's stdout into per-case chunks using the markers that
// lc_next_case() prints (\x01LC<n>\x02).
function splitStdout(text) {
  const parts = { pre: '', cases: {} };
  const re = /\x01LC(\d+)\x02/g;
  let last = 0, current = null, m;
  while ((m = re.exec(text))) {
    const chunk = text.slice(last, m.index);
    if (current === null) parts.pre += chunk;
    else parts.cases[current] = (parts.cases[current] || '') + chunk;
    current = Number(m[1]);
    last = re.lastIndex;
  }
  const tail = text.slice(last);
  if (current === null) parts.pre += tail;
  else parts.cases[current] = (parts.cases[current] || '') + tail;
  return parts;
}

function parseRecords(text) {
  const out = { cases: {}, fatal: null, exit: null, done: null };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.t === 'case') out.cases[r.i] = r;
    else if (r.t === 'fatal') { if (!out.fatal || out.fatal.early) out.fatal = r; }
    else if (r.t === 'exit') out.exit = r;
    else if (r.t === 'done') out.done = r;
  }
  return out;
}

// A fatal record for crashes the runtime could not report itself.
function fatalFromExitCode(code, caseIndex) {
  const u = code >>> 0;
  if (u === STATUS_STACK_BUFFER_OVERRUN) {
    return {
      i: caseIndex, kind: 'stack_smash', title: 'Stack buffer overrun',
      msg: 'The program wrote past the end of a local array and corrupted the stack, so Windows terminated it. '
        + 'Check the bounds of every local array (char buf[N] holds at most N-1 characters plus the terminating \\0).',
      frames: [],
    };
  }
  if (u === STATUS_STACK_OVERFLOW) {
    return { i: caseIndex, kind: 'stack_overflow', title: 'Stack overflow',
      msg: 'The call stack ran out of space; this is almost always infinite recursion.', frames: [] };
  }
  if (u === STATUS_ACCESS_VIOLATION) {
    return { i: caseIndex, kind: 'wild_pointer', title: 'Invalid memory access',
      msg: 'The program accessed memory it does not own.', frames: [] };
  }
  return null;
}

class Judge {
  constructor({ runtimeDir, cacheDir }) {
    this.runtimeSrc = runtimeDir;
    this.cacheDir = cacheDir;
    this.buildsDir = path.join(cacheDir, 'builds');
    this.msvc = new Msvc(cacheDir);
    this.runtime = null;
    this.runtimePromise = null;
    this.refBuilds = new Map();
    this.seq = 0;
    fs.rmSync(this.buildsDir, { recursive: true, force: true });
    fs.mkdirSync(this.buildsDir, { recursive: true });
  }

  compilerInfo(force) {
    if (force) {
      this.runtime = null;
      this.refBuilds.clear();
    }
    return this.msvc.detect(force);
  }

  ensureRuntime() {
    if (this.runtime) return Promise.resolve(this.runtime);
    if (!this.runtimePromise) {
      this.runtimePromise = this._buildRuntime().finally(() => { this.runtimePromise = null; });
    }
    return this.runtimePromise;
  }

  async _buildRuntime() {
    const info = await this.msvc.detect();
    if (!info.ok) throw new CompilerMissingError(info);
    const files = RUNTIME_FILES.map((f) => [f, fs.readFileSync(path.join(this.runtimeSrc, f))]);
    const hash = sha(info.version, RUNTIME_FLAGS.join(' '), ...files.flat());
    const dir = path.join(this.cacheDir, `runtime-${hash}`);
    const obj = path.join(dir, 'lc_rt.obj');
    if (!fs.existsSync(obj)) {
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, data] of files) fs.writeFileSync(path.join(dir, name), data);
      const r = await this.msvc.cl([...RUNTIME_FLAGS, 'lc_rt.c', '/Fo:lc_rt.obj'], dir);
      if (r.code !== 0 || !fs.existsSync(obj)) throw new Error(`Building the LeakCode runtime failed:\n${r.output}`);
    }
    this.runtime = { dir, obj, hash };
    return this.runtime;
  }

  newBuildDir(tag) {
    const dir = path.join(this.buildsDir, `${Date.now().toString(36)}-${++this.seq}-${tag}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Compiles `sources` (written from `files`) into dir/prog.exe.
  async build(dir, files, sources) {
    const rt = await this.ensureRuntime();
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    const args = [...USER_FLAGS, `/I${rt.dir}`, '/FIprelude.h', ...sources, rt.obj, '/Fe:prog.exe', ...LINK_FLAGS];
    const r = await this.msvc.cl(args, dir);
    const exe = path.join(dir, 'prog.exe');
    const output = r.output.split('\n').filter((l) => !sources.includes(l.trim())).join('\n').trim();
    return { ok: r.code === 0 && fs.existsSync(exe), exe, dir, output, diagnostics: parseDiagnostics(r.output), ms: r.ms };
  }

  // Runs a built program. mode 'judge' feeds `input` to the driver; mode
  // 'play' pipes `stdin` to the program.
  execute(exe, { mode, input = '', stdin = '', timeoutMs = 5000, tag = 'run' }) {
    const dir = path.dirname(exe);
    const resultFile = path.join(dir, `${tag}-result.jsonl`);
    const inputFile = path.join(dir, `${tag}-input.txt`);
    if (mode === 'judge') fs.writeFileSync(inputFile, input);
    return new Promise((resolve) => {
      const env = { ...process.env, LC_RESULT: resultFile, LC_MODE: mode, LC_INPUT: inputFile };
      delete env.ELECTRON_RUN_AS_NODE;
      const started = Date.now();
      let child;
      try {
        child = spawn(exe, [], { cwd: dir, env, windowsHide: true });
      } catch (e) {
        resolve({ code: -1, stdout: '', stderr: e.message, records: parseRecords(''), killedFor: null, wallMs: 0 });
        return;
      }
      const out = [], err = [];
      let outLen = 0, errLen = 0, killedFor = null;
      const kill = (why) => {
        if (!killedFor) killedFor = why;
        try { child.kill(); } catch { /* already gone */ }
      };
      const timer = setTimeout(() => kill('timeout'), timeoutMs);
      child.stdout.on('data', (d) => {
        outLen += d.length;
        if (outLen > MAX_STDOUT) kill('output');
        else out.push(d);
      });
      child.stderr.on('data', (d) => {
        errLen += d.length;
        if (errLen <= MAX_STDERR) err.push(d);
      });
      child.stdin.on('error', () => {});
      child.on('error', (e) => err.push(Buffer.from(String(e.message))));
      child.on('close', (code) => {
        clearTimeout(timer);
        let text = '';
        try { text = fs.readFileSync(resultFile, 'utf8'); } catch { /* no records */ }
        resolve({
          code: code === null ? -1 : code >>> 0,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          records: parseRecords(text),
          killedFor,
          wallMs: Date.now() - started,
        });
      });
      child.stdin.end(mode === 'play' ? stdin : '');
    });
  }

  // ---------------------------------------------------------------- problems

  problemFiles(problem, code) {
    return {
      'prelude.h': `#include "lc_mem.h"\n${problem.prelude || ''}\n`,
      'driver.c': problem.driver,
      'solution.c': code,
    };
  }

  // The reference solution is built once per problem version and cached.
  async referenceExe(problem) {
    const rt = await this.ensureRuntime();
    const key = sha(rt.hash, problem.prelude, problem.driver, problem.solution, USER_FLAGS.join(' '));
    const cached = this.refBuilds.get(problem.id);
    if (cached && cached.key === key) return cached.promise;
    const promise = (async () => {
      const dir = path.join(this.cacheDir, 'ref', `${problem.id}-${key}`);
      const exe = path.join(dir, 'prog.exe');
      if (fs.existsSync(exe)) return { ok: true, exe };
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const b = await this.build(dir, this.problemFiles(problem, problem.solution), ['solution.c', 'driver.c']);
      if (!b.ok) throw new Error(`The reference solution for "${problem.title}" failed to build:\n${b.output}`);
      // only the program is needed later; debug info would make the cache ~8 MB per problem
      for (const f of fs.readdirSync(dir)) {
        if (/\.(obj|pdb|ilk)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      }
      return { ok: true, exe };
    })();
    this.refBuilds.set(problem.id, { key, promise });
    promise.catch(() => this.refBuilds.delete(problem.id));
    return promise;
  }

  async judge(problem, code, cases, { submit = false } = {}) {
    const input = `${cases.map((c) => c.join('\n')).join('\n\n')}\n`;
    const dir = this.newBuildDir(submit ? 'submit' : 'run');
    try {
      const [ref, built] = await Promise.all([
        this.referenceExe(problem),
        this.build(dir, this.problemFiles(problem, code), ['solution.c', 'driver.c']),
      ]);
      const diagnostics = built.diagnostics.filter((d) => d.file === 'solution.c' || !/\.(c|h)$/.test(d.file));
      if (!built.ok) {
        return { verdict: 'compile_error', diagnostics, compileOutput: built.output, compileMs: built.ms };
      }
      const timeoutMs = submit ? 10000 : 6000;
      const [refRun, userRun] = await Promise.all([
        this.execute(ref.exe, { mode: 'judge', input, timeoutMs: timeoutMs * 2, tag: `ref-${path.basename(dir)}` }),
        this.execute(built.exe, { mode: 'judge', input, timeoutMs, tag: 'user' }),
      ]);
      // the reference run writes into the shared cache folder: clean up its files
      for (const f of [`ref-${path.basename(dir)}-result.jsonl`, `ref-${path.basename(dir)}-input.txt`]) {
        fs.rm(path.join(path.dirname(ref.exe), f), { force: true }, () => {});
      }
      return this.compare(cases, refRun, userRun, diagnostics, built.ms);
    } finally {
      removeDir(dir);
    }
  }

  compare(cases, refRun, userRun, diagnostics, compileMs) {
    const ref = refRun.records;
    const user = userRun.records;
    const stdout = splitStdout(userRun.stdout);
    const total = cases.length;
    const result = {
      verdict: 'accepted', total, passed: 0, failedCase: null, fatal: null,
      diagnostics, compileMs, stderr: userRun.stderr.trim(), stdoutPre: stdout.pre,
      runtimeMs: 0, peakBytes: 0, allocs: 0, frees: 0, refRuntimeMs: 0, refPeakBytes: 0, refAllocs: 0,
      cases: [],
    };

    if (ref.fatal || refRun.killedFor || !ref.done) {
      const bad = ref.fatal ? ref.fatal.i : Object.keys(ref.cases).length;
      result.verdict = 'invalid_input';
      result.failedCase = bad >= 0 ? bad : null;
      result.message = ref.fatal && ref.fatal.kind === 'bad_input'
        ? ref.fatal.msg
        : `The reference solution could not run test case ${bad + 1}. The input is probably outside the problem's constraints.`;
      return result;
    }

    let fatal = user.fatal;
    const lastStarted = Object.keys(stdout.cases).map(Number).reduce((a, b) => Math.max(a, b), -1);
    if (!fatal && !userRun.killedFor && !user.done) {
      fatal = fatalFromExitCode(userRun.code, lastStarted) || {
        i: lastStarted, kind: 'early_exit', title: 'Program exited early',
        msg: `The program stopped before finishing the tests (exit code ${userRun.code}). `
          + 'Did your code call exit() or abort()?',
        frames: [],
      };
    }

    for (let i = 0; i < total; i++) {
      const rc = ref.cases[i] || {};
      const uc = user.cases[i];
      const c = {
        index: i, input: cases[i], expected: rc.out, stdout: stdout.cases[i] || '',
        output: uc ? uc.out : null, status: 'notrun',
        us: uc ? uc.us : 0, allocs: uc ? uc.allocs : 0, frees: uc ? uc.frees : 0, peak: uc ? uc.peak : 0,
        leakBytes: uc ? uc.leakBytes : 0, leakBlocks: uc ? uc.leakBlocks : 0,
        leaks: uc ? uc.leaks : [], fails: uc ? uc.fails : [],
        refAllocs: rc.allocs || 0, refPeak: rc.peak || 0,
      };
      if (uc) {
        if (uc.out !== rc.out) c.status = 'wrong';
        else if (uc.fails && uc.fails.length) c.status = 'failed_check';
        else if (uc.leakBlocks > 0) c.status = 'leak';
        else c.status = 'pass';
        result.runtimeMs += uc.us / 1000;
        result.peakBytes = Math.max(result.peakBytes, uc.peak);
        result.allocs += uc.allocs;
        result.frees += uc.frees;
      } else if (fatal && fatal.i === i) {
        c.status = 'error';
      } else if (userRun.killedFor && i === lastStarted) {
        c.status = userRun.killedFor === 'timeout' ? 'tle' : 'ole';
      }
      result.refRuntimeMs += (rc.us || 0) / 1000;
      result.refPeakBytes = Math.max(result.refPeakBytes, rc.peak || 0);
      result.refAllocs += rc.allocs || 0;
      if (c.status === 'pass') result.passed++;
      result.cases.push(c);
    }

    const first = result.cases.find((c) => c.status !== 'pass');
    if (fatal && (!first || first.index >= (fatal.i < 0 ? total : fatal.i))) {
      result.verdict = 'runtime_error';
      result.fatal = fatal;
      result.failedCase = fatal.i >= 0 ? fatal.i : null;
    } else if (first) {
      result.failedCase = first.index;
      result.verdict = {
        wrong: 'wrong_answer', failed_check: 'wrong_answer', leak: 'memory_leak',
        error: 'runtime_error', tle: 'time_limit', ole: 'output_limit', notrun: 'runtime_error',
      }[first.status];
      if (result.verdict === 'runtime_error') result.fatal = fatal;
      if (first.status === 'notrun' && userRun.killedFor) {
        result.verdict = userRun.killedFor === 'timeout' ? 'time_limit' : 'output_limit';
      }
    }
    result.runtimeMs = Math.round(result.runtimeMs * 100) / 100;
    result.refRuntimeMs = Math.round(result.refRuntimeMs * 100) / 100;
    return result;
  }

  // -------------------------------------------------------------- playground

  async play(code, stdin) {
    const dir = this.newBuildDir('play');
    try {
      const built = await this.build(dir, { 'prelude.h': '#include "lc_mem.h"\n', 'main.c': code }, ['main.c']);
      const diagnostics = built.diagnostics.filter((d) => d.file === 'main.c' || !/\.(c|h)$/.test(d.file));
      if (!built.ok) return { verdict: 'compile_error', diagnostics, compileOutput: built.output, compileMs: built.ms };
      const run = await this.execute(built.exe, { mode: 'play', stdin, timeoutMs: 10000, tag: 'play' });
      const rec = run.records;
      let fatal = rec.fatal;
      if (!fatal && !rec.exit && !run.killedFor) fatal = fatalFromExitCode(run.code, -1);
      let verdict = 'ok';
      if (fatal) verdict = 'runtime_error';
      else if (run.killedFor === 'timeout') verdict = 'time_limit';
      else if (run.killedFor === 'output') verdict = 'output_limit';
      else if (rec.exit && rec.exit.leakBlocks > 0) verdict = 'memory_leak';
      return {
        verdict, diagnostics, compileMs: built.ms, exitCode: run.code, wallMs: run.wallMs,
        stdout: run.stdout, stderr: run.stderr, fatal, exit: rec.exit,
      };
    } finally {
      removeDir(dir);
    }
  }
}

module.exports = { Judge, CompilerMissingError, splitStdout, parseRecords };
