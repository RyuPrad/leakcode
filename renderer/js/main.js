// LeakCode renderer: app shell and hash router.
//
// Each tab keeps its page alive (hidden) while you are elsewhere, so coming
// back shows it exactly as you left it: the lesson and how far you scrolled,
// the exercise with its results, the visualizer at the same step. Clicking
// the tab you are already on goes to its start page.

import { h, icon, clear, localStorageGet, localStorageSet } from './util.js';
import { state, api, subscribe } from './state.js';
import { applyTheme, updateSettings, detectCompiler } from './actions.js';
import { renderProblems } from './views/problems.js';
import { renderProblem } from './views/problem.js';
import { renderLearn, renderLesson } from './views/learn.js';
import { renderPlayground } from './views/playground.js';
import { renderVisualize } from './views/visualize.js';
import { renderTyping } from './views/typing.js';
import { openSettings } from './views/settings.js';

const NAV = [
  { id: 'learn', label: 'Learn', icon: 'book', match: ['learn'] },
  { id: 'visualize', label: 'Visualize', icon: 'eye', match: ['visualize'] },
  { id: 'practice', label: 'Practice', icon: 'list', match: ['practice', 'problems', 'problem'] },
  { id: 'typing', label: 'Typing', icon: 'keyboard', match: ['typing'] },
  { id: 'playground', label: 'Playground', icon: 'terminal', match: ['playground'] },
];

const pages = new Map();       // tab id -> { host, hash, view }
let lastHash = {};             // tab id -> the address last shown in it
try { lastHash = JSON.parse(localStorageGet('lc.lastHash')) || {}; } catch { lastHash = {}; }

function tabOf(view) {
  const item = NAV.find((n) => n.match.includes(view));
  return item ? item.id : 'learn';
}

function renderNav() {
  const nav = clear(document.getElementById('nav'));
  const active = tabOf(location.hash.split('/')[1] || 'learn');
  for (const item of NAV) {
    const here = item.id === active;
    nav.append(h('a', { href: here ? `#/${item.id}` : lastHash[item.id] || `#/${item.id}`, class: here ? 'active' : '' }, icon(item.icon), item.label));
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

function render(view, arg, root) {
  if (view === 'problem') return state.byId.has(arg) ? renderProblem(root, arg) : renderProblems(root);
  if (view === 'learn') return arg ? renderLesson(root, arg) : renderLearn(root);
  if (view === 'playground') return renderPlayground(root);
  if (view === 'visualize') return renderVisualize(root);
  if (view === 'typing') return renderTyping(root);
  if (view === 'practice' || view === 'problems') return renderProblems(root);
  return renderLearn(root);
}

function route() {
  const hash = location.hash || '#/learn';
  const parts = hash.split('/');
  const view = parts[1] || 'learn';
  const tab = tabOf(view);
  const container = document.getElementById('view');
  const boot = container.querySelector('.boot');
  if (boot) boot.remove();
  for (const [id, p] of pages) {
    if (id === tab || p.host.classList.contains('hidden')) continue;
    p.host.classList.add('hidden');
    p.host.inert = true;
    if (p.view && p.view.hide) p.view.hide();
  }
  let page = pages.get(tab);
  if (page && page.hash === hash) {
    page.host.classList.remove('hidden');
    page.host.inert = false;
    if (page.view && page.view.show) page.view.show();
    const focus = page.host.lcFocus;          // where you were typing
    if (focus && focus.isConnected && page.host.contains(focus)) focus.focus({ preventScroll: true });
  } else {
    if (page) {
      if (page.view && page.view.destroy) page.view.destroy();
      page.host.remove();
    }
    const host = h('div', { class: 'view-host' });
    container.append(host);
    page = { host, hash, view: render(view, parts.slice(2).join('/'), host) };
    pages.set(tab, page);
  }
  lastHash[tab] = hash;
  localStorageSet('lc.lastHash', JSON.stringify(lastHash));
  localStorageSet('lc.lastRoute', hash);
  renderNav();
}

// Remembers the last focused element of each page, to restore it on return.
document.addEventListener('focusin', (e) => {
  const host = e.target && e.target.closest ? e.target.closest('.view-host') : null;
  if (host) host.lcFocus = e.target;
});

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
  const resume = localStorageGet('lc.lastRoute');          // reopen where you left off
  if (!location.hash && resume && resume.startsWith('#/')) history.replaceState(null, '', resume);
  route();
  detectCompiler(false);
}

boot().catch((e) => {
  document.getElementById('view').textContent = `LeakCode failed to start: ${e && e.stack ? e.stack : e}`;
});
