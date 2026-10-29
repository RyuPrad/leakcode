// The study plan: progress overview, filters and the problem list.

import { h, icon, clear, statusIcon, diffClass, plural } from '../util.js';
import { state, problemStatus, subscribe } from '../state.js';

const filters = { q: '', difficulty: '', status: '', topic: '' };
let savedScroll = 0;

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function streaks() {
  const act = state.activity || {};
  const active = (k) => act[k] && act[k].submits > 0;
  let current = 0;
  const d = new Date();
  if (!active(dayKey(d))) d.setDate(d.getDate() - 1);
  while (active(dayKey(d))) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  const days = Object.keys(act).filter(active).length;
  const accepted = Object.values(act).reduce((s, a) => s + (a.accepted || 0), 0);
  return { current, days, accepted };
}

function ring(solved, total) {
  const r = 46, c = 2 * Math.PI * r;
  const frac = total ? solved / total : 0;
  const wrap = h('div', { class: 'ring' });
  wrap.innerHTML = `<svg viewBox="0 0 112 112"><circle class="track" cx="56" cy="56" r="${r}"/>`
    + (frac > 0 ? `<circle class="fill" cx="56" cy="56" r="${r}" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}"/>` : '')
    + '</svg>';
  wrap.append(h('div', { class: 'ring-label' }, h('b', null, `${solved}`), h('span', null, `of ${total} solved`)));
  return wrap;
}

