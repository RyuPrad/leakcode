'use strict';
// Copies the browser libraries the renderer loads (Monaco's AMD build and
// marked) from node_modules into renderer/vendor.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'renderer', 'vendor');

fs.rmSync(vendor, { recursive: true, force: true });
fs.mkdirSync(path.join(vendor, 'monaco'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs'), path.join(vendor, 'monaco', 'vs'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'monaco-editor', 'LICENSE'), path.join(vendor, 'monaco', 'LICENSE'));
fs.copyFileSync(path.join(root, 'node_modules', 'marked', 'lib', 'marked.esm.js'), path.join(vendor, 'marked.esm.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'marked', 'LICENSE'), path.join(vendor, 'marked.LICENSE'));
console.log('Copied Monaco and marked into renderer/vendor');
