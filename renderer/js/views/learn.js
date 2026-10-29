// "Learn": short lessons on C and memory management, each linked to practice problems.

import { h, icon, clear, statusIcon, diffClass } from '../util.js';
import { state, api, problemStatus } from '../state.js';
import { renderMarkdown } from '../markdown.js';
import { openInPlayground } from '../actions.js';

let lessonsCache = null;

async function lessonList() {
  if (!lessonsCache) lessonsCache = await api.listLessons();
  return lessonsCache;
}

export function renderLearn(root) {
  const page = h('div', { class: 'page' });
  const inner = h('div', { class: 'page-inner' },
    h('h1', { class: 'page-title' }, 'Learn'),
    h('p', { class: 'page-sub' }, 'Short lessons on how C really works with memory. Each one ends with problems to practise on, and every code sample runs in the Playground.'));
  page.append(inner);
  root.append(page);
  lessonList().then((lessons) => {
    inner.append(h('div', { class: 'lesson-grid' }, lessons.map((l) => {
      const solved = l.practice.filter((id) => problemStatus(id) === 'solved').length;
      return h('div', { class: 'card lesson-card', onclick: () => { location.hash = `#/learn/${l.id}`; } },
        h('div', { class: 'l-top' },
          h('span', { class: 'l-num' }, `Lesson ${l.number}`),
          state.lessonsRead[l.id] ? h('span', { class: 'l-read' }, icon('check'), 'Read') : null),
        h('h3', null, l.title),
        h('p', null, l.summary),
        h('div', { class: 'l-foot' },
          h('span', null, `${l.minutes} min read`),
          l.practice.length ? h('span', null, `${solved}/${l.practice.length} practice problems solved`) : null));
    })));
  });
  return {};
}

export function renderLesson(root, id) {
  const nav = h('nav', { class: 'reader-nav' });
  const main = h('div', { class: 'reader-main' });
  root.append(h('div', { class: 'reader' }, nav, main));
  let destroyed = false;
  (async () => {
    const lessons = await lessonList();
    const lesson = await api.getLesson(id);
    if (destroyed) return;
    state.lessonsRead[id] = Date.now();
    nav.append(h('a', { href: '#/learn', style: { marginBottom: '10px' } }, icon('left'), 'All lessons'));
    lessons.forEach((l) => nav.append(h('a', { href: `#/learn/${l.id}`, class: l.id === id ? 'active' : '' }, h('span', null, l.number), l.title)));
    if (!lesson) {
      main.append(h('div', { class: 'empty' }, 'Lesson not found.'));
      return;
    }
    const idx = lessons.findIndex((l) => l.id === id);
    const prev = lessons[idx - 1];
    const next = lessons[idx + 1];
    const practice = lesson.practice.map((pid) => state.byId.get(pid)).filter(Boolean);
    main.append(h('article', { class: 'reader-article' },
      renderMarkdown(lesson.body, { onTryIt: (code) => openInPlayground(code) }),
      practice.length ? h('div', { class: 'card practice' },
        h('h3', null, 'Practice'),
        practice.map((p) => h('div', { class: 'prow', onclick: () => { location.hash = `#/problem/${p.id}`; } },
          statusIcon(problemStatus(p.id)),
          h('span', { class: 'title' }, `${p.number}. ${p.title}`),
          h('span', { class: `diff ${diffClass(p.difficulty)}` }, p.difficulty)))) : null,
      h('div', { class: 'reader-pager' },
        prev ? h('a', { class: 'btn', href: `#/learn/${prev.id}` }, icon('left'), prev.title) : h('span'),
        next ? h('a', { class: 'btn primary', href: `#/learn/${next.id}` }, next.title, icon('right')) : h('span'))));
    main.scrollTop = 0;
  })();
  return { destroy() { destroyed = true; } };
}
