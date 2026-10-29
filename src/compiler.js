'use strict';
// Locates the Microsoft C compiler (MSVC Build Tools) and runs it.
//
// The compiler needs the environment that vcvars64.bat sets up (INCLUDE, LIB,
// PATH...). Running that batch file takes a couple of seconds, so the
// resulting variables are cached on disk and reused until the install changes.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VSWHERE = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

// Flags for user code: no optimization, full debug info, run-time checks,
// static debug CRT. Warnings that are really C constraint violations
// (implicit declarations, pointer/int mixups, wrong argument types, a
// signature that differs from the prototype) are promoted to errors.
const USER_FLAGS = [
  '/nologo', '/std:c17', '/utf-8', '/Od', '/Z7', '/RTC1', '/MTd', '/W3', '/diagnostics:column',
  '/D_CRT_SECURE_NO_WARNINGS',
  '/we4013', '/we4047', '/we4024', '/we4133', '/we4020', '/we4716', '/we4028', '/we4029',
];
const LINK_FLAGS = ['/link', '/DEBUG', '/INCREMENTAL:NO', '/STACK:8388608'];
const RUNTIME_FLAGS = ['/nologo', '/c', '/O2', '/MTd', '/Z7', '/W3', '/utf-8', '/D_CRT_SECURE_NO_WARNINGS'];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts });
    } catch (e) {
      resolve({ code: -1, out: '', err: e.message });
      return;
    }
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

class Msvc {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.info = null;
    this.env = null;
    this.detecting = null;
  }

  // Returns { ok, version, sdk, displayName, cl } or { ok: false, reason, message }.
  detect(force = false) {
    if (this.info && !force) return Promise.resolve(this.info);
    if (!this.detecting || force) {
      this.detecting = this._detect(force).then((info) => {
        this.info = info;
        this.detecting = null;
        return info;
      });
    }
    return this.detecting;
  }

  async _detect(force) {
    const fail = (reason, message) => ({ ok: false, reason, message });
    if (!fs.existsSync(VSWHERE)) {
      return fail('not-installed', 'Visual Studio Build Tools were not found on this PC.');
    }
    const q = await run(VSWHERE, [
      '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath', '-utf8']);
    const install = q.out.trim().split(/\r?\n/)[0];
    if (!install) {
      return fail('no-cpp-workload', 'Visual Studio is installed, but without the "Desktop development with C++" tools.');
    }
    const name = await run(VSWHERE, ['-path', install, '-property', 'displayName', '-utf8']);
    const vcvars = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    if (!fs.existsSync(vcvars)) return fail('no-vcvars', `vcvars64.bat is missing from ${install}.`);

    const env = await this._loadEnv(install, vcvars, force);
    if (!env) return fail('env-failed', 'Could not set up the MSVC build environment (vcvars64.bat failed).');
    const cl = path.join(env.VCToolsInstallDir || '', 'bin', 'Hostx64', 'x64', 'cl.exe');
    if (!fs.existsSync(cl)) return fail('no-cl', 'cl.exe was not found in the MSVC installation.');
    this.env = { ...env, VSLANG: '1033' };
    return {
      ok: true,
      cl,
      install,
      displayName: name.out.trim() || 'Visual Studio Build Tools',
      version: env.VCToolsVersion || '',
      sdk: (env.WindowsSDKVersion || '').replace(/\\$/, ''),
    };
  }

  async _loadEnv(install, vcvars, force) {
    const cacheFile = path.join(this.cacheDir, 'msvc-env.json');
    const stamp = `${install}|${fs.statSync(vcvars).mtimeMs}`;
    if (!force) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached.stamp === stamp && cached.env.VCToolsInstallDir && fs.existsSync(cached.env.VCToolsInstallDir)) {
          return cached.env;
        }
      } catch { /* no usable cache */ }
    }
    const r = await run('cmd.exe', ['/d', '/s', '/c', `""${vcvars}" >nul 2>&1 && set"`],
      { windowsVerbatimArguments: true });
    const env = {};
    for (const line of r.out.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
    }
    if (!env.VCToolsInstallDir || !env.INCLUDE) return null;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ stamp, env }));
    } catch { /* caching is optional */ }
    return env;
  }

  // Runs cl.exe with the given arguments in cwd.
  async cl(args, cwd) {
    const info = await this.detect();
    if (!info.ok) throw new Error(info.message);
    const started = Date.now();
    const r = await run(info.cl, args, { cwd, env: this.env });
    return { code: r.code, output: (r.out + r.err).replace(/\r\n/g, '\n'), ms: Date.now() - started };
  }
}

// Turns MSVC compiler and linker output into structured diagnostics.
function parseDiagnostics(output) {
  const diags = [];
  // malloc & co. are macros for lc_malloc & co. (runtime/lc_mem.h): show the names the user wrote
  output = output.replace(/\blc_(malloc|calloc|realloc|free|strdup|strndup)\b/g, '$1');
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m = /^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning|note)\s*([A-Z]+\d+)?\s*:\s*(.*)$/.exec(line);
    if (m) {
      diags.push({
        file: path.basename(m[1]),
        line: Number(m[2]),
        col: m[3] ? Number(m[3]) : 1,
        severity: m[4].startsWith('warning') ? 'warning' : m[4] === 'note' ? 'note' : 'error',
        code: m[5] || '',
        message: m[6],
      });
      continue;
    }
    m = /^(.*?)\s*:\s*(fatal error|error|warning)\s+((?:LNK|D|C)\d+)\s*:\s*(.*)$/.exec(line);
    if (m) {
      diags.push({
        file: path.basename(m[1]),
        line: 0,
        col: 0,
        severity: m[2].includes('error') ? 'error' : 'warning',
        code: m[3],
        message: m[4],
      });
    }
  }
  return diags;
}

module.exports = { Msvc, parseDiagnostics, USER_FLAGS, LINK_FLAGS, RUNTIME_FLAGS };
