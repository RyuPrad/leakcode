// App-wide actions used by several views.

import { state, api, emit } from './state.js';
import { applyEditorSettings } from './editor.js';

export function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : 'dark';
}

export async function updateSettings(patch) {
  state.settings = await api.setSettings(patch);
  applyTheme();
  await applyEditorSettings();
  emit('settings');
}

export async function detectCompiler(force = false) {
  state.compiler = null;
  emit('compiler');
  try {
    state.compiler = await api.detectCompiler(force);
  } catch (e) {
    state.compiler = { ok: false, message: String(e && e.message ? e.message : e) };
  }
  emit('compiler');
  return state.compiler;
}

// Code a lesson asked to open in the playground.
let pendingPlaygroundCode = null;

export function openInPlayground(code) {
  pendingPlaygroundCode = code;
  location.hash = '#/playground';
}

export function takePendingPlaygroundCode() {
  const code = pendingPlaygroundCode;
  pendingPlaygroundCode = null;
  return code;
}
