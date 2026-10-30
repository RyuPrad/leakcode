// "Learn": short lessons on C and memory management, each linked to practice problems.

import { h, icon, clear, statusIcon, diffClass } from '../util.js';
import { state, api, problemStatus } from '../state.js';
import { renderMarkdown } from '../markdown.js';
import { openInPlayground, openInVisualizer, openInTyping } from '../actions.js';

let lessonsCache = null;

async function lessonList() {
  if (!lessonsCache) lessonsCache = await api.listLessons();
  return lessonsCache;
}

export function renderLearn(root) {
  const page = h('div', { class: 'page' });
  const step = (n, ic, title, text, href) => h('a', { class: 'card path-step', href },
    h('div', { class: 'path-num' }, icon(ic)),
    h('div', null, h('h3', null, `${n}. ${title}`), h('p', null, text)));
  const resume = h('div', { class: 'learn-resume' });
  const inner = h('div', { class: 'page-inner' },
    h('h1', { class: 'page-title' }, 'Learn C & memory management'),
    h('p', { class: 'page-sub' }, 'No C experience needed: the first lessons start from zero. Each lesson is short. Read it, watch its examples run in the visualizer, then practise.'),
    resume,
    h('div', { class: 'learn-path' },
      step(1, 'book', 'Read', 'Start with Your First C Program. Each lesson explains one idea with programs you can run from the page.', '#/learn/first-program'),
      step(2, 'eye', 'Watch', 'The visualizer runs code one line at a time and draws every variable, heap block and pointer.', '#/visualize'),
      step(3, 'list', 'Practise', 'Start with the C Basics exercises. Every run is checked, and mistakes are pointed out line by line.', '#/practice')));
  page.append(inner);
  root.append(page);
  lessonList().then((lessons) => {
    const next = lessons.find((l) => !state.lessonsRead[l.id]);
    if (next) {
      resume.append(h('a', { class: 'btn primary', href: `#/learn/${next.id}` },
        icon('book'), next.number === 1 ? `Start with lesson 1: ${next.title}` : `Continue with lesson ${next.number}: ${next.title}`));
    }
    let grid = null;
    for (const l of lessons) {
      if (l.part || !grid) {
        grid = h('div', { class: 'lesson-grid' });
        inner.append(h('h2', { class: 'section-title' }, l.part || 'Lessons'), grid);
      }
      const solved = l.practice.filter((id) => problemStatus(id) === 'solved').length;
      grid.append(h('div', { class: 'card lesson-card', onclick: () => { location.hash = `#/learn/${l.id}`; } },
        h('div', { class: 'l-top' },
          h('span', { class: 'l-num' }, `Lesson ${l.number}`),
          state.lessonsRead[l.id] ? h('span', { class: 'l-read' }, icon('check'), 'Read') : null),
        h('h3', null, l.title),
        h('p', null, l.summary),
        h('div', { class: 'l-foot' },
          h('span', null, `${l.minutes} min read`),
          l.practice.length ? h('span', null, `${solved}/${l.practice.length} exercises solved`) : null)));
    }
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
      renderMarkdown(lesson.body, {
        onTryIt: (code) => openInPlayground(code),
        onVisualize: (code) => openInVisualizer(code),
        onType: (code) => openInTyping(code, { source: `Lesson ${lesson.number}: ${lesson.title}`, href: `#/learn/${id}` }),
      }),
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
