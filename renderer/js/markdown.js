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

// onTryIt(code): when given, complete programs get a "Run in Playground" button.
export function renderMarkdown(md, { onTryIt } = {}) {
  const el = h('div', { class: 'md' });
  el.innerHTML = marked.parse(md || '');
  for (const code of el.querySelectorAll('pre > code')) {
    const lang = (/language-(\w+)/.exec(code.className) || [])[1] || 'c';
    const text = code.textContent.replace(/\n$/, '');
    if (['c', 'h', 'cpp'].includes(lang)) colorize(code, text);
    if (onTryIt && /\bint\s+main\s*\(/.test(text)) {
      code.parentElement.append(
        h('button', { class: 'btn sm play-btn', onclick: () => onTryIt(text) }, icon('play'), 'Run in Playground'));
    }
  }
  for (const a of el.querySelectorAll('a[href^="https://"]')) a.setAttribute('target', '_blank');
  return el;
}

export function codeBlock(text) {
  const code = h('code');
  code.textContent = text;
  colorize(code, text.replace(/\n$/, ''));
  return h('pre', null, code);
}
