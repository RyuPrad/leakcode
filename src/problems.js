'use strict';
// Loads the problem set.
//
// Each file in problems/ holds one study-plan section and its problems:
//
//   @@@ section
//   {"id": "...", "title": "...", "summary": "..."}
//   @@@ problem some-problem-id
//   @@ meta          JSON: title, difficulty, topics, params, examples, hints...
//   @@ description   Markdown
//   @@ prelude       C declarations shared by the solution and the driver
//   @@ starter       the code the user starts from
//   @@ solution      reference solution (also produces expected outputs)
//   @@ driver        test driver (see runtime/lc_driver.h)
//   @@ tests         hidden tests: one JSON value per parameter per line,
//                    cases separated by blank lines
//   @@ editorial     Markdown explanation of the solution

const fs = require('fs');
const path = require('path');

function parseFile(text, file) {
  const out = { section: null, problems: [] };
  let problem = null, part = null, buf = [];
  const flush = () => {
    if (!part) return;
    const body = buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    if (part === 'section') out.section = JSON.parse(body);
    else if (problem) problem[part] = body;
    buf = [];
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    let m;
    if ((m = /^@@@ (section|problem)\s*(\S*)\s*$/.exec(line))) {
      flush();
      if (m[1] === 'section') {
        part = 'section';
      } else {
        problem = { id: m[2] };
        out.problems.push(problem);
        part = null;
      }
    } else if ((m = /^@@ (\w+)\s*$/.exec(line))) {
      flush();
      part = m[1];
    } else {
      buf.push(line);
    }
  }
  flush();
  if (!out.section) throw new Error(`${file}: missing @@@ section header`);
  return out;
}

function parseTests(text, nparams) {
  const cases = [];
  let cur = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      if (cur.length) { cases.push(cur); cur = []; }
      continue;
    }
    cur.push(line);
    if (cur.length === nparams) { cases.push(cur); cur = []; }
  }
  if (cur.length) cases.push(cur);
  return cases;
}

function loadProblems(dir) {
  const sections = [];
  const byId = new Map();
  let number = 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.lc')).sort();
  for (const f of files) {
    const parsed = parseFile(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    const section = { ...parsed.section, problems: [] };
    for (const p of parsed.problems) {
      const meta = JSON.parse(p.meta || '{}');
      const params = meta.params || [];
      const examples = (meta.examples || []).map((e) => ({ ...e, input: e.input.map(String) }));
      const hidden = parseTests(p.tests, params.length);
      const seen = new Set();
      const tests = [];
      for (const c of [...examples.map((e) => e.input), ...hidden]) {
        const key = c.join('\n');
        if (!seen.has(key)) { seen.add(key); tests.push(c); }
      }
      const problem = {
        id: p.id,
        number: ++number,
        section: section.id,
        title: meta.title,
        difficulty: meta.difficulty || 'Easy',
        topics: meta.topics || [],
        kind: meta.kind || 'standard',
        params,
        examples,
        hints: meta.hints || [],
        constraints: meta.constraints || [],
        memory: meta.memory || '',
        starterShould: meta.starterShould || null,
        description: p.description || '',
        editorial: p.editorial || '',
        prelude: p.prelude || '',
        starter: `${p.starter || ''}\n`,
        solution: `${p.solution || ''}\n`,
        driver: `${p.driver || ''}\n`,
        tests,
      };
      if (byId.has(problem.id)) throw new Error(`Duplicate problem id ${problem.id}`);
      byId.set(problem.id, problem);
      section.problems.push(problem.id);
    }
    sections.push(section);
  }
  return { sections, byId };
}

// What the UI is allowed to see before the user asks for the solution.
function publicProblem(p) {
  return {
    id: p.id, number: p.number, section: p.section, title: p.title, difficulty: p.difficulty,
    topics: p.topics, kind: p.kind, params: p.params, examples: p.examples, hints: p.hints,
    constraints: p.constraints, memory: p.memory, description: p.description, prelude: p.prelude,
    starter: p.starter, testCount: p.tests.length,
  };
}

function summary(p) {
  return {
    id: p.id, number: p.number, section: p.section, title: p.title,
    difficulty: p.difficulty, topics: p.topics, kind: p.kind,
  };
}

module.exports = { loadProblems, publicProblem, summary, parseTests };
