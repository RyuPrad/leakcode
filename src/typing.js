'use strict';
// Code snippets for typing practice, taken from the lessons and the
// visualizer and playground examples. Comments and blank lines are dropped:
// the point is to practise C's syntax, not to retype the explanations.

const BUGGY_LESSONS = new Set(['memory-bugs']);                  // all of its code is broken on purpose
const BUGGY_EXAMPLES = new Set(['leak', 'dangling', 'overflow', 'uaf', 'double-free', 'uninit', 'stack-array', 'null', 'recursion']);

// Removes // and /* */ comments from one line, leaving string and character
// literals alone. `open` tells whether a /* comment continues on the next line.
function stripComments(line, inBlock) {
  let out = '', quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inBlock) {
      if (c === '*' && line[i + 1] === '/') { inBlock = false; i++; }
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < line.length) out += line[++i];
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && line[i + 1] === '/') {
      break;
    } else if (c === '/' && line[i + 1] === '*') {
      inBlock = true;
      i++;
    } else {
      out += c;
    }
  }
  return { text: out, open: inBlock };
}

// Tabs become spaces; comments (unless kept), trailing spaces, blank lines and
// the indentation all lines share are removed.
function cleanCode(code, keepComments = false) {
  const lines = [];
  let inBlock = false;
  for (const raw of code.replace(/\r/g, '').replace(/\t/g, '    ').split('\n')) {
    const r = keepComments ? { text: raw, open: false } : stripComments(raw, inBlock);
    inBlock = r.open;
    const line = r.text.replace(/\s+$/, '');
    if (line.trim()) lines.push(line);
  }
  if (!lines.length) return '';
  const indent = Math.min(...lines.map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

function lengthOf(lines) {
  return lines <= 6 ? 'short' : lines <= 14 ? 'medium' : 'long';
}

// A text the user picked (a lesson's code block, a solution, pasted code).
function prepareText(code, keepComments) {
  const text = cleanCode(String(code || ''), keepComments);
  return { code: text, length: lengthOf(text ? text.split('\n').length : 0) };
}

// [{ id, source, length, code }]: every distinct, typeable C snippet.
function typingSnippets(lessons, vizExamples, playgroundExamples) {
  const raw = [];
  for (const l of lessons) {
    if (BUGGY_LESSONS.has(l.id)) continue;
    const re = /```c\n([\s\S]*?)```/g;
    let m, k = 0;
    while ((m = re.exec(l.body))) raw.push({ id: `${l.id}-${++k}`, source: `Lesson ${l.number}: ${l.title}`, href: `#/learn/${l.id}`, code: m[1] });
  }
  for (const e of vizExamples) {
    if (!BUGGY_EXAMPLES.has(e.id)) raw.push({ id: `viz-${e.id}`, source: `Visualizer example: ${e.title}`, code: e.code });
  }
  for (const e of playgroundExamples) {
    if (!BUGGY_EXAMPLES.has(e.id)) raw.push({ id: `play-${e.id}`, source: `Playground example: ${e.title}`, code: e.code });
  }
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    if (/\bforgot\b|\bbug\b/i.test(s.code)) continue;    // a lesson's deliberately broken example
    const code = cleanCode(s.code);
    const lines = code.split('\n');
    if (lines.length < 2 || code.length < 24 || seen.has(code) || /[^\x20-\x7e\n]/.test(code)) continue;
    if (lines.some((l) => l.length > 76)) continue;      // would run off the screen
    const count = lines.length;
    seen.add(code);
    out.push({ id: s.id, source: s.source, href: s.href || null, length: lengthOf(count), code });
  }
  return out;
}

module.exports = { typingSnippets, cleanCode, prepareText };
