// LeakCode renderer: app shell and hash router.

import { h, icon, clear } from './util.js';
import { state, api, subscribe } from './state.js';
import { applyTheme, updateSettings, detectCompiler } from './actions.js';
import { renderProblems } from './views/problems.js';
import { renderProblem } from './views/problem.js';
import { renderLearn, renderLesson } from './views/learn.js';
import { renderPlayground } from './views/playground.js';
import { renderVisualize } from './views/visualize.js';
import { openSettings } from './views/settings.js';

let current = null;

const NAV = [
  { id: 'learn', label: 'Learn', icon: 'book', match: ['learn'] },
  { id: 'visualize', label: 'Visualize', icon: 'eye', match: ['visualize'] },
  { id: 'practice', label: 'Practice', icon: 'list', match: ['practice', 'problem'] },
  { id: 'playground', label: 'Playground', icon: 'terminal', match: ['playground'] },
];

function renderNav() {
  const nav = clear(document.getElementById('nav'));
  const view = (location.hash.split('/')[1] || 'learn');
  for (const item of NAV) {
    nav.append(h('a', { href: `#/${item.id}`, class: item.match.includes(view) ? 'active' : '' }, icon(item.icon), item.label));
  }
}

function renderTopRight() {
  const host = clear(document.getElementById('topbar-right'));
  const c = state.compiler;
  const pill = h('div', {
    class: `compiler-pill ${c === null ? 'wait' : c.ok ? 'ok' : 'bad'}`,
    title: c && c.ok ? `${c.displayName} · MSVC ${c.version}` : 'Click for compiler setup',
    onclick: () => openSettings(),
  }, h('span', { class: 'dot' }), c === null ? 'Finding compiler…' : c.ok ? `MSVC ${c.version.split('.').slice(0, 2).join('.')}` : 'No compiler');
  const theme = h('button', {
    class: 'btn ghost icon-only',
    title: 'Toggle light/dark theme',
    onclick: () => updateSettings({ theme: state.settings.theme === 'light' ? 'dark' : 'light' }),
  }, icon(state.settings.theme === 'light' ? 'moon' : 'sun'));
  const settings = h('button', { class: 'btn ghost icon-only', title: 'Settings', onclick: () => openSettings() }, icon('sliders'));
  host.append(pill, theme, settings);
}

function route() {
  const parts = (location.hash || '#/learn').split('/');
  const view = parts[1] || 'learn';
  const arg = parts.slice(2).join('/');
  if (current && current.destroy) current.destroy();
  current = null;
  const root = clear(document.getElementById('view'));
  if (view === 'problem' && state.byId.has(arg)) current = renderProblem(root, arg);
  else if (view === 'learn' && arg) current = renderLesson(root, arg);
  else if (view === 'learn') current = renderLearn(root);
  else if (view === 'playground') current = renderPlayground(root);
  else if (view === 'visualize') current = renderVisualize(root);
  else if (view === 'practice' || view === 'problems') current = renderProblems(root);
  else current = renderLearn(root);
  renderNav();
}

async function boot() {
  const init = await api.init();
  state.version = init.version;
  state.settings = init.settings;
  state.progress = init.progress;
  state.activity = init.activity;
  state.lessonsRead = init.lessonsRead;
  state.sections = init.sections;
  state.problems = init.problems;
  state.byId = new Map(init.problems.map((p) => [p.id, p]));
  applyTheme();
  subscribe((what) => { if (what === 'compiler' || what === 'settings') renderTopRight(); });
  renderTopRight();
  window.addEventListener('hashchange', route);
  route();
  detectCompiler(false);
}

boot().catch((e) => {
  document.getElementById('view').textContent = `LeakCode failed to start: ${e && e.stack ? e.stack : e}`;
});
