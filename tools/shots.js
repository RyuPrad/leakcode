'use strict';
// Development aid: drives the app through a list of steps and saves
// screenshots. Used by main.js only when LEAKCODE_SHOTS is set:
//   LEAKCODE_SHOTS=<steps.json> LEAKCODE_SHOTS_OUT=<dir> electron .
// Each step: { "hash": "#/problems", "js": "...", "wait": 1500, "shot": "name", "log": "js expr" }

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = async function shots(win, stepsFile, outDir) {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const log = [];
  wc.on('console-message', (e) => {
    const { level, message, lineNumber, sourceId } = e;
    if (level === 'warning' || level === 'error' || level >= 2) log.push(`[${level}] ${message} (${sourceId}:${lineNumber})`);
  });
  await wait(2500);
  for (const step of steps) {
    try {
      if (step.size) win.setContentSize(step.size[0], step.size[1]);
      if (step.hash) await wc.executeJavaScript(`location.hash = ${JSON.stringify(step.hash)}`);
      if (step.js) await wc.executeJavaScript(step.js);
      await wait(step.wait || 1500);
      if (step.log) log.push(`${step.log} => ${JSON.stringify(await wc.executeJavaScript(step.log))}`);
      if (step.shot) {
        const img = await wc.capturePage();
        fs.writeFileSync(path.join(outDir, `${step.shot}.png`), img.toPNG());
      }
    } catch (e) {
      log.push(`step ${JSON.stringify(step).slice(0, 80)} failed: ${e.message}`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'console.log'), log.join('\n'));
  app.quit();
};
