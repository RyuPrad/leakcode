// The problem workspace: description, editor, test cases and results.

import {
  h, icon, clear, diffClass, fmtBytes, fmtMs, timeAgo, plural, toast, debounce,
  makeResizable, confirmDialog, celebrate,
} from '../util.js';
import { state, api, emit, neighbours, problemStatus } from '../state.js';
import { createEditor, setCompileMarkers, setRuntimeMarks, clearMarks, revealLine } from '../editor.js';
import { renderMarkdown, codeBlock } from '../markdown.js';
import { renderFatal, renderLeaks, renderDiagnostics, marksFor, VERDICTS } from '../diagnose.js';
import { openSettings } from './settings.js';

const MAX_CASES = 8;

const PLACEHOLDER = {
  int: '42', long: '42', double: '3.5', bool: 'true', string: '"hello"', 'string?': '"hello" or null', char: '"a"',
  'int[]': '[1,2,3]', list: '[1,2,3]', 'string[]': '["a","b"]', 'int[][]': '[[1,2],[3,4]]', tree: '[4,2,7,1,3]',
};

function validateValue(type, text) {
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return 'Not valid JSON. Strings need "double quotes", arrays look like [1,2,3].';
  }
  const isInt = (x) => Number.isInteger(x);
  switch (type) {
    case 'int': return isInt(v) && Math.abs(v) <= 2147483648 ? null : 'Expected a 32-bit integer.';
    case 'long': return isInt(v) ? null : 'Expected an integer.';
    case 'double': return typeof v === 'number' ? null : 'Expected a number.';
    case 'bool': return typeof v === 'boolean' ? null : 'Expected true or false.';
    case 'string': return typeof v === 'string' ? null : 'Expected a string in double quotes.';
    case 'string?': return v === null || typeof v === 'string' ? null : 'Expected a string or null.';
    case 'char': return typeof v === 'string' && v.length === 1 ? null : 'Expected a one-character string like "a".';
    case 'int[]':
    case 'list': return Array.isArray(v) && v.every(isInt) ? null : 'Expected an array of integers like [1,2,3].';
    case 'string[]': return Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : 'Expected an array of strings like ["a","b"].';
    case 'int[][]': return Array.isArray(v) && v.every((r) => Array.isArray(r) && r.every(isInt)) ? null : 'Expected a 2D array like [[1,2],[3,4]].';
    case 'tree': return Array.isArray(v) && v.every((x) => x === null || isInt(x)) ? null : 'Expected a level-order array like [4,2,7,null,3].';
    default: return null;
  }
}

function formatInput(params, values) {
  const parts = params.map((p, i) => `${p.name} = ${values[i]}`);
  return parts.join(', ').length > 70 ? parts.join('\n') : parts.join(', ');
}

function io(label, text, cls = '') {
  const empty = text === '' || text === null || text === undefined;
  return h('div', { class: 'io' },
    h('div', { class: 'io-label' }, label),
    h('pre', { class: `${cls}${empty ? ' empty-out' : ''}` }, empty ? '(empty)' : text));
}

