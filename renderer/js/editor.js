// Monaco editor setup: themes, C completions and hovers, and the markers
// that show compiler diagnostics and runtime memory errors in the code.

import { state } from './state.js';
import { completionItems, hoverFor } from './cdocs.js';

let setupDone = false;
const editors = new Set();
let editorCount = 0;

export async function getMonaco() {
  const monaco = await window.monacoReady;
  if (!setupDone) {
    setupDone = true;
    setup(monaco);
  }
  return monaco;
}

export function themeName() {
  return state.settings.theme === 'light' ? 'leak-light' : 'leak-dark';
}

function setup(monaco) {
  monaco.editor.defineTheme('leak-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6f7891', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'b39bff' },
      { token: 'string', foreground: '9fd890' },
      { token: 'number', foreground: 'f5b46b' },
      { token: 'type', foreground: '72c7f2' },
      { token: 'keyword.directive', foreground: 'f08cb0' },
    ],
    colors: {
      'editor.background': '#1b1d24',
      'editor.lineHighlightBackground': '#23262f',
      'editorLineNumber.foreground': '#4d5263',
      'editorLineNumber.activeForeground': '#a4aaba',
      'editorGutter.background': '#1b1d24',
      'editor.selectionBackground': '#3b4470',
      'editorIndentGuide.background1': '#262935',
      'editorWidget.background': '#22252e',
      'editorSuggestWidget.background': '#22252e',
      'editorHoverWidget.background': '#22252e',
      'editorHoverWidget.border': '#3a3f4d',
    },
  });
  monaco.editor.defineTheme('leak-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a90a0', fontStyle: 'italic' },
      { token: 'keyword', foreground: '6a3fd4' },
      { token: 'string', foreground: '2f8a3c' },
      { token: 'number', foreground: 'b45b0a' },
      { token: 'type', foreground: '1a73b8' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.lineHighlightBackground': '#f4f5f9',
      'editorLineNumber.foreground': '#b4b9c6',
    },
  });
  monaco.editor.setTheme(themeName());

  monaco.languages.registerCompletionItemProvider('c', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };
      return { suggestions: completionItems(monaco, range) };
    },
  });
  monaco.languages.registerHoverProvider('c', {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const contents = hoverFor(word.word);
      if (!contents) return null;
      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents,
      };
    },
  });
}

function editorOptions() {
  const s = state.settings;
  return {
    theme: themeName(),
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: s.fontSize || 14,
    tabSize: s.tabSize || 4,
    insertSpaces: true,
    detectIndentation: false,
    minimap: { enabled: Boolean(s.minimap) },
    wordWrap: s.wordWrap ? 'on' : 'off',
  };
}

// "Tab out": with the cursor just before a closing bracket, quote, `>` or
// `;`, Tab jumps past it instead of inserting spaces, so you can carry on
// after an automatically closed pair. In a line's indentation Tab indents.
const TAB_OUT = new Set([')', ']', '}', '"', "'", '>', ';']);

function tabOut(editor) {
  const pos = editor.getPosition();
  const line = editor.getModel().getLineContent(pos.lineNumber);
  const next = line[pos.column - 1];
  if (state.settings.tabOut !== false && TAB_OUT.has(next) && line.slice(0, pos.column - 1).trim()) {
    editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
  } else {
    editor.trigger('keyboard', 'tab', null);
  }
}

// keys: { run, submit } callbacks bound to Ctrl+' and Ctrl+Enter.
export async function createEditor(host, { value, readOnly = false, onChange, keys = {} }) {
  const monaco = await getMonaco();
  const editor = monaco.editor.create(host, {
    value,
    language: 'c',
    readOnly,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    glyphMargin: true,
    renderLineHighlight: 'all',
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: 'active' },
    padding: { top: 10, bottom: 10 },
    fixedOverflowWidgets: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggest: { showWords: true },
    ...editorOptions(),
  });
  // on Windows a model created from text without line breaks defaults to CRLF
  editor.getModel().setEOL(monaco.editor.EndOfLineSequence.LF);
  if (onChange) editor.onDidChangeModelContent(() => onChange(editor.getValue()));
  // Monaco's addCommand keybindings are shared by every editor (the last one
  // added wins) unless they depend on a context key only this editor has.
  const scope = `lcEditor${++editorCount}`;
  editor.createContextKey(scope, true);
  if (keys.run) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Quote, keys.run, scope);
  if (keys.submit) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, keys.submit, scope);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {}, scope);
  // Tab keeps its usual jobs for selections, suggestions and snippet fields
  editor.addCommand(monaco.KeyCode.Tab, () => tabOut(editor),
    `${scope} && editorTextFocus && !editorReadonly && !suggestWidgetVisible && !inSnippetMode && !editorHasSelection && !editorHasMultipleSelections`);
  editors.add(editor);
  editor.onDidDispose(() => editors.delete(editor));
  editor.lcDecorations = editor.createDecorationsCollection([]);
  return editor;
}

export async function applyEditorSettings() {
  const monaco = await getMonaco();
  monaco.editor.setTheme(themeName());
  for (const e of editors) e.updateOptions(editorOptions());
}

// Compiler diagnostics for `file` become squiggles in the editor.
export async function setCompileMarkers(editor, diagnostics, file) {
  const monaco = await getMonaco();
  const model = editor.getModel();
  if (!model) return;
  const markers = (diagnostics || [])
    .filter((d) => d.file === file && d.line > 0)
    .map((d) => {
      const line = Math.min(d.line, model.getLineCount());
      const col = Math.max(1, d.col || 1);
      const word = model.getWordAtPosition({ lineNumber: line, column: col });
      return {
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: `${d.code ? `${d.code}: ` : ''}${d.message}`,
        startLineNumber: line,
        startColumn: word ? word.startColumn : col,
        endLineNumber: line,
        endColumn: word ? word.endColumn : model.getLineMaxColumn(line),
      };
    });
  monaco.editor.setModelMarkers(model, 'compiler', markers);
}

// Highlights the line where the program crashed and the lines whose
// allocations leaked. marks: [{ line, kind: 'crash' | 'leak', message }]
export async function setRuntimeMarks(editor, marks) {
  const monaco = await getMonaco();
  const model = editor.getModel();
  if (!model) return;
  const n = model.getLineCount();
  const valid = (marks || []).filter((m) => m.line >= 1 && m.line <= n);
  editor.lcDecorations.set(valid.map((m) => ({
    range: new monaco.Range(m.line, 1, m.line, 1),
    options: {
      isWholeLine: true,
      className: m.kind === 'crash' ? 'lc-crash-line' : 'lc-leak-line',
      glyphMarginClassName: m.kind === 'crash' ? 'lc-crash-glyph' : 'lc-leak-glyph',
      glyphMarginHoverMessage: { value: m.message },
      hoverMessage: { value: m.message },
      overviewRuler: { color: m.kind === 'crash' ? '#f4707a' : '#f5b83d', position: monaco.editor.OverviewRulerLane.Left },
    },
  })));
}

export function clearMarks(editor) {
  getMonaco().then((monaco) => {
    const model = editor.getModel();
    if (model) monaco.editor.setModelMarkers(model, 'compiler', []);
    editor.lcDecorations.clear();
  });
}

export function revealLine(editor, line) {
  if (!line) return;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.focus();
}
