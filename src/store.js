'use strict';
// Persists progress, drafts, settings and submissions as JSON files in the
// app's user-data folder. Writes are debounced and atomic (temp file + rename).

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'dark',
  fontSize: 14,
  tabSize: 4,
  minimap: false,
  wordWrap: false,
};
const MAX_SUBMISSIONS_PER_PROBLEM = 30;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.file = path.join(dir, 'leakcode-data.json');
    this.subFile = path.join(dir, 'submissions.json');
    const data = readJson(this.file, {});
    this.data = {
      progress: data.progress || {},
      drafts: data.drafts || {},
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
      playground: data.playground || null,
      activity: data.activity || {},
      testcases: data.testcases || {},
      lessonsRead: data.lessonsRead || {},
    };
    this.submissions = readJson(this.subFile, {});
    this.timers = {};
  }

  scheduleSave(which = 'data') {
    clearTimeout(this.timers[which]);
    this.timers[which] = setTimeout(() => this.flush(which), 400);
  }

  flush(which) {
    const targets = which ? [which] : ['data', 'subs'];
    for (const t of targets) {
      clearTimeout(this.timers[t]);
      try {
        if (t === 'data') writeJsonAtomic(this.file, this.data);
        else writeJsonAtomic(this.subFile, this.submissions);
      } catch (e) {
        console.error('Saving failed:', e);
      }
    }
  }

  get settings() { return this.data.settings; }

  setSettings(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (k in DEFAULT_SETTINGS) this.data.settings[k] = v;
    }
    this.scheduleSave();
    return this.data.settings;
  }

  draft(id) { return this.data.drafts[id]; }

  saveDraft(id, code) {
    if (code === null) delete this.data.drafts[id];
    else this.data.drafts[id] = code;
    this.scheduleSave();
  }

  testcases(id) { return this.data.testcases[id]; }

  saveTestcases(id, cases) {
    if (!cases) delete this.data.testcases[id];
    else this.data.testcases[id] = cases;
    this.scheduleSave();
  }

  // Records a Run (submit=false) or a Submit and updates the problem status.
  record(id, result, code, submit) {
    const p = this.data.progress[id] || { status: 'todo', attempts: 0 };
    const accepted = result.verdict === 'accepted';
    if (p.status !== 'solved') p.status = submit && accepted ? 'solved' : 'attempted';
    p.lastActivity = Date.now();
    const day = today();
    const act = this.data.activity[day] || { runs: 0, submits: 0, accepted: 0 };
    if (submit) {
      p.attempts += 1;
      act.submits += 1;
      if (accepted) {
        act.accepted += 1;
        if (!p.solvedAt) p.solvedAt = Date.now();
        if (p.bestRuntimeMs === undefined || result.runtimeMs < p.bestRuntimeMs) p.bestRuntimeMs = result.runtimeMs;
        if (p.bestPeakBytes === undefined || result.peakBytes < p.bestPeakBytes) p.bestPeakBytes = result.peakBytes;
      }
      const list = this.submissions[id] || [];
      list.unshift({
        time: Date.now(), verdict: result.verdict, passed: result.passed, total: result.total,
        runtimeMs: result.runtimeMs, peakBytes: result.peakBytes, allocs: result.allocs, code,
      });
      this.submissions[id] = list.slice(0, MAX_SUBMISSIONS_PER_PROBLEM);
      this.scheduleSave('subs');
    } else {
      act.runs += 1;
    }
    this.data.activity[day] = act;
    this.data.progress[id] = p;
    this.scheduleSave();
    return p;
  }

  markLessonRead(id) {
    this.data.lessonsRead[id] = Date.now();
    this.scheduleSave();
  }

  savePlayground(state) {
    this.data.playground = state;
    this.scheduleSave();
  }

  resetProgress() {
    this.data.progress = {};
    this.data.drafts = {};
    this.data.activity = {};
    this.data.testcases = {};
    this.data.lessonsRead = {};
    this.submissions = {};
    this.flush();
  }
}

module.exports = { Store };
