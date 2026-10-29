// Loads the Monaco editor through its AMD loader and exposes a promise
// that the ES modules can await.
/* global require */
window.monacoReady = new Promise((resolve, reject) => {
  require.config({ paths: { vs: 'vendor/monaco/vs' } });
  require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
});