export function renderProblem(root, id) {
  let problem = null;
  let editor = null;
  let destroyed = false;
  let cases = [];
  let activeCase = 0;
  let consoleTab = 'testcase';
  let leftTab = 'description';
  let last = null;            // { mode, result }
  let resultCase = 0;
  let busy = false;
  let solutionRevealed = false;
  let openSubmission = null;

  const leftHead = h('div', { class: 'pane-head' });
  const leftBody = h('div', { class: 'pane-body padded' });
  const left = h('div', { class: 'pane pane-left' }, leftHead, leftBody);
  const gutterV = h('div', { class: 'gutter v' });
  const editorHost = h('div', { class: 'editor-host' });
  const runBtn = h('button', { class: 'btn', title: 'Run on the test cases below (Ctrl+\')', onclick: () => doRun() });
  const submitBtn = h('button', { class: 'btn success', title: 'Submit against all hidden tests (Ctrl+Enter)', onclick: () => doSubmit() });
  const resetBtn = h('button', { class: 'btn ghost icon-only', title: 'Reset to the starter code', onclick: () => resetCode() }, icon('reset'));
  const editorPane = h('div', { class: 'pane pane-editor' },
    h('div', { class: 'pane-head editor-head' },
      h('span', { class: 'lang' }, icon('code'), 'C17 · MSVC'),
      h('div', { class: 'grow' }),
      resetBtn,
      h('div', { class: 'run-bar' }, runBtn, submitBtn)),
    editorHost);
  const gutterH = h('div', { class: 'gutter h' });
  const consoleHead = h('div', { class: 'pane-head' });
  const consoleBody = h('div', { class: 'pane-body padded' });
  const consolePane = h('div', { class: 'pane pane-console' }, consoleHead, consoleBody);
  const rightCol = h('div', { class: 'right-col' }, editorPane, gutterH, consolePane);
  const workspace = h('div', { class: 'workspace' }, left, gutterV, rightCol);
  root.append(workspace);
  makeResizable(gutterV, left, { axis: 'x', min: 320, max: () => workspace.clientWidth - 420, key: 'lc.leftWidth' });
  makeResizable(gutterH, consolePane, { axis: 'y', min: 110, max: () => rightCol.clientHeight - 150, invert: true, key: 'lc.consoleHeight' });

  const saveDraft = debounce((code) => api.saveDraft(id, code), 600);
  const saveCases = debounce(() => api.saveTestcases(id, cases), 600);
  const onGoto = (line) => editor && revealLine(editor, line);

  function setBusy(v, which) {
    busy = v;
    clear(runBtn).append(v && which === 'run' ? h('span', { class: 'spinner' }) : icon('play'), 'Run');
    clear(submitBtn).append(v && which === 'submit' ? h('span', { class: 'spinner' }) : icon('upload'), 'Submit');
    runBtn.disabled = v;
    submitBtn.disabled = v;
  }
  setBusy(false);

  // ------------------------------------------------------------ left pane

  function renderLeftHead() {
    clear(leftHead);
    const tab = (key, label, ic) => h('button', {
      class: `tab${leftTab === key ? ' active' : ''}`,
      onclick: () => { leftTab = key; openSubmission = null; renderLeftHead(); renderLeft(); },
    }, icon(ic), label);
    const { prev, next } = neighbours(id);
    leftHead.append(
      tab('description', 'Description', 'file'),
      tab('hints', 'Hints', 'bulb'),
      tab('solution', 'Solution', 'book'),
      tab('submissions', 'Submissions', 'history'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost sm icon-only', title: 'Problem list', onclick: () => { location.hash = '#/practice'; } }, icon('list')),
      h('button', { class: 'btn ghost sm icon-only', title: prev ? `Previous: ${prev.title}` : '', disabled: !prev, onclick: () => { location.hash = `#/problem/${prev.id}`; } }, icon('left')),
      h('button', { class: 'btn ghost sm icon-only', title: next ? `Next: ${next.title}` : '', disabled: !next, onclick: () => { location.hash = `#/problem/${next.id}`; } }, icon('right')));
  }

  function descriptionView() {
    const p = problem;
    const status = problemStatus(id);
    return [
      h('h1', { class: 'desc-title' }, `${p.number}. ${p.title}`),
      h('div', { class: 'desc-meta' },
        h('span', { class: `diff-pill ${diffClass(p.difficulty)}` }, p.difficulty),
        p.kind === 'bughunt' ? h('span', { class: 'chip', style: { color: 'var(--red)' } }, icon('bug'), ' Bug hunt') : null,
        status === 'solved' ? h('span', { class: 'solved-tag' }, icon('check'), 'Solved') : status === 'attempted' ? h('span', { class: 'chip' }, 'Attempted') : null,
        p.topics.filter((t) => !(p.kind === 'bughunt' && t === 'Bug hunt')).map((t) => h('span', { class: 'chip' }, t))),
      renderMarkdown(p.description),
      p.examples.map((e, i) => h('div', { class: 'example' },
        h('h4', null, `Example ${i + 1}`),
        h('pre', null,
          h('b', null, 'Input: '), formatInput(p.params, e.input), '\n',
          h('b', null, 'Output: '), e.output,
          e.explanation ? ['\n', h('b', null, 'Explanation: '), e.explanation] : null))),
      p.constraints.length ? h('div', { class: 'md' },
        h('h3', null, 'Constraints'),
        h('ul', null, p.constraints.map((c) => h('li', null, h('code', null, c))))) : null,
      p.memory ? h('div', { class: 'callout memory' },
        h('div', { class: 'callout-title' }, icon('chip'), 'Memory contract'), renderMarkdown(p.memory)) : null,
      p.prelude.trim() ? h('details', { class: 'prelude' },
        h('summary', null, 'Declarations provided by the test harness'),
        codeBlock(p.prelude.trim())) : null,
    ];
  }

  function hintsView() {
    if (!problem.hints.length) return h('div', { class: 'locked' }, 'No hints for this one.');
    return [
      h('p', { style: { color: 'var(--text-dim)', marginTop: 0 } }, 'Stuck? Reveal one hint at a time.'),
      problem.hints.map((text, i) => {
        const body = h('div', { class: 'hint-body', style: { display: 'none' } }, renderMarkdown(text));
        const btn = h('button', {
          onclick: () => {
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : 'block';
          },
        }, icon('bulb'), `Hint ${i + 1}`);
        return h('div', { class: 'hint' }, btn, body);
      }),
    ];
  }

  async function solutionView() {
    if (!solutionRevealed) {
      return h('div', { class: 'locked' },
        icon('lock'),
        h('p', null, 'The editorial and reference solution unlock when you solve the problem.'),
        h('button', {
          class: 'btn',
          onclick: async () => {
            if (await confirmDialog('Show the solution?', 'Struggling with a problem is where most of the learning happens. Try the hints first?', 'Show solution')) {
              solutionRevealed = true;
              renderLeft();
            }
          },
        }, 'Show it anyway'));
    }
    const sol = await api.getSolution(id);
    return [
      renderMarkdown(sol.editorial || '_No editorial yet._'),
      h('div', { class: 'md' }, h('h2', null, 'Reference solution')),
      codeBlock(sol.solution.trim()),
    ];
  }

  async function submissionsView() {
    const subs = await api.listSubmissions(id);
    if (!subs.length) {
      return h('div', { class: 'locked' }, icon('history'),
        h('p', null, 'No submissions yet. Press Submit (Ctrl+Enter) when your code passes the examples.'));
    }
    if (openSubmission !== null && subs[openSubmission]) {
      const s = subs[openSubmission];
      const v = VERDICTS[s.verdict] || { label: s.verdict, tone: 'bad' };
      return [
        h('button', { class: 'btn ghost sm', onclick: () => { openSubmission = null; renderLeft(); } }, icon('left'), 'All submissions'),
        h('div', { class: 'verdict-line', style: { marginTop: '12px' } },
          h('span', { class: `verdict ${v.tone}` }, v.label),
          h('span', { class: 'verdict-sub' }, `${new Date(s.time).toLocaleString()} · ${s.passed}/${s.total} passed`)),
        codeBlock(s.code),
        h('button', {
          class: 'btn',
          onclick: async () => {
            if (await confirmDialog('Load this submission?', 'This replaces the code in the editor (you can undo with Ctrl+Z).', 'Load code')) replaceCode(s.code);
          },
        }, icon('copy'), 'Load into editor'),
      ];
    }
    return subs.map((s, i) => {
      const v = VERDICTS[s.verdict] || { label: s.verdict, tone: 'bad' };
      return h('div', { class: 'sub-row', onclick: () => { openSubmission = i; renderLeft(); } },
        h('div', { class: `v ${v.tone}` }, v.label, h('small', null, timeAgo(s.time))),
        h('div', { class: 'num' }, s.verdict === 'compile_error' ? '–' : `${s.passed}/${s.total}`),
        h('div', { class: 'num' }, s.verdict === 'accepted' ? fmtMs(s.runtimeMs) : '–'),
        h('div', { class: 'num' }, s.verdict === 'accepted' ? fmtBytes(s.peakBytes) : '–'));
    });
  }

  async function renderLeft() {
    const tab = leftTab;
    let content;
    if (tab === 'description') content = descriptionView();
    else if (tab === 'hints') content = hintsView();
    else if (tab === 'solution') content = await solutionView();
    else content = await submissionsView();
    if (destroyed || tab !== leftTab) return;
    clear(leftBody).append(...[content].flat(Infinity).filter(Boolean));
    leftBody.scrollTop = 0;
  }

  // ------------------------------------------------------------ console

  function renderConsoleHead() {
    clear(consoleHead);
    const verdict = last && last.result && !busy && VERDICTS[last.result.verdict];
    const dotColor = verdict ? { good: 'var(--green)', bad: 'var(--red)', warn: 'var(--amber)' }[verdict.tone] : null;
    const tab = (key, label, ic, extra) => h('button', {
      class: `tab${consoleTab === key ? ' active' : ''}`,
      onclick: () => { consoleTab = key; renderConsoleHead(); renderConsole(); },
    }, icon(ic), label, extra);
    consoleHead.append(
      tab('testcase', 'Testcase', 'check'),
      tab('result', 'Test Result', 'terminal', dotColor ? h('span', { class: 'badge-dot', style: { background: dotColor } }) : null),
      h('div', { class: 'grow' }),
      h('span', { class: 'shortcut', style: { fontSize: '11.5px', color: 'var(--text-faint)', marginRight: '6px' } },
        h('kbd', null, 'Ctrl'), ' ', h('kbd', null, "'"), ' run  ', h('kbd', null, 'Ctrl'), ' ', h('kbd', null, 'Enter'), ' submit'));
  }

  function testcaseView() {
    if (activeCase >= cases.length) activeCase = cases.length - 1;
    const pills = h('div', { class: 'case-pills' },
      cases.map((_, i) => h('span', {
        class: `case-pill${i === activeCase ? ' active' : ''}`,
        onclick: () => { activeCase = i; renderConsole(); },
      }, `Case ${i + 1}`, cases.length > 1 ? h('span', {
        class: 'x', title: 'Remove this case',
        onclick: (e) => { e.stopPropagation(); cases.splice(i, 1); saveCases(); renderConsole(); },
      }, icon('x')) : null)),
      cases.length < MAX_CASES ? h('button', {
        class: 'btn ghost sm icon-only', title: 'Add a test case (copy of the current one)',
        onclick: () => { cases.push([...cases[activeCase]]); activeCase = cases.length - 1; saveCases(); renderConsole(); },
      }, icon('plus')) : null);
    const c = cases[activeCase];
    const fields = problem.params.map((p, j) => {
      const err = h('div', { class: 'param-error' }, validateValue(p.type, c[j]) || '');
      const ta = h('textarea', {
        class: 'input', rows: 1, spellcheck: 'false', placeholder: PLACEHOLDER[p.type] || '',
        oninput: (e) => {
          c[j] = e.target.value;
          err.textContent = validateValue(p.type, c[j]) || '';
          autoGrow(e.target);
          saveCases();
        },
      });
      ta.value = c[j];
      requestAnimationFrame(() => autoGrow(ta));
      return h('div', { class: 'param' }, h('label', null, `${p.name} =`), ta, err);
    });
    const examples = problem.examples.map((e) => e.input);
    const changed = JSON.stringify(examples) !== JSON.stringify(cases);
    return [pills, fields,
      changed ? h('button', {
        class: 'btn ghost sm',
        onclick: () => { cases = examples.map((x) => [...x]); activeCase = 0; api.saveTestcases(id, null); renderConsole(); },
      }, icon('reset'), 'Reset to the examples') : null];
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(160, ta.scrollHeight + 2)}px`;
  }

  function memLine(c) {
    return h('div', { class: 'mem-stats' },
      h('span', null, icon('chip'), ' Heap: ', h('b', null, plural(c.allocs, 'allocation')), ', ', h('b', null, plural(c.frees, 'free'))),
      h('span', null, 'Peak ', h('b', null, fmtBytes(c.peak))),
      h('span', null, `Reference: ${plural(c.refAllocs, 'allocation')}, peak ${fmtBytes(c.refPeak)}`));
  }

  function caseDetails(c, result) {
    const parts = [io('Input', formatInput(problem.params, c.input))];
    if (result.fatal && result.fatal.i === c.index) parts.push(renderFatal(result.fatal, { onGoto }));
    if (c.status === 'tle') {
      parts.push(h('div', { class: 'err-card' }, h('div', { class: 'err-head' }, icon('clock'), 'Time Limit Exceeded'),
        h('div', { class: 'err-msg' }, 'Your code was still running on this case when the time limit ran out. Look for a loop whose condition never becomes false (e.g. a list walk that never advances), or an algorithm that is far too slow.')));
    }
    if (c.status === 'ole') {
      parts.push(h('div', { class: 'err-card' }, h('div', { class: 'err-head' }, icon('alert'), 'Output Limit Exceeded'),
        h('div', { class: 'err-msg' }, 'Your code printed more than 1 MB. Remove debug printing inside loops.')));
    }
    for (const f of c.fails || []) {
      parts.push(h('div', { class: 'err-card' }, h('div', { class: 'err-head' }, icon('alert'), 'Check failed'), h('div', { class: 'err-msg' }, f)));
    }
    if (c.leakBlocks > 0) parts.push(renderLeaks(c, { onGoto }));
    if (c.output !== null && c.output !== undefined) parts.push(io('Output', c.output, c.status === 'wrong' ? 'bad' : c.status === 'pass' ? 'good' : ''));
    if (c.expected !== undefined) parts.push(io('Expected', c.expected));
    if (c.stdout) parts.push(io('Stdout (your printf output)', c.stdout));
    if (c.status !== 'notrun' && c.status !== 'error' && c.status !== 'tle') parts.push(memLine(c));
    return parts;
  }

  function warningsBlock(result) {
    const warnings = (result.diagnostics || []).filter((d) => d.severity === 'warning');
    if (!warnings.length) return null;
    return h('details', { open: true, style: { marginBottom: '14px' } },
      h('summary', { style: { cursor: 'pointer', color: 'var(--amber)', fontWeight: 600, marginBottom: '8px' } }, `Compiler warnings (${warnings.length})`),
      renderDiagnostics(warnings, { onGoto }));
  }

  function resultView() {
    if (busy) {
      return h('div', { class: 'console-running' }, h('span', { class: 'spinner' }),
        last && last.pending === 'submit' ? 'Compiling and running all hidden tests…' : 'Compiling and running…');
    }
    if (!last) return h('div', { class: 'console-empty' }, 'Run your code to see the results here.');
    const { mode, result } = last;
    const v = VERDICTS[result.verdict] || { label: result.verdict, tone: 'bad' };
    const sub = [];
    if (result.total) sub.push(`${result.passed} / ${result.total} ${mode === 'submit' ? 'testcases' : 'cases'} passed`);
    if (result.verdict === 'accepted' || (mode === 'run' && result.cases)) sub.push(`Runtime ${fmtMs(result.runtimeMs)}`);
    const out = [h('div', { class: 'verdict-line' }, h('span', { class: `verdict ${v.tone}` }, v.label), h('span', { class: 'verdict-sub' }, sub.join(' · ')))];

    if (result.verdict === 'compile_error') {
      const diags = (result.diagnostics || []).filter((d) => d.severity === 'error' || d.severity === 'warning');
      if (diags.length) out.push(renderDiagnostics(diags, { onGoto }));
      else out.push(h('pre', { class: 'term' }, result.compileOutput || 'Compilation failed.'));
      return out;
    }
    if (result.verdict === 'no_compiler') {
      out.push(h('p', null, result.message), h('button', { class: 'btn primary', onclick: () => openSettings() }, 'Set up the compiler'));
      return out;
    }
    if (result.verdict === 'internal_error') {
      out.push(h('pre', { class: 'term' }, result.message));
      return out;
    }
    if (result.verdict === 'invalid_input') {
      out.push(h('div', { class: 'callout' }, result.message,
        result.failedCase !== null && mode === 'run' ? ` (Case ${result.failedCase + 1})` : ''));
      return out;
    }
    out.push(warningsBlock(result));
    if (result.fatal && (result.fatal.i === null || result.fatal.i < 0)) out.push(renderFatal(result.fatal, { onGoto }));

    if (mode === 'submit') {
      const cmp = (mine, ref, fmt) => {
        if (ref === undefined || ref === null) return null;
        const cls = mine <= ref ? 'better' : mine > ref * 1.5 ? 'worse' : '';
        return h('div', { class: `m-ref ${cls}` }, `Reference: ${fmt(ref)}`);
      };
      if (result.verdict === 'accepted') {
        out.push(h('div', { class: 'metrics' },
          h('div', { class: 'metric' }, h('div', { class: 'm-label' }, icon('clock'), 'Runtime (all tests)'), h('div', { class: 'm-value' }, fmtMs(result.runtimeMs)), cmp(result.runtimeMs, result.refRuntimeMs, fmtMs)),
          h('div', { class: 'metric' }, h('div', { class: 'm-label' }, icon('chip'), 'Peak heap usage'), h('div', { class: 'm-value' }, fmtBytes(result.peakBytes)), cmp(result.peakBytes, result.refPeakBytes, fmtBytes)),
          h('div', { class: 'metric' }, h('div', { class: 'm-label' }, icon('drop'), 'Allocations'), h('div', { class: 'm-value' }, String(result.allocs), h('small', null, ` / ${result.frees} freed`)), cmp(result.allocs, result.refAllocs, String))));
        out.push(h('p', { style: { color: 'var(--text-dim)', margin: 0 } }, 'No leaks, no invalid accesses, every test passed. ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); leftTab = 'solution'; renderLeftHead(); renderLeft(); } }, 'Compare with the editorial →')));
      } else {
        const c = result.cases && result.cases[0];
        if (c) {
          out.push(h('div', { class: 'io-label', style: { marginBottom: '10px', fontWeight: 600 } }, `Failed on hidden test ${c.index + 1} of ${result.total}`));
          out.push(caseDetails(c, result));
        }
      }
      return out;
    }

    // run: one pill per case
    const cs = result.cases || [];
    if (resultCase >= cs.length) resultCase = 0;
    out.push(h('div', { class: 'case-pills' }, cs.map((c, i) => {
      const tone = c.status === 'pass' ? '' : c.status === 'leak' ? 'warn' : 'bad';
      return h('span', {
        class: `case-pill${i === resultCase ? ' active' : ''}`,
        onclick: () => { resultCase = i; renderConsole(); },
      }, h('span', { class: `mark ${tone}` }), `Case ${i + 1}`);
    })));
    if (cs[resultCase]) out.push(caseDetails(cs[resultCase], result));
    return out;
  }

  function renderConsole() {
    clear(consoleBody);
    const content = consoleTab === 'testcase' ? testcaseView() : resultView();
    consoleBody.append(...[content].flat(Infinity).filter(Boolean));
  }

  // ------------------------------------------------------------ actions

  function replaceCode(code) {
    if (!editor) return;
    const model = editor.getModel();
    editor.pushUndoStop();
    editor.executeEdits('leakcode', [{ range: model.getFullModelRange(), text: code }]);
    editor.pushUndoStop();
    clearMarks(editor);
  }

  async function resetCode() {
    if (!problem || !editor) return;
    if (await confirmDialog('Reset your code?', 'The editor goes back to the starter code. You can undo with Ctrl+Z.', 'Reset')) {
      replaceCode(problem.starter);
    }
  }

  function validCases() {
    for (let i = 0; i < cases.length; i++) {
      for (let j = 0; j < problem.params.length; j++) {
        const err = validateValue(problem.params[j].type, cases[i][j]);
        if (err) {
          consoleTab = 'testcase';
          activeCase = i;
          renderConsoleHead();
          renderConsole();
          toast(`Case ${i + 1}, ${problem.params[j].name}: ${err}`, 'bad');
          return null;
        }
      }
    }
    return cases.map((c) => c.map((t) => JSON.stringify(JSON.parse(t))));
  }

  function applyMarks(result) {
    if (!editor) return;
    if (result.verdict === 'compile_error') {
      setCompileMarkers(editor, result.diagnostics, 'solution.c');
      setRuntimeMarks(editor, []);
      const firstErr = (result.diagnostics || []).find((d) => d.severity === 'error' && d.file === 'solution.c');
      if (firstErr) revealLine(editor, firstErr.line);
      return;
    }
    setCompileMarkers(editor, (result.diagnostics || []).filter((d) => d.severity === 'warning'), 'solution.c');
    const leaks = (result.cases || []).filter((c) => c.status === 'leak').flatMap((c) => c.leaks || []);
    setRuntimeMarks(editor, marksFor(result.fatal, leaks));
  }

  function noteActivity(kind) {
    const p = state.progress[id] || { status: 'todo', attempts: 0 };
    if (p.status !== 'solved') p.status = 'attempted';
    p.lastActivity = Date.now();
    state.progress[id] = p;
    if (kind === 'run') {
      const d = new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const a = state.activity[key] || { runs: 0, submits: 0, accepted: 0 };
      a.runs += 1;
      state.activity[key] = a;
    }
    emit('progress');
  }

  async function doRun() {
    if (busy || !editor || !problem) return;
    const normalized = validCases();
    if (!normalized) return;
    last = { mode: 'run', result: last ? last.result : null, pending: 'run' };
    setBusy(true, 'run');
    consoleTab = 'result';
    renderConsoleHead();
    renderConsole();
    clearMarks(editor);
    let result;
    try {
      result = await api.run(id, editor.getValue(), normalized);
    } catch (e) {
      result = { verdict: 'internal_error', message: String(e && e.message ? e.message : e) };
    }
    if (destroyed) return;
    setBusy(false);
    last = { mode: 'run', result };
    const firstBad = (result.cases || []).findIndex((c) => c.status !== 'pass');
    resultCase = firstBad >= 0 ? firstBad : 0;
    if (result.verdict !== 'compile_error' && result.verdict !== 'no_compiler') noteActivity('run');
    renderConsoleHead();
    renderConsole();
    applyMarks(result);
  }

  async function doSubmit() {
    if (busy || !editor || !problem) return;
    last = { mode: 'submit', result: last ? last.result : null, pending: 'submit' };
    setBusy(true, 'submit');
    consoleTab = 'result';
    renderConsoleHead();
    renderConsole();
    clearMarks(editor);
    let result;
    try {
      result = await api.submit(id, editor.getValue());
    } catch (e) {
      result = { verdict: 'internal_error', message: String(e && e.message ? e.message : e) };
    }
    if (destroyed) return;
    setBusy(false);
    last = { mode: 'submit', result };
    if (result.progress) {
      state.progress[id] = result.progress;
      state.activity = result.activity;
      emit('progress');
    }
    if (result.verdict === 'accepted') {
      celebrate();
      toast(`Accepted! ${problem.title} solved.`, 'good');
      if (!solutionRevealed) solutionRevealed = true;
      if (leftTab === 'description') renderLeft();
    }
    if (leftTab === 'submissions') renderLeft();
    renderConsoleHead();
    renderConsole();
    applyMarks(result);
  }

  function onKey(e) {
    if (!e.ctrlKey || e.defaultPrevented || editorHost.contains(e.target)) return;
    if (e.key === "'") { e.preventDefault(); doRun(); }
    else if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
  }
  window.addEventListener('keydown', onKey);

  // ------------------------------------------------------------ load

  (async () => {
    problem = await api.getProblem(id);
    if (destroyed || !problem) return;
    const examples = problem.examples.map((e) => [...e.input]);
    const saved = problem.testcases;
    cases = Array.isArray(saved) && saved.length && saved.every((c) => Array.isArray(c) && c.length === problem.params.length)
      ? saved : examples;
    if (!cases.length) cases = [problem.params.map(() => '')];
    solutionRevealed = problem.progress.status === 'solved';
    renderLeftHead();
    renderLeft();
    renderConsoleHead();
    renderConsole();
    editor = await createEditor(editorHost, {
      value: problem.draft !== undefined && problem.draft !== null ? problem.draft : problem.starter,
      onChange: saveDraft,
      keys: { run: () => doRun(), submit: () => doSubmit() },
    });
    if (destroyed) editor.dispose();
    else editor.focus();
  })();

  return {
    destroy() {
      destroyed = true;
      window.removeEventListener('keydown', onKey);
      if (editor) {
        api.saveDraft(id, editor.getValue());
        editor.dispose();
      }
    },
  };
}
