// Markdown rendering with Monaco syntax colouring for C code blocks.
// All Markdown comes from the app's own content files.

import { marked } from '../vendor/marked.esm.js';
import { h, icon } from './util.js';
import { getMonaco } from './editor.js';

marked.setOptions({ gfm: true });

export async function colorize(codeEl, text) {
  const monaco = await getMonaco();
  codeEl.innerHTML = await monaco.editor.colorize(text, 'c', { tabSize: 4 });
}

const typeButton = (onType, text) => h('button', { class: 'btn sm', title: 'Practise typing this code', onclick: () => onType(text) }, icon('keyboard'), 'Type it');

// onTryIt(code) / onVisualize(code): when given, complete programs get
// "Visualize" and "Run in Playground" buttons. onType(code): every C block
// gets a "Type it" button for typing practice.
export function renderMarkdown(md, { onTryIt, onVisualize, onType } = {}) {
  const el = h('div', { class: 'md' });
  el.innerHTML = marked.parse(md || '');
  for (const code of el.querySelectorAll('pre > code')) {
    const lang = (/language-(\w+)/.exec(code.className) || [])[1] || 'c';
    const text = code.textContent.replace(/\n$/, '');
    if (['c', 'h', 'cpp'].includes(lang)) colorize(code, text);
    const program = (onTryIt || onVisualize) && /\bint\s+main\s*\(/.test(text);
    const typeable = onType && /\blanguage-c\b/.test(code.className);     // not diagrams or plain text
    if (program || typeable) {
      code.parentElement.append(h('div', { class: 'code-actions' },
        program && onVisualize ? h('button', { class: 'btn sm primary', onclick: () => onVisualize(text) }, icon('eye'), 'Visualize') : null,
        program && onTryIt ? h('button', { class: 'btn sm', onclick: () => onTryIt(text) }, icon('play'), 'Run in Playground') : null,
        typeable ? typeButton(onType, text) : null));
    }
  }
  for (const a of el.querySelectorAll('a[href^="https://"]')) a.setAttribute('target', '_blank');
  return el;
}

export function codeBlock(text, { onType } = {}) {
  const code = h('code');
  code.textContent = text;
  colorize(code, text.replace(/\n$/, ''));
  return h('pre', null, code, onType ? h('div', { class: 'code-actions' }, typeButton(onType, text)) : null);
}
