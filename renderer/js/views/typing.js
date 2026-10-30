// Typing practice: type the words C is made of, or real snippets from the
// lessons, and see your speed and accuracy. Letters light up as you type them
// correctly and turn red when you miss.

import { h, icon, toast } from '../util.js';
import { api } from '../state.js';
import { takePendingTyping } from '../actions.js';

const TIMES = [15, 30, 60, 120];
const COUNTS = [10, 25, 50, 100];
const LENGTHS = ['short', 'medium', 'long'];
const SVG = 'http://www.w3.org/2000/svg';

// Keywords, standard library names and everyday identifiers.
const WORDS = [
  'int', 'char', 'double', 'float', 'long', 'short', 'unsigned', 'signed', 'void', 'bool',
  'return', 'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'break', 'continue', 'default',
  'struct', 'typedef', 'enum', 'union', 'const', 'static', 'sizeof', 'extern', 'include', 'define',
  'printf', 'scanf', 'malloc', 'calloc', 'realloc', 'free', 'strlen', 'strcpy', 'strcmp', 'strcat',
  'memcpy', 'memset', 'fgets', 'puts', 'putchar', 'getchar', 'main', 'NULL', 'true', 'false',
  'size_t', 'stdio', 'stdlib', 'string', 'count', 'sum', 'total', 'index', 'length', 'size', 'value',
  'node', 'next', 'head', 'tail', 'left', 'right', 'result', 'buffer', 'temp', 'array', 'list', 'key',
  'data', 'ptr', 'str', 'len', 'capacity', 'min', 'max', 'average', 'score', 'name', 'age', 'grid',
  'row', 'col', 'word', 'line', 'item', 'first', 'last', 'start', 'end', 'prev', 'current', 'block',
  'bytes', 'stack', 'heap', 'frame', 'pointer', 'address', 'memory', 'copy', 'swap', 'square',
  'i', 'j', 'n', 'p', 'x', 'y',
];
// With "symbols" on, some words get the bits of C syntax that usually surround them.
const DECORATE = [
  (w) => `${w};`, (w) => `${w}()`, (w) => `${w}(x);`, (w) => `&${w}`, (w) => `*${w}`, (w) => `${w}[i]`,
  (w) => `${w}->next`, (w) => `${w}++`, (w) => `(${w})`, (w) => `"${w}"`, (w) => `${w}.x`, (w) => `!${w}`,
];
const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '{', '}', '->', '%d', '\\n', '#include', '<stdio.h>', 'NULL;', 'i++)', '0;'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function randomWord(prev, cfg) {
  if (cfg.numbers && Math.random() < 0.12) return String(Math.floor(Math.random() * (Math.random() < 0.5 ? 10 : 1000)));
  if (cfg.symbols && Math.random() < 0.1) return pick(OPERATORS);
  let w;
  do { w = pick(WORDS); } while (w === prev);
  return cfg.symbols && Math.random() < 0.3 ? pick(DECORATE)(w) : w;
}

function randomWords(n, cfg, prev = '') {
  const out = [];
  for (let i = 0; i < n; i++) out.push(prev = randomWord(prev, cfg));
  return out;
}

function testKey(cfg) {
  if (cfg.mode === 'code') return `code ${cfg.length}`;
  const extras = `${cfg.symbols ? ' symbols' : ''}${cfg.numbers ? ' numbers' : ''}`;
  return cfg.mode === 'time' ? `time ${cfg.time}${extras}` : `words ${cfg.count}${extras}`;
}

