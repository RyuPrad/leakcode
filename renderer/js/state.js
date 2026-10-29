// Application state shared by the views.

export const api = window.leakcode;

export const state = {
  version: '',
  settings: {},
  progress: {},
  activity: {},
  lessonsRead: {},
  compiler: null,          // null while detecting, then { ok, ... }
  sections: [],
  problems: [],
  byId: new Map(),
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(what) {
  for (const fn of [...listeners]) fn(what);
}

export function problemStatus(id) {
  return (state.progress[id] && state.progress[id].status) || 'todo';
}

// Neighbours in study-plan order, for the prev/next buttons.
export function neighbours(id) {
  const i = state.problems.findIndex((p) => p.id === id);
  return { prev: state.problems[i - 1] || null, next: state.problems[i + 1] || null };
}