function heatmap() {
  const weeks = 20;
  const grid = h('div', { class: 'heatmap' });
  const today = new Date();
  // columns are weeks (Sunday first), the last column holds today
  const start = new Date(today);
  start.setDate(today.getDate() - ((weeks - 1) * 7 + today.getDay()));
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const a = state.activity[dayKey(d)];
    const n = a ? a.runs + a.submits : 0;
    const lvl = n === 0 ? '' : n < 3 ? 'l1' : n < 8 ? 'l2' : 'l3';
    const future = d > today;
    const title = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: `
      + (a ? `${plural(a.runs, 'run')}, ${plural(a.submits, 'submission')} (${a.accepted} accepted)` : 'no activity');
    grid.append(h('i', { class: `${lvl}${future ? ' future' : ''}`, title }));
  }
  return grid;
}

function overview() {
  const total = state.problems.length;
  const solved = state.problems.filter((p) => problemStatus(p.id) === 'solved').length;
  const byDiff = ['Easy', 'Medium', 'Hard'].map((d) => {
    const all = state.problems.filter((p) => p.difficulty === d);
    return { d, total: all.length, solved: all.filter((p) => problemStatus(p.id) === 'solved').length };
  });
  const s = streaks();
  return h('div', { class: 'overview' },
    h('div', { class: 'card' },
      h('div', { class: 'ov-title' }, 'Progress'),
      h('div', { class: 'progress-row' },
        ring(solved, total),
        h('div', { class: 'diff-bars' }, byDiff.map((b) => h('div', null,
          h('div', { class: 'diff-bar-head' }, h('span', { class: `diff ${diffClass(b.d)}` }, b.d), h('span', null, `${b.solved} / ${b.total}`)),
          h('div', { class: `bar ${diffClass(b.d)}` }, h('i', { style: { width: `${b.total ? (100 * b.solved) / b.total : 0}%` } }))))))),
    h('div', { class: 'card' },
      h('div', { class: 'activity-head' }, h('div', { class: 'ov-title' }, 'Activity')),
      h('div', { class: 'streak' },
        h('div', null, h('b', null, `${s.current} 🔥`), h('span', null, 'day streak')),
        h('div', null, h('b', null, `${s.days}`), h('span', null, 'active days')),
        h('div', null, h('b', null, `${s.accepted}`), h('span', null, 'accepted submissions'))),
      heatmap()));
}

function nextUp() {
  const unsolved = state.problems.filter((p) => problemStatus(p.id) !== 'solved');
  if (!unsolved.length) return null;
  const recent = unsolved
    .filter((p) => state.progress[p.id] && state.progress[p.id].lastActivity)
    .sort((a, b) => state.progress[b.id].lastActivity - state.progress[a.id].lastActivity)[0];
  return recent || unsolved[0];
}

function matches(p) {
  if (filters.difficulty && p.difficulty !== filters.difficulty) return false;
  if (filters.status && problemStatus(p.id) !== filters.status) return false;
  if (filters.topic && !p.topics.includes(filters.topic)) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    if (!`${p.number} ${p.title} ${p.topics.join(' ')}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

function problemRow(p) {
  return h('div', { class: 'prow', onclick: () => { location.hash = `#/problem/${p.id}`; } },
    statusIcon(problemStatus(p.id)),
    h('span', { class: 'num' }, `${p.number}.`),
    h('span', { class: 'title' }, p.title, p.kind === 'bughunt' ? h('span', { class: 'kind-tag' }, 'Bug hunt') : null),
    h('span', { class: 'chips' }, p.topics.slice(0, 2).map((t) => h('span', { class: 'chip' }, t))),
    h('span', { class: `diff ${diffClass(p.difficulty)}` }, p.difficulty));
}

export function renderProblems(root) {
  const page = h('div', { class: 'page' });
  const inner = h('div', { class: 'page-inner' });
  page.append(inner);
  root.append(page);

  const listHost = h('div');
  const topics = [...new Set(state.problems.flatMap((p) => p.topics))].sort();
  const select = (key, label, options) => h('select', {
    class: 'input',
    onchange: (e) => { filters[key] = e.target.value; renderList(); },
  }, h('option', { value: '' }, label), options.map(([v, t]) => h('option', { value: v, selected: filters[key] === v }, t)));

  function renderHead() {
    const next = nextUp();
    return h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '16px' } },
      h('div', { style: { flex: 1 } },
        h('h1', { class: 'page-title' }, 'C & Memory Management Study Plan'),
        h('p', { class: 'page-sub' }, `${state.problems.length} problems in ${state.sections.length} chapters, from your first pointer to writing your own malloc. Every run is checked for leaks, overflows and dangling pointers.`)),
      next ? h('button', { class: 'btn primary', onclick: () => { location.hash = `#/problem/${next.id}`; } },
        icon('play'), `${state.progress[next.id] ? 'Continue' : 'Start'}: ${next.number}. ${next.title}`) : null);
  }

  function renderList() {
    clear(listHost);
    const filtering = filters.q || filters.difficulty || filters.status || filters.topic;
    let shown = 0;
    state.sections.forEach((s, i) => {
      const ps = s.problems.map((id) => state.byId.get(id)).filter(Boolean);
      const visible = ps.filter(matches);
      if (!visible.length) return;
      shown += visible.length;
      const solved = ps.filter((p) => problemStatus(p.id) === 'solved').length;
      listHost.append(h('div', { class: 'card section-card' },
        h('div', { class: 'section-head' },
          h('div', { class: 'section-num' }, String(i + 1)),
          h('div', null, h('h3', null, s.title), h('p', null, s.summary)),
          h('div', { class: 'section-prog' },
            h('span', null, `${solved} / ${ps.length} solved`),
            h('div', { class: 'bar' }, h('i', { style: { width: `${(100 * solved) / ps.length}%`, background: solved === ps.length ? 'var(--green)' : '' } })))),
        visible.map(problemRow)));
    });
    if (!shown) listHost.append(h('div', { class: 'empty' }, filtering ? 'No problems match these filters.' : 'No problems found.'));
  }

  function renderAll() {
    clear(inner);
    const search = h('input', {
      class: 'input', placeholder: 'Search problems or topics', value: filters.q,
      oninput: (e) => { filters.q = e.target.value; renderList(); },
    });
    inner.append(
      renderHead(),
      overview(),
      h('div', { class: 'toolbar' },
        h('div', { class: 'search' }, icon('search'), search),
        select('difficulty', 'All difficulties', [['Easy', 'Easy'], ['Medium', 'Medium'], ['Hard', 'Hard']]),
        select('status', 'All statuses', [['todo', 'Not started'], ['attempted', 'Attempted'], ['solved', 'Solved']]),
        select('topic', 'All topics', topics.map((t) => [t, t])),
        h('div', { class: 'grow' }),
        h('button', {
          class: 'btn', title: 'Pick a random unsolved problem',
          onclick: () => {
            const pool = state.problems.filter((p) => problemStatus(p.id) !== 'solved');
            const pick = (pool.length ? pool : state.problems)[Math.floor(Math.random() * (pool.length || state.problems.length))];
            location.hash = `#/problem/${pick.id}`;
          },
        }, icon('shuffle'), 'Random')),
      listHost);
    renderList();
  }

  renderAll();
  page.scrollTop = savedScroll;
  const unsub = subscribe((what) => { if (what === 'progress') renderAll(); });
  return {
    destroy() {
      savedScroll = page.scrollTop;
      unsub();
    },
  };
}
