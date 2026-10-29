'use strict';
// Loads the "Learn" lessons and the playground examples.
//
// lessons/*.md start with an HTML comment holding JSON metadata:
//   <!-- {"title": "...", "summary": "...", "practice": ["problem-id"]} -->
// playground/examples.lc holds examples separated by
//   @@@ example <id> <title>

const fs = require('fs');
const path = require('path');

function loadLessons(dir) {
  const lessons = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    const m = /^<!--\s*(\{[\s\S]*?\})\s*-->\n?/.exec(text);
    const meta = m ? JSON.parse(m[1]) : {};
    const body = m ? text.slice(m[0].length) : text;
    lessons.push({
      id: f.replace(/^\d+-/, '').replace(/\.md$/, ''),
      number: lessons.length + 1,
      title: meta.title || f,
      summary: meta.summary || '',
      practice: meta.practice || [],
      minutes: Math.max(2, Math.round(body.split(/\s+/).length / 200)),
      body,
    });
  }
  return lessons;
}

function loadExamples(file) {
  const examples = [];
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^@@@ example (\S+) (.+)$/.exec(line);
    if (m) {
      cur = { id: m[1], title: m[2].trim(), lines: [] };
      examples.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return examples.map((e) => ({ id: e.id, title: e.title, code: `${e.lines.join('\n').trim()}\n` }));
}

module.exports = { loadLessons, loadExamples };
