'use strict';
// Packs icon-<size>.png files into a Windows .ico (PNG-compressed entries).
//   node tools/make-ico.js <png-dir> <out.ico>

const fs = require('fs');
const path = require('path');

const [dir, out] = process.argv.slice(2);
const sizes = fs.readdirSync(dir)
  .map((f) => /^icon-(\d+)\.png$/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b);
const images = sizes.map((s) => fs.readFileSync(path.join(dir, `icon-${s}.png`)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);              // reserved
header.writeUInt16LE(1, 2);              // type: icon
header.writeUInt16LE(sizes.length, 4);
const entries = Buffer.alloc(16 * sizes.length);
let offset = 6 + entries.length;
sizes.forEach((s, i) => {
  const e = i * 16;
  entries.writeUInt8(s >= 256 ? 0 : s, e);       // width (0 means 256)
  entries.writeUInt8(s >= 256 ? 0 : s, e + 1);   // height
  entries.writeUInt8(0, e + 2);                  // palette colours
  entries.writeUInt8(0, e + 3);                  // reserved
  entries.writeUInt16LE(1, e + 4);               // colour planes
  entries.writeUInt16LE(32, e + 6);              // bits per pixel
  entries.writeUInt32LE(images[i].length, e + 8);
  entries.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, entries, ...images]));
console.log(`Wrote ${out} (${sizes.join(', ')} px)`);
