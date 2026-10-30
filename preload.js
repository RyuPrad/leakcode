'use strict';
// Exposes the main-process API to the renderer (contextIsolation is on).

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('leakcode', {
  init: call('app:init'),
  detectCompiler: call('compiler:detect'),
  getProblem: call('problem:get'),
  getSolution: call('problem:solution'),
  run: call('problem:run'),
  submit: call('problem:submit'),
  listSubmissions: call('submissions:list'),
  saveDraft: call('draft:save'),
  saveTestcases: call('testcases:save'),
  play: call('playground:run'),
  getPlayground: call('playground:get'),
  savePlayground: call('playground:save'),
  trace: call('visualizer:run'),
  getVisualizer: call('visualizer:get'),
  saveVisualizer: call('visualizer:save'),
  listLessons: call('lessons:list'),
  getLesson: call('lesson:get'),
  setSettings: call('settings:set'),
  resetProgress: call('progress:reset'),
  openExternal: call('app:openExternal'),
  openDataFolder: call('app:openDataFolder'),
});
