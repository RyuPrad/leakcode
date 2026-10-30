'use strict';
// LeakCode - Electron main process.

const { app, BrowserWindow, ipcMain, protocol, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { Judge, CompilerMissingError } = require('./src/judge');
const { loadProblems, publicProblem, summary } = require('./src/problems');
const { loadLessons, loadExamples } = require('./src/content');
const { typingSnippets } = require('./src/typing');
const { Store } = require('./src/store');

const ROOT = __dirname;
const RENDERER = path.join(ROOT, 'renderer');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
// Development screenshots (tools/shots.js) run against a throwaway profile.
const SHOTS = process.env.LEAKCODE_SHOTS;
if (SHOTS) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'leakcode-dev-profile'));
  // keep painting even when other windows cover this one
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let store, judge, catalog, lessons, examples, vizExamples, snippets;

function loadContent() {
  catalog = loadProblems(path.join(ROOT, 'problems'));
  lessons = loadLessons(path.join(ROOT, 'lessons'));
  examples = loadExamples(path.join(ROOT, 'playground', 'examples.lc'));
  vizExamples = loadExamples(path.join(ROOT, 'visualizer', 'examples.lc'));
  snippets = typingSnippets(lessons, vizExamples, examples);
}

function compilerProblem(e) {
  if (e instanceof CompilerMissingError) return { verdict: 'no_compiler', message: e.info.message, info: e.info };
  return { verdict: 'internal_error', message: e && e.message ? e.message : String(e) };
}

function registerIpc() {
  ipcMain.handle('app:init', async () => ({
    version: app.getVersion(),
    sections: catalog.sections,
    problems: [...catalog.byId.values()].map(summary),
    progress: store.data.progress,
    activity: store.data.activity,
    settings: store.settings,
    lessonsRead: store.data.lessonsRead,
  }));

  ipcMain.handle('compiler:detect', async (_e, force) => {
    const info = await judge.compilerInfo(Boolean(force));
    if (info.ok) judge.ensureRuntime().catch(() => {});
    return info;
  });

  ipcMain.handle('problem:get', (_e, id) => {
    const p = catalog.byId.get(id);
    if (!p) return null;
    return {
      ...publicProblem(p),
      draft: store.draft(id),
      testcases: store.testcases(id),
      progress: store.data.progress[id] || { status: 'todo' },
    };
  });

  ipcMain.handle('problem:solution', (_e, id) => {
    const p = catalog.byId.get(id);
    return p ? { solution: p.solution, editorial: p.editorial } : null;
  });

  ipcMain.handle('problem:run', async (_e, id, code, cases) => {
    const p = catalog.byId.get(id);
    if (!p) return { verdict: 'internal_error', message: 'Unknown problem' };
    store.saveDraft(id, code);
    try {
      const result = await judge.judge(p, code, cases, { submit: false });
      store.record(id, result, code, false);
      return result;
    } catch (e) {
      return compilerProblem(e);
    }
  });

  ipcMain.handle('problem:submit', async (_e, id, code) => {
    const p = catalog.byId.get(id);
    if (!p) return { verdict: 'internal_error', message: 'Unknown problem' };
    store.saveDraft(id, code);
    try {
      const result = await judge.judge(p, code, p.tests, { submit: true });
      if (result.verdict !== 'compile_error') {
        // only the failing case's details matter for a submission
        const failed = result.failedCase !== null ? result.cases[result.failedCase] : null;
        result.cases = failed ? [failed] : [];
      }
      result.progress = store.record(id, result, code, true);
      result.activity = store.data.activity;
      return result;
    } catch (e) {
      return compilerProblem(e);
    }
  });

  ipcMain.handle('submissions:list', (_e, id) => store.submissions[id] || []);
  ipcMain.handle('draft:save', (_e, id, code) => store.saveDraft(id, code));
  ipcMain.handle('testcases:save', (_e, id, cases) => store.saveTestcases(id, cases));

  ipcMain.handle('playground:run', async (_e, code, stdin) => {
    try {
      return await judge.play(code, stdin || '');
    } catch (e) {
      return compilerProblem(e);
    }
  });
  ipcMain.handle('playground:get', () => ({ state: store.data.playground, examples }));
  ipcMain.handle('playground:save', (_e, state) => store.savePlayground(state));

  ipcMain.handle('visualizer:run', async (_e, code, stdin) => {
    try {
      return await judge.trace(code, stdin || '');
    } catch (e) {
      return compilerProblem(e);
    }
  });
  ipcMain.handle('visualizer:get', () => ({ state: store.data.visualizer, examples: vizExamples }));
  ipcMain.handle('visualizer:save', (_e, state) => store.saveVisualizer(state));
  ipcMain.handle('typing:get', () => ({ state: store.data.typing, snippets }));
  ipcMain.handle('typing:save', (_e, state) => store.saveTyping(state));

  ipcMain.handle('lessons:list', () => lessons.map(({ body, ...rest }) => rest));
  ipcMain.handle('lesson:get', (_e, id) => {
    const l = lessons.find((x) => x.id === id);
    if (l) store.markLessonRead(id);
    return l || null;
  });

  ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch));
  ipcMain.handle('progress:reset', () => {
    store.resetProgress();
    return true;
  });
  ipcMain.handle('app:openExternal', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    title: 'LeakCode',
    backgroundColor: store.settings.theme === 'light' ? '#f7f7f8' : '#15161b',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => {
    if (!SHOTS) {
      win.show();
      return;
    }
    win.showInactive();
    require('./tools/shots')(win, SHOTS, process.env.LEAKCODE_SHOTS_OUT || path.join(ROOT, 'shots'));
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://leakcode/index.html');
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ]));
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  judge = new Judge({ runtimeDir: path.join(ROOT, 'runtime'), cacheDir: path.join(app.getPath('userData'), 'cache') });
  loadContent();
  registerIpc();
  buildMenu();

  // Files are read with Node's fs rather than handed to Chromium as file://
  // URLs: fs copes with paths longer than 260 characters (deep install folders).
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(pathname)));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('Not found', { status: 404 });
    try {
      const data = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
  // warm up: find the compiler and build the runtime while the UI loads
  judge.compilerInfo().then((info) => { if (info.ok) judge.ensureRuntime().catch(() => {}); });
});

app.on('before-quit', () => { if (store) store.flush(); });
app.on('window-all-closed', () => app.quit());
