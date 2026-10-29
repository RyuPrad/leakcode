// The Playground: write any complete C program, give it input, and get its
// output together with a full memory report.

import { h, icon, clear, fmtBytes, fmtMs, plural, debounce, makeResizable, confirmDialog } from '../util.js';
import { api } from '../state.js';
import { createEditor, setCompileMarkers, setRuntimeMarks, clearMarks, revealLine } from '../editor.js';
import { renderFatal, renderLeaks, renderDiagnostics, marksFor, VERDICTS } from '../diagnose.js';
import { takePendingPlaygroundCode } from '../actions.js';
import { openSettings } from './settings.js';

export function renderPlayground(root) {
  let editor = null;
  let destroyed = false;
  let busy = false;
  let examples = [];
  let outTab = 'output';
  let result = null;

  const editorHost = h('div', { class: 'editor-host' });
  const runBtn = h('button', { class: 'btn primary', title: 'Compile and run (Ctrl+Enter)', onclick: () => run() }, icon('play'), 'Run');
  const exampleSelect = h('select', {
    class: 'input', style: { height: '28px', fontSize: '13px' },
    onchange: async (e) => {
      const ex = examples.find((x) => x.id === e.target.value);
      e.target.value = '';
      if (ex && editor && await confirmDialog(`Load "${ex.title}"?`, 'This replaces the code in the editor (Ctrl+Z undoes it).', 'Load example')) {
        replaceCode(ex.code);
      }
    },
  }, h('option', { value: '' }, 'Load an example…'));
  const stdin = h('textarea', { class: 'input', spellcheck: 'false', placeholder: 'Text typed here is sent to the program\'s standard input (scanf, getchar, fgets…).' });
  const outHead = h('div', { class: 'pane-head' });
  const outBody = h('div', { class: 'pane-body' });
  const left = h('div', { class: 'pane', style: { flex: 1 } },
    h('div', { class: 'pane-head editor-head' },
      h('span', { class: 'lang' }, icon('code'), 'main.c'),
      h('div', { class: 'grow' }),
      exampleSelect,
      h('div', { class: 'run-bar', style: { marginLeft: '8px' } }, runBtn)),
    editorHost);
  const stdinPane = h('div', { class: 'pane pane-stdin' }, h('div', { class: 'pane-head' }, h('span', { class: 'tab active' }, icon('file'), 'Input (stdin)')), stdin);
  const outPane = h('div', { class: 'pane pane-out' }, outHead, outBody);
  const gutterV = h('div', { class: 'gutter v' });
  const gutterH = h('div', { class: 'gutter h' });
  const side = h('div', { class: 'play-side' }, stdinPane, gutterH, outPane);
  const layout = h('div', { class: 'play-layout' }, left, gutterV, side);
  root.append(layout);
  makeResizable(gutterV, side, { axis: 'x', min: 300, max: () => layout.clientWidth - 360, invert: true, key: 'lc.playSide' });
  makeResizable(gutterH, stdinPane, { axis: 'y', min: 70, max: () => side.clientHeight - 140, key: 'lc.playStdin' });

  const save = debounce(() => {
    if (editor) api.savePlayground({ code: editor.getValue(), stdin: stdin.value });
  }, 600);
  stdin.addEventListener('input', save);
  const onGoto = (line) => editor && revealLine(editor, line);

  function replaceCode(code) {
    const model = editor.getModel();
    editor.pushUndoStop();
    editor.executeEdits('leakcode', [{ range: model.getFullModelRange(), text: code }]);
    editor.pushUndoStop();
    clearMarks(editor);
    result = null;
    renderOut();
  }

  function renderOutHead() {
    clear(outHead);
    const tab = (key, label, ic, badge) => h('button', {
      class: `tab${outTab === key ? ' active' : ''}`,
      onclick: () => { outTab = key; renderOutHead(); renderOut(); },
    }, icon(ic), label, badge);
    const memIssue = result && (result.fatal || (result.exit && result.exit.leakBlocks));
    outHead.append(
      tab('output', 'Output', 'terminal'),
      tab('memory', 'Memory report', 'chip', memIssue ? h('span', { class: 'badge-dot', style: { background: result.fatal ? 'var(--red)' : 'var(--amber)' } }) : null));
  }

  function outputView() {
    if (busy) return h('div', { class: 'console-running', style: { padding: '18px 14px' } }, h('span', { class: 'spinner' }), 'Compiling and running…');
    if (!result) {
      return h('div', { class: 'console-empty' }, 'Press Run (Ctrl+Enter) to compile and run main.c.',
        h('br'), 'Every run reports leaks, overflows and use-after-free bugs.');
    }
    if (result.verdict === 'compile_error') {
      const diags = (result.diagnostics || []).filter((d) => d.severity !== 'note');
      return h('div', { style: { padding: '14px' } },
        h('div', { class: 'verdict-line' }, h('span', { class: 'verdict bad' }, 'Compile Error')),
        diags.length ? renderDiagnostics(diags, { onGoto }) : h('pre', { class: 'term' }, result.compileOutput));
    }
    if (result.verdict === 'no_compiler' || result.verdict === 'internal_error') {
      return h('div', { style: { padding: '14px' } }, h('p', null, result.message),
        result.verdict === 'no_compiler' ? h('button', { class: 'btn primary', onclick: () => openSettings() }, 'Set up the compiler') : null);
    }
    const term = h('pre', { class: 'term' });
    term.append(result.stdout || '');
    if (result.stderr) term.append(h('span', { class: 'err-text' }, (result.stdout && !result.stdout.endsWith('\n') ? '\n' : '') + result.stderr));
    if (!result.stdout && !result.stderr) term.append(h('span', { style: { color: 'var(--text-faint)' } }, '(no output)'));
    const v = VERDICTS[result.verdict] || { label: result.verdict, tone: 'bad' };
    const status = result.verdict === 'ok' || result.verdict === 'memory_leak'
      ? h('span', null, 'Exit code ', h('b', null, String(result.exitCode)))
      : h('b', { style: { color: 'var(--red)' } }, v.label);
    const warnings = (result.diagnostics || []).filter((d) => d.severity === 'warning');
    return [
      warnings.length ? h('div', { style: { padding: '12px 14px 0' } },
        h('details', null, h('summary', { style: { cursor: 'pointer', color: 'var(--amber)' } }, `Compiler warnings (${warnings.length})`), renderDiagnostics(warnings, { onGoto }))) : null,
      term,
      h('div', { class: 'exit-line' },
        status,
        h('span', null, 'Time ', h('b', null, fmtMs(result.wallMs))),
        result.exit ? h('span', null, 'Heap ', h('b', null, `${plural(result.exit.allocs, 'alloc')}, ${plural(result.exit.frees, 'free')}`), ', peak ', h('b', null, fmtBytes(result.exit.peak))) : null,
        result.fatal || (result.exit && result.exit.leakBlocks)
          ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); outTab = 'memory'; renderOutHead(); renderOut(); } }, 'See memory report →')
          : h('span', { style: { color: 'var(--green)' } }, '✓ No memory errors')),
    ];
  }

  function memoryView() {
    if (!result || !['ok', 'memory_leak', 'runtime_error', 'time_limit', 'output_limit'].includes(result.verdict)) {
      return h('div', { class: 'console-empty' }, 'Run the program to get a memory report.');
    }
    const parts = [];
    if (result.fatal) parts.push(renderFatal(result.fatal, { onGoto }));
    if (result.exit && result.exit.leakBlocks) parts.push(renderLeaks(result.exit, { onGoto, atExit: true }));
    if (result.exit) {
      parts.push(h('div', { class: 'metrics' },
        h('div', { class: 'metric' }, h('div', { class: 'm-label' }, 'Allocations'), h('div', { class: 'm-value' }, String(result.exit.allocs))),
        h('div', { class: 'metric' }, h('div', { class: 'm-label' }, 'Frees'), h('div', { class: 'm-value' }, String(result.exit.frees))),
        h('div', { class: 'metric' }, h('div', { class: 'm-label' }, 'Peak heap'), h('div', { class: 'm-value' }, fmtBytes(result.exit.peak)))));
    }
    if (!result.fatal && result.exit && !result.exit.leakBlocks) {
      parts.push(h('div', { class: 'callout', style: { background: 'var(--green-soft)', borderColor: 'var(--green)' } },
        h('div', { class: 'callout-title' }, icon('check'), 'Clean run'),
        'Every allocation was freed and no invalid memory access was detected.'));
    }
    if (result.verdict === 'time_limit') parts.push(h('div', { class: 'callout' }, 'The program was stopped after 10 seconds. Is it waiting for input, or stuck in a loop?'));
    return h('div', { style: { padding: '14px' } }, parts);
  }

  function renderOut() {
    clear(outBody);
    const v = outTab === 'output' ? outputView() : memoryView();
    outBody.append(...[v].flat().filter(Boolean));
  }

  async function run() {
    if (busy || !editor) return;
    busy = true;
    runBtn.disabled = true;
    clear(runBtn).append(h('span', { class: 'spinner' }), 'Run');
    clearMarks(editor);
    renderOut();
    try {
      result = await api.play(editor.getValue(), stdin.value);
    } catch (e) {
      result = { verdict: 'internal_error', message: String(e && e.message ? e.message : e) };
    }
    if (destroyed) return;
    busy = false;
    runBtn.disabled = false;
    clear(runBtn).append(icon('play'), 'Run');
    if (result.verdict === 'compile_error') {
      setCompileMarkers(editor, result.diagnostics, 'main.c');
      const firstErr = (result.diagnostics || []).find((d) => d.severity === 'error' && d.file === 'main.c');
      if (firstErr) revealLine(editor, firstErr.line);
    } else {
      setCompileMarkers(editor, (result.diagnostics || []).filter((d) => d.severity === 'warning'), 'main.c');
      setRuntimeMarks(editor, marksFor(result.fatal, result.exit ? result.exit.leaks : []));
    }
    if (result.fatal) outTab = 'memory';
    else outTab = 'output';
    renderOutHead();
    renderOut();
  }

  function onKey(e) {
    if (e.ctrlKey && e.key === 'Enter' && !e.defaultPrevented && !editorHost.contains(e.target)) {
      e.preventDefault();
      run();
    }
  }
  window.addEventListener('keydown', onKey);

  renderOutHead();
  renderOut();
  (async () => {
    const data = await api.getPlayground();
    if (destroyed) return;
    examples = data.examples;
    for (const ex of examples) exampleSelect.append(h('option', { value: ex.id }, ex.title));
    const pending = takePendingPlaygroundCode();
    const saved = data.state;
    stdin.value = (saved && saved.stdin) || '';
    editor = await createEditor(editorHost, {
      value: (saved && saved.code) || (examples[0] ? examples[0].code : 'int main(void) { return 0; }\n'),
      onChange: save,
      keys: { submit: () => run() },
    });
    if (destroyed) {
      editor.dispose();
      return;
    }
    if (pending) {
      replaceCode(`${pending}\n`);
      save();
    }
    editor.focus();
  })();

  return {
    destroy() {
      destroyed = true;
      window.removeEventListener('keydown', onKey);
      if (editor) {
        api.savePlayground({ code: editor.getValue(), stdin: stdin.value });
        editor.dispose();
      }
    },
  };
}