function chart(samples) {
  const W = 640, H = 210, L = 34, R = 8, T = 12, B = 26;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!samples.length) return svg;
  const top = Math.max(20, ...samples.map((s) => Math.max(s.wpm, s.burst))) * 1.12;
  const step = Math.max(1, Math.ceil(top / 4 / 10) * 10);
  const x = (i) => L + (samples.length === 1 ? (W - L - R) / 2 : (i / (samples.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  let body = '';
  for (let v = 0; v <= top; v += step) {
    body += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`;
  }
  const line = (key) => samples.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ');
  body += `<path d="${line('burst')}" class="raw"/><path d="${line('wpm')}" class="wpm"/>`;
  samples.forEach((s, i) => {
    if (s.errors) body += `<text x="${x(i)}" y="${T + 9}" class="err" text-anchor="middle">×</text>`;
  });
  body += `<text x="${L}" y="${H - 6}" class="axis">1s</text><text x="${W - R}" y="${H - 6}" class="axis" text-anchor="end">${samples[samples.length - 1].t}s</text>`;
  svg.innerHTML = body;
  return svg;
}

export function renderTyping(root) {
  let destroyed = false;
  let snippets = [];
  let saved = { settings: {}, best: {}, history: [] };
  let cfg = { mode: 'time', time: 30, count: 25, length: 'short', symbols: false, numbers: false };
  let test = null;
  let timer = null, endTimer = null;
  let snippetIndex = -1;

  // ------------------------------------------------------------- layout
  const bar = h('div', { class: 'ty-bar' });
  const live = h('div', { class: 'ty-live' });
  const caps = h('div', { class: 'ty-caps', style: { visibility: 'hidden' } }, icon('alert'), 'Caps Lock is on');
  const box = h('div', { class: 'ty-box' });
  const source = h('div', { class: 'ty-source' });
  const hint = h('div', { class: 'ty-hint' },
    h('kbd', null, 'Tab'), ' new test', h('span', { class: 'dot' }, '·'),
    h('kbd', null, 'Esc'), ' restart', h('span', { class: 'dot' }, '·'),
    h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Backspace'), ' delete a word');
  const stage = h('div', { class: 'ty-stage' }, h('div', { class: 'ty-top' }, live, caps), box, source);
  const results = h('div', { class: 'ty-results', style: { display: 'none' } });
  const page = h('div', { class: 'ty-page' }, bar, stage, results, hint);
  root.append(page);
  const caret = h('div', { class: 'ty-caret idle' });

  const persist = () => api.saveTyping(saved);

  // ------------------------------------------------------------- options bar
  function renderBar() {
    const opt = (label, on, fn) => h('button', {
      class: `ty-opt${on ? ' on' : ''}`,
      onclick: (e) => { fn(); e.currentTarget.blur(); persist(); renderBar(); newTest(false); },
    }, label);
    const sep = () => h('span', { class: 'sep' });
    const items = [
      opt('time', cfg.mode === 'time', () => { cfg.mode = 'time'; }),
      opt('words', cfg.mode === 'words', () => { cfg.mode = 'words'; }),
      opt('code', cfg.mode === 'code', () => { cfg.mode = 'code'; }),
      sep(),
    ];
    if (cfg.mode === 'time') items.push(...TIMES.map((t) => opt(String(t), cfg.time === t, () => { cfg.time = t; })));
    if (cfg.mode === 'words') items.push(...COUNTS.map((n) => opt(String(n), cfg.count === n, () => { cfg.count = n; })));
    if (cfg.mode === 'code') items.push(...LENGTHS.map((l) => opt(l, cfg.length === l, () => { cfg.length = l; })));
    if (cfg.mode !== 'code') {
      items.push(sep(),
        opt('symbols', cfg.symbols, () => { cfg.symbols = !cfg.symbols; }),
        opt('numbers', cfg.numbers, () => { cfg.numbers = !cfg.numbers; }));
    }
    items.push(sep(), h('button', {
      class: 'ty-opt choose',
      title: 'Pick a snippet from a lesson, or paste your own code',
      onclick: (e) => { e.currentTarget.blur(); openChooser(); },
    }, icon('list'), 'choose…'));
    bar.replaceChildren(...items);
  }

  // ------------------------------------------------------------- choosing a text
  function startSnippet(snippet) {
    cfg.mode = 'code';
    persist();
    renderBar();
    newTest(false, snippet);
  }

  async function startCustom(code, source, href, keepComments) {
    const prepared = await api.prepareTyping(code, keepComments);
    if (destroyed) return;
    if (!prepared.code) {
      toast('There is nothing to type in that text.', 'bad');
      return;
    }
    startSnippet({ source, href, length: prepared.length, code: prepared.code });
  }

  function openChooser() {
    const close = () => { backdrop.remove(); window.removeEventListener('keydown', onEsc, true); };
    const onEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    // the first lines that tell snippets apart (every program starts the same way)
    const boring = /^(#include\b.*|int main\(void\) \{|[{}];?|return 0;)$/;
    const preview = (code) => {
      const lines = code.split('\n').map((l) => l.trim());
      const telling = lines.filter((l) => !boring.test(l));
      const text = (telling.length ? telling : lines).slice(0, 2).join('   ');
      return text.length > 80 ? `${text.slice(0, 79)}…` : text;
    };
    const groups = new Map();
    for (const s of snippets) {
      if (!groups.has(s.source)) groups.set(s.source, []);
      groups.get(s.source).push(s);
    }
    const area = h('textarea', { class: 'input ty-paste', spellcheck: 'false', placeholder: 'Paste any code here, for example a solution you wrote…' });
    const keep = h('input', { type: 'checkbox' });
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
      h('div', { class: 'modal ty-choose', style: { width: 'min(760px, calc(100vw - 40px))' } },
        h('div', { class: 'modal-head' }, h('h2', null, 'Choose what to type'),
          h('button', { class: 'btn ghost icon-only', title: 'Close (Esc)', onclick: close }, icon('x'))),
        h('div', { class: 'modal-body' },
          h('div', { class: 'modal-section' },
            h('h3', null, 'From the lessons and examples'),
            h('div', { class: 'ty-choose-list' }, [...groups].map(([src, items]) => h('div', { class: 'ty-choose-group' },
              h('div', { class: 'ty-choose-src' }, src),
              items.map((s) => h('button', { class: 'ty-choose-item', onclick: () => { close(); startSnippet(s); } },
                h('code', null, preview(s.code)),
                h('span', { class: 'meta' }, `${s.code.split('\n').length} lines`))))))),
          h('div', { class: 'modal-section' },
            h('h3', null, 'Your own code'),
            area,
            h('div', { class: 'ty-paste-row' },
              h('label', null, keep, 'Keep comments'),
              h('button', {
                class: 'btn primary',
                onclick: () => {
                  if (!area.value.trim()) { area.focus(); return; }
                  close();
                  startCustom(area.value, 'your own code', null, keep.checked);
                },
              }, icon('keyboard'), 'Type this'))))));
    window.addEventListener('keydown', onEsc, true);
    document.body.append(backdrop);
  }

  // ------------------------------------------------------------- tests
  function stopTimers() {
    clearInterval(timer);
    clearTimeout(endTimer);
    timer = endTimer = null;
  }

  function nextSnippet() {
    const pool = snippets.map((s, i) => i).filter((i) => snippets[i].length === cfg.length);
    if (!pool.length) return null;
    let i;
    do { i = pick(pool); } while (pool.length > 1 && i === snippetIndex);
    snippetIndex = i;
    return snippets[i];
  }

  // A fresh test; `same` repeats the current text, `chosen` is a snippet to type.
  function newTest(same, chosen = null) {
    stopTimers();
    page.classList.remove('typing');
    results.style.display = 'none';
    stage.style.display = '';
    hint.style.display = '';
    const keep = same && test ? test : null;
    test = {
      kind: cfg.mode === 'code' ? 'code' : 'words',
      key: testKey(cfg),
      started: false, finished: false, startAt: 0,
      keys: { total: 0, correct: 0 }, samples: [], secondErrors: 0, lastTyped: 0,
    };
    if (test.kind === 'code') {
      test.snippet = chosen || (keep && keep.snippet) || nextSnippet();
      if (test.snippet) test.key = `code ${test.snippet.length}`;    // a chosen snippet counts towards its length
      test.text = test.snippet ? test.snippet.code : '';
      test.state = new Uint8Array(test.text.length);    // 0 untyped, 1 right, 2 wrong, 3 filled in (indentation)
      test.pos = 0;
      skipIndent();
    } else {
      test.words = keep && keep.words ? keep.words.slice(0, cfg.mode === 'words' ? cfg.count : keep.words.length)
        : randomWords(cfg.mode === 'words' ? cfg.count : 100, cfg);
      test.inputs = [''];
      test.wi = 0;
    }
    renderStage();
  }

  function start() {
    test.started = true;
    test.startAt = performance.now();
    page.classList.add('typing');
    caret.classList.remove('idle');
    timer = setInterval(tick, 1000);
    if (cfg.mode === 'time') endTimer = setTimeout(finish, cfg.time * 1000);
  }

  function elapsed() {
    return ((test.finished ? test.endAt : performance.now()) - test.startAt) / 1000;
  }

  // Characters typed (`typed`), and those that count towards the speed (`net`).
  function counts() {
    const c = { correct: 0, incorrect: 0, extra: 0, missed: 0, typed: 0, net: 0 };
    if (test.kind === 'code') {
      for (const s of test.state) {
        if (s === 1) { c.correct++; c.net++; c.typed++; } else if (s === 2) { c.incorrect++; c.typed++; }
      }
      return c;
    }
    for (let i = 0; i <= test.wi && i < test.words.length; i++) {
      const w = test.words[i], inp = test.inputs[i] || '', done = i < test.wi;
      c.typed += inp.length + (done ? 1 : 0);
      for (let k = 0; k < Math.max(w.length, inp.length); k++) {
        if (k >= inp.length) { if (done) c.missed++; } else if (k >= w.length) c.extra++;
        else if (inp[k] === w[k]) c.correct++;
        else c.incorrect++;
      }
      if (inp === w) c.net += w.length + (done ? 1 : 0);
      else if (!done && w.startsWith(inp)) c.net += inp.length;    // the word in progress when time ran out
    }
    return c;
  }

  function tick() {
    if (!test.started || test.finished) return;
    const secs = elapsed();
    const c = counts();
    test.samples.push({
      t: test.samples.length + 1,
      wpm: (c.net / 5) / (secs / 60),
      burst: (c.typed - test.lastTyped) * 12,
      errors: test.secondErrors,
    });
    test.lastTyped = c.typed;
    test.secondErrors = 0;
    renderLive();
  }

  function finish() {
    if (test.finished) return;
    if (!test.started) return;
    test.finished = true;
    test.endAt = performance.now();
    const partial = elapsed() - test.samples.length;
    if (partial > 0.25 || !test.samples.length) {     // the last, partial second
      const c = counts();
      test.samples.push({
        t: test.samples.length + 1,
        wpm: (c.net / 5) / (elapsed() / 60),
        burst: ((c.typed - test.lastTyped) * 12) / Math.max(partial, 0.25),
        errors: test.secondErrors,
      });
    }
    stopTimers();
    page.classList.remove('typing');
    showResults();
  }

  // ------------------------------------------------------------- typing
  function skipIndent() {
    const atLineStart = test.pos === 0 || test.text[test.pos - 1] === '\n';
    if (!atLineStart) return;
    while (test.text[test.pos] === ' ') test.state[test.pos++] = 3;
  }

  function typeChar(ch) {
    if (!test || test.finished) return;
    if (!test.started) start();
    if (test.kind === 'code') {
      if (test.pos >= test.text.length) return;
      const ok = test.text[test.pos] === ch;
      test.keys.total++;
      if (ok) test.keys.correct++; else test.secondErrors++;
      test.state[test.pos++] = ok ? 1 : 2;
      skipIndent();
      if (test.pos >= test.text.length) finish();
      else updateCode();
      return;
    }
    const word = test.words[test.wi], cur = test.inputs[test.wi];
    if (ch === ' ') {
      if (!cur) return;                                  // a space before the word: ignore it
      test.keys.total++;
      if (cur === word) test.keys.correct++; else test.secondErrors++;
      test.wi++;
      test.inputs[test.wi] = test.inputs[test.wi] || '';
      if (test.wi >= test.words.length) { finish(); return; }
      if (cfg.mode === 'time' && test.words.length - test.wi < 40) addWords(50);
      updateWords(test.wi - 1);
      return;
    }
    if (cur.length >= word.length + 10) return;          // too many extra letters
    test.keys.total++;
    if (cur.length < word.length && word[cur.length] === ch) test.keys.correct++; else test.secondErrors++;
    test.inputs[test.wi] = cur + ch;
    if (cfg.mode === 'words' && test.wi === test.words.length - 1 && test.inputs[test.wi] === word) { finish(); return; }
    updateWords(test.wi);
  }

  function backspace(wholeWord) {
    if (!test || test.finished) return;
    if (test.kind === 'code') {
      const back = () => {
        if (test.pos === 0) return false;
        test.pos--;
        while (test.pos > 0 && test.state[test.pos] === 3) test.state[test.pos--] = 0;
        test.state[test.pos] = 0;
        return true;
      };
      if (!back()) return;
      if (wholeWord) {
        while (test.pos > 0 && !/\s/.test(test.text[test.pos - 1]) && back());
      }
      updateCode();
      return;
    }
    if (test.inputs[test.wi]) {
      test.inputs[test.wi] = wholeWord ? '' : test.inputs[test.wi].slice(0, -1);
    } else if (test.wi > 0 && test.inputs[test.wi - 1] !== test.words[test.wi - 1]) {
      test.wi--;                                         // back into a word you got wrong
      if (wholeWord) test.inputs[test.wi] = '';
      updateWords(test.wi + 1);
    } else {
      return;
    }
    updateWords(test.wi);
  }

  // ------------------------------------------------------------- rendering
  let wordEls = [], inner = null, charEls = [], codeEl = null;

  function renderStage() {
    caret.classList.add('idle');
    if (test.kind === 'code') {
      if (!test.snippet) {
        box.replaceChildren(h('div', { class: 'viz-empty' }, 'No snippets of this length.'));
        return;
      }
      codeEl = h('pre', { class: 'ty-code' });
      charEls = [...test.text].map((ch) => (ch === '\n' ? h('span', { class: 'nl' }, '↵\n') : h('span', null, ch)));
      codeEl.append(...charEls);
      box.replaceChildren(codeEl, caret);
      const s = test.snippet;
      source.replaceChildren('from ', s.href ? h('a', { href: s.href }, s.source) : s.source);
      updateCode();
    } else {
      inner = h('div', { class: 'ty-inner' });
      wordEls = test.words.map(() => h('div', { class: 'ty-word' }));
      inner.append(...wordEls);
      box.replaceChildren(h('div', { class: 'ty-words' }, inner), caret);
      source.replaceChildren();
      test.words.forEach((_, i) => fillWord(i));
      placeCaret();
    }
    renderLive();
  }

  function addWords(n) {
    const more = randomWords(n, cfg, test.words[test.words.length - 1]);
    for (const w of more) {
      test.words.push(w);
      const el = h('div', { class: 'ty-word' });
      wordEls.push(el);
      inner.append(el);
      fillWord(wordEls.length - 1);
    }
  }

  function fillWord(i) {
    const w = test.words[i], inp = test.inputs[i] || '';
    const letters = [];
    for (let k = 0; k < Math.max(w.length, inp.length); k++) {
      const cls = k >= inp.length ? '' : k >= w.length ? 'extra' : inp[k] === w[k] ? 'ok' : 'bad';
      letters.push(h('span', { class: cls }, k < w.length ? w[k] : inp[k]));
    }
    wordEls[i].replaceChildren(...letters);
    wordEls[i].classList.toggle('err', i < test.wi && inp !== w);
  }

  function updateWords(i) {
    fillWord(i);
    if (i !== test.wi) fillWord(test.wi);
    placeCaret();
    renderLive();
  }

  function updateCode() {
    const cls = ['', 'ok', 'bad', 'auto'];
    test.state.forEach((s, k) => {
      const want = `${test.text[k] === '\n' ? 'nl ' : ''}${cls[s]}`.trim();
      if (charEls[k].className !== want) charEls[k].className = want;
    });
    placeCaret();
    renderLive();
  }

  function placeCaret() {
    const boxRect = box.getBoundingClientRect();
    let r, atEnd = false;
    if (test.kind === 'code') {
      const el = charEls[Math.min(test.pos, charEls.length - 1)];
      if (!el) return;
      atEnd = test.pos >= charEls.length;
      // keep the line being typed away from the bottom edge
      const lineH = parseFloat(getComputedStyle(codeEl).lineHeight);
      const below = el.offsetTop - codeEl.scrollTop - (codeEl.clientHeight - 3 * lineH);
      if (below > 0) codeEl.scrollTop += below;
      if (el.offsetTop < codeEl.scrollTop) codeEl.scrollTop = el.offsetTop;
      // and a long line's caret away from the right edge
      if (el.offsetLeft - codeEl.scrollLeft > codeEl.clientWidth - 60) codeEl.scrollLeft = el.offsetLeft - codeEl.clientWidth + 160;
      else if (el.offsetLeft < codeEl.scrollLeft + 20) codeEl.scrollLeft = Math.max(0, el.offsetLeft - 80);
      r = el.getBoundingClientRect();
    } else {
      // keep the current line second from the top
      const word = wordEls[test.wi];
      if (!word) return;
      const pitch = word.offsetHeight;
      const line = Math.round(word.offsetTop / pitch);
      inner.style.transform = `translateY(${-Math.max(0, line - 1) * pitch}px)`;
      const typed = test.inputs[test.wi].length;
      const letters = word.children;
      atEnd = typed > 0;
      r = (atEnd ? letters[Math.min(typed, letters.length) - 1] : letters[0] || word).getBoundingClientRect();
    }
    caret.style.height = `${r.height * 0.82}px`;
    caret.style.transform = `translate(${(atEnd ? r.right : r.left) - boxRect.left - 1}px, ${r.top - boxRect.top + r.height * 0.09}px)`;
  }

  function renderLive() {
    if (!test) return;
    let text;
    if (cfg.mode === 'time') text = String(test.started ? Math.max(0, Math.ceil(cfg.time - elapsed())) : cfg.time);
    else if (test.kind === 'words') text = `${test.wi}/${test.words.length}`;
    else {
      const lines = test.text.split('\n').length;
      const done = test.text.slice(0, test.pos).split('\n').length;
      text = `${Math.min(done, lines)}/${lines} lines`;
    }
    live.textContent = text;
  }

  // ------------------------------------------------------------- results
  function showResults() {
    const secs = elapsed();
    const c = counts();
    const wpm = (c.net / 5) / (secs / 60);
    const raw = (c.typed / 5) / (secs / 60);
    const acc = test.keys.total ? (test.keys.correct / test.keys.total) * 100 : 0;
    const bursts = test.samples.map((s) => s.burst);
    const mean = bursts.reduce((a, b) => a + b, 0) / (bursts.length || 1);
    const sd = Math.sqrt(bursts.reduce((a, b) => a + (b - mean) ** 2, 0) / (bursts.length || 1));
    const consistency = mean ? Math.max(0, 100 - (sd / mean) * 100) : 0;

    const prev = saved.best[test.key];
    const record = c.net > 0;
    const isBest = record && (!prev || wpm > prev.wpm);
    if (record) {
      const entry = { key: test.key, wpm: Math.round(wpm), raw: Math.round(raw), acc: Math.round(acc), seconds: Math.round(secs), date: Date.now() };
      if (isBest) saved.best[test.key] = entry;
      saved.history = [entry, ...(saved.history || [])].slice(0, 200);
      persist();
    }
    const recent = (saved.history || []).filter((e) => e.key === test.key).slice(0, 10);
    const average = recent.length ? Math.round(recent.reduce((a, e) => a + e.wpm, 0) / recent.length) : null;

    const big = (label, value) => h('div', { class: 'ty-big' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
    const stat = (label, value, title) => h('div', { class: 'ty-stat', title }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
    const best = saved.best[test.key];
    results.replaceChildren(
      h('div', { class: 'ty-bigs' }, big('wpm', String(Math.round(wpm))), big('acc', `${Math.round(acc)}%`)),
      h('div', { class: 'ty-chart' }, chart(test.samples),
        h('div', { class: 'ty-legend' }, h('span', { class: 'k wpm' }), 'wpm', h('span', { class: 'k raw' }), 'raw', h('span', { class: 'k err' }, '×'), 'errors')),
      h('div', { class: 'ty-stats' },
        stat('test', test.key + (test.kind === 'code' && test.snippet ? ` · ${test.snippet.source}` : '')),
        stat('raw', String(Math.round(raw)), 'Speed counting every character you typed, mistakes included'),
        stat('characters', `${c.correct}/${c.incorrect}/${c.extra}/${c.missed}`, 'correct / incorrect / extra / missed'),
        stat('consistency', `${Math.round(consistency)}%`, 'How steady your speed was from second to second'),
        stat('time', `${Math.round(secs)}s`),
        best ? stat('personal best', `${best.wpm} wpm`, `${best.acc}% accuracy`) : null,
        average !== null && recent.length > 1 ? stat(`average of last ${recent.length}`, `${average} wpm`) : null),
      isBest ? h('div', { class: 'ty-pb' }, icon('flame'), prev ? `New personal best! (was ${prev.wpm} wpm)` : 'First result for this test: a personal best to beat.') : null,
      h('div', { class: 'ty-actions' },
        h('button', { class: 'btn primary', onclick: () => newTest(false) }, icon('right'), 'Next test'),
        h('button', { class: 'btn', onclick: () => newTest(true) }, icon('reset'), 'Repeat this text')),
    );
    stage.style.display = 'none';
    results.style.display = '';
  }

  // ------------------------------------------------------------- keys
  function onKey(e) {
    if (destroyed || !test) return;
    if (document.querySelector('.modal-backdrop')) return;
    const target = e.target;
    if (target && target.closest && target.closest('input, textarea, select')) return;
    caps.style.visibility = e.getModifierState && e.getModifierState('CapsLock') ? 'visible' : 'hidden';
    if (e.key === 'Tab') { e.preventDefault(); newTest(false); return; }
    if (e.key === 'Escape') { e.preventDefault(); newTest(true); return; }
    if (test.finished) {
      if (e.key === 'Enter') { e.preventDefault(); newTest(false); }
      return;
    }
    const altGr = e.ctrlKey && e.altKey;                 // AltGr types { [ ] } on many layouts
    if (e.key === 'Backspace') { e.preventDefault(); backspace(e.ctrlKey && !altGr); return; }
    if (!altGr && (e.ctrlKey || e.metaKey || e.altKey)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (test.kind === 'code') typeChar('\n');
      return;
    }
    if (e.key.length !== 1) return;
    e.preventDefault();
    typeChar(e.key);
  }
  window.addEventListener('keydown', onKey);
  const onMouse = () => page.classList.remove('typing');
  page.addEventListener('mousemove', onMouse);
  const resizeObserver = new ResizeObserver(() => { if (test && !test.finished) placeCaret(); });
  resizeObserver.observe(box);

  (async () => {
    const data = await api.getTyping();
    if (destroyed) return;
    snippets = data.snippets || [];
    if (data.state) saved = { settings: {}, best: {}, history: [], ...data.state };
    cfg = { ...cfg, ...saved.settings };
    saved.settings = cfg;
    renderBar();
    const pending = takePendingTyping();      // a lesson's "Type it" button
    if (pending) startCustom(pending.code, pending.source, pending.href, false);
    else newTest(false);
  })();

  return {
    destroy() {
      destroyed = true;
      stopTimers();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKey);
    },
  };
}
