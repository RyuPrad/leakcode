'use strict';
// Builds the Windows app into dist/LeakCode-win32-x64/LeakCode.exe.
//   npm run package

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');

(async () => {
  execFileSync(process.execPath, [path.join(__dirname, 'copy-vendor.js')], { stdio: 'inherit' });
  const [appDir] = await packager({
    dir: root,
    name: 'LeakCode',
    executableName: 'LeakCode',
    platform: 'win32',
    arch: 'x64',
    out: path.join(root, 'dist'),
    overwrite: true,
    asar: false,
    prune: true,
    icon: path.join(root, 'build', 'icon.ico'),
    appCopyright: 'LeakCode',
    win32metadata: {
      CompanyName: 'LeakCode',
      FileDescription: 'LeakCode: practice C and memory management',
      ProductName: 'LeakCode',
      InternalName: 'LeakCode',
    },
    ignore: [
      /^\/dist($|\/)/,
      /^\/tools($|\/)/,
      /^\/shots($|\/)/,
      /^\/build\/icons($|\/)/,
      /^\/node_modules($|\/)/,
      /^\/\.git($|\/)/,
      /^\/README\.md$/,
    ],
  });
  // the UI is English-only: keep one Chromium locale (saves ~48 MB)
  const locales = path.join(appDir, 'locales');
  for (const f of fs.readdirSync(locales)) {
    if (f !== 'en-US.pak') fs.rmSync(path.join(locales, f));
  }
  console.log(`Packaged: ${path.join(appDir, 'LeakCode.exe')}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
