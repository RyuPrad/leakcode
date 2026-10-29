// Settings dialog: compiler status, editor preferences and data.

import { h, icon, clear, confirmDialog, toast } from '../util.js';
import { state, api, emit, subscribe } from '../state.js';
import { updateSettings, detectCompiler } from '../actions.js';

const BUILD_TOOLS_URL = 'https://visualstudio.microsoft.com/visual-cpp-build-tools/';

function compilerSection() {
  const box = h('div');
  const render = () => {
    clear(box);
    const c = state.compiler;
    box.append(h('h3', null, 'C compiler'));
    if (c === null) {
      box.append(h('div', { class: 'console-running' }, h('span', { class: 'spinner' }), 'Looking for the Microsoft C compiler…'));
      return;
    }
    if (c.ok) {
      box.append(h('div', { class: 'compiler-box' },
        h('div', { class: 'row' }, h('span', null, 'Status'), h('span', { style: { color: 'var(--green)', fontWeight: 600 } }, 'Ready')),
        h('div', { class: 'row' }, h('span', null, 'Toolset'), h('span', null, `${c.displayName}`)),
        h('div', { class: 'row' }, h('span', null, 'MSVC'), h('span', null, c.version)),
        h('div', { class: 'row' }, h('span', null, 'Windows SDK'), h('span', null, c.sdk || '–')),
        h('div', { class: 'row' }, h('span', null, 'Mode'), h('span', null, 'C17, debug build with run-time checks'))));
    } else {
      box.append(h('div', { class: 'compiler-box' },
        h('div', { class: 'row' }, h('span', null, 'Status'), h('span', { style: { color: 'var(--red)', fontWeight: 600 } }, 'Not found')),
        h('div', null, c.message || '')),
      h('ol', { class: 'setup-steps' },
        h('li', null, 'Install the free ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal(BUILD_TOOLS_URL); } }, 'Build Tools for Visual Studio'), '.'),
        h('li', null, 'In the installer, tick the workload ', h('b', null, 'Desktop development with C++'), ' and install it.'),
        h('li', null, 'Come back here and press ', h('b', null, 'Detect again'), '.')));
    }
    box.append(h('div', { style: { marginTop: '10px' } },
      h('button', { class: 'btn sm', onclick: () => detectCompiler(true) }, icon('reset'), 'Detect again')));
  };
  render();
  return { el: h('div', { class: 'modal-section' }, box), render };
}

function toggle(label, help, key) {
  const input = h('input', { type: 'checkbox' });
  input.checked = Boolean(state.settings[key]);
  input.addEventListener('change', () => updateSettings({ [key]: input.checked }));
  return h('div', { class: 'setting' },
    h('div', null, h('div', { class: 's-label' }, label), help ? h('div', { class: 's-help' }, help) : null),
    h('label', { class: 'switch' }, input, h('span')));
}

function choice(label, key, options) {
  const sel = h('select', { class: 'input', onchange: (e) => updateSettings({ [key]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) }) },
    options.map(([v, t]) => h('option', { value: v, selected: String(state.settings[key]) === String(v) }, t)));
  return h('div', { class: 'setting' }, h('div', { class: 's-label' }, label), sel);
}

export function openSettings() {
  const compiler = compilerSection();
  const unsub = subscribe((what) => { if (what === 'compiler') compiler.render(); });
  const close = () => { unsub(); window.removeEventListener('keydown', onKey); backdrop.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
    h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', null, 'Settings'), h('button', { class: 'btn ghost icon-only', onclick: close }, icon('x'))),
      h('div', { class: 'modal-body' },
        compiler.el,
        h('div', { class: 'modal-section' },
          h('h3', null, 'Editor'),
          choice('Theme', 'theme', [['dark', 'Dark'], ['light', 'Light']]),
          choice('Font size', 'fontSize', [12, 13, 14, 15, 16, 18, 20].map((n) => [n, `${n} px`])),
          choice('Tab size', 'tabSize', [[2, '2 spaces'], [4, '4 spaces'], [8, '8 spaces']]),
          toggle('Minimap', 'Show a miniature overview of the code.', 'minimap'),
          toggle('Word wrap', 'Wrap long lines instead of scrolling.', 'wordWrap')),
        h('div', { class: 'modal-section' },
          h('h3', null, 'Your data'),
          h('div', { class: 'setting' },
            h('div', null, h('div', { class: 's-label' }, 'Data folder'), h('div', { class: 's-help' }, 'Progress, drafts and submissions are stored on this PC.')),
            h('button', { class: 'btn sm', onclick: () => api.openDataFolder() }, icon('folder'), 'Open')),
          h('div', { class: 'setting' },
            h('div', null, h('div', { class: 's-label' }, 'Reset progress'), h('div', { class: 's-help' }, 'Clears solved problems, drafts, submissions and activity.')),
            h('button', {
              class: 'btn sm danger',
              onclick: async () => {
                if (!await confirmDialog('Reset all progress?', 'Solved problems, saved code, submissions and your activity history will be deleted. This cannot be undone.', 'Reset everything', true)) return;
                await api.resetProgress();
                state.progress = {};
                state.activity = {};
                state.lessonsRead = {};
                emit('progress');
                toast('Progress reset.');
                close();
                location.hash = '#/problems';
              },
            }, 'Reset…'))),
        h('div', { class: 'modal-section', style: { color: 'var(--text-faint)', fontSize: '12.5px' } },
          `LeakCode ${state.version} · Shortcuts: Ctrl+' run, Ctrl+Enter submit, Ctrl+Enter runs the Playground.`))));
  document.body.append(backdrop);
}
