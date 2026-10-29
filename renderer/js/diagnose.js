// Turns compiler output, runtime errors and leak reports into explanations
// a learner can act on.

import { h, icon, fmtBytes, plural } from './util.js';

// How to fix each kind of runtime error reported by the LeakCode runtime.
const TIPS = {
  heap_overflow: 'Check your bounds. An array of `n` elements has indices `0..n-1`, and a string of length `n` needs `n + 1` bytes for its `\'\\0\'`. Typical culprits: `i <= n` instead of `i < n`, and `malloc(strlen(s))` instead of `malloc(strlen(s) + 1)`.',
  heap_underflow: 'Something wrote before the start of a block, usually index `-1` (e.g. `a[i - 1]` when `i` is 0) or a pointer moved back past the beginning.',
  use_after_free: 'After `free(p)` every pointer to that block is dangling. Read what you still need before freeing (save `next = node->next` first), and set pointers to `NULL` after freeing. After `realloc`, only the pointer it returned is valid.',
  write_after_free: 'Some pointer kept pointing at a freed block and was written through. Set pointers to `NULL` after freeing them.',
  double_free: 'Every block must be freed exactly once, by exactly one owner. Set the pointer to `NULL` right after `free(p)` (`free(NULL)` does nothing), and make sure two copies of the same pointer don\'t both free it.',
  invalid_free: 'Only pass `free` a pointer that `malloc`, `calloc` or `realloc` returned, unchanged. Never free locals, string literals, globals, inputs you don\'t own, or a pointer you moved with `p++`.',
  null_deref: 'Check pointers before dereferencing them: `if (p != NULL)`. In list loops, test `node != NULL` before touching `node->next`. Remember that functions like `malloc` and `strchr` can return `NULL`.',
  uninit_pointer: 'Initialize every pointer before using it. The fields of a fresh `malloc` block are garbage: set `node->next = NULL` right after allocating (or use `calloc`).',
  uninit_var: 'Give every local variable a value before reading it, e.g. `int sum = 0;`. MSVC fills uninitialized locals with 0xCC bytes, which show up as -858993460.',
  stack_corruption: 'A local array was written out of bounds. For `int a[4]` the valid indices are `0..3`. Check every loop that writes into a local array or string buffer.',
  stack_smash: 'A local array was written past its end. For `char buf[16]` you may write at most 15 characters plus the `\'\\0\'`.',
  stack_overflow: 'Every recursive call must make progress toward a base case, and the base case must be checked before recursing. For very deep inputs (like a 100 000-node list) use a loop instead.',
  wild_pointer: 'The pointer holds an address you never got from `malloc` or `&`. Common causes: an uninitialized pointer, arithmetic past the end of an array, or memory freed long ago.',
  div_zero: 'Check the divisor before dividing: `if (d != 0)`.',
  int_overflow: '`INT_MIN / -1` does not fit in an `int`. Handle that case separately or use a wider type.',
  bad_call: 'A function pointer must point to a real function before you call it. Also check local arrays for overflows: they can overwrite return addresses.',
  write_to_const: 'The parameter is `const`: your function promised not to modify it. Copy the data into memory you own (`malloc` + `memcpy`) if you need to change it.',
  memory_limit: 'Free memory you no longer need, and make sure allocations inside loops are matched by frees.',
  huge_alloc: 'Check the size before allocating. A negative `int` converted to `size_t` becomes a gigantic number.',
  crt_invalid_param: 'Check what you pass to C library functions: no `NULL` strings or streams, and destination buffers large enough.',
  abort: 'An `assert` failed or `abort()` was called. The assertion message (see stderr) says which assumption was false.',
  early_exit: 'Don\'t call `exit()` inside a solution: return from your function instead.',
  harness_check: 'The test harness found something wrong with the value your function returned.',
  stack_pointer: 'The stack pointer was corrupted, typically by calling a function through a pointer of the wrong type.',
};

const LEAK_TIP = 'Every `malloc`, `calloc` and `realloc` needs a matching `free` once the memory is no longer needed. Free temporary buffers before returning, and free the nodes you unlink from a list or tree.';

// Friendly explanations of common MSVC diagnostics.
const DIAG_HELP = {
  C2065: 'This name was never declared. Check the spelling, or declare the variable before using it.',
  C4013: 'You called a function the compiler hasn\'t seen: include its header (e.g. `<string.h>` for `strlen`) or define it above its first use.',
  C2143: 'Syntax error: usually a missing `;` at the end of the previous line, or an unbalanced bracket.',
  C2059: 'The compiler could not parse this line. Check brackets, parentheses and semicolons.',
  C2371: 'This definition doesn\'t match the declaration the problem provides. Keep the exact function signature from the starter code.',
  C4028: 'A parameter type differs from the problem\'s declaration. Keep the exact signature from the starter code (including `const`).',
  C4029: 'The parameter list differs from the problem\'s declaration. Keep the exact signature from the starter code.',
  C4047: 'A pointer and a non-pointer are mixed up (or `int *` and `int **`). Look for a missing `*` or `&`.',
  C4024: 'An argument has the wrong type for this parameter.',
  C4133: 'Incompatible pointer types (e.g. a `struct A *` where a `struct B *` is expected).',
  C4020: 'Too many arguments in this function call.',
  C2198: 'Too few arguments in this function call.',
  C2057: 'MSVC does not support variable-length arrays like `int a[n]`. Allocate it instead: `int *a = malloc(n * sizeof *a);` (and free it).',
  C2466: 'An array cannot have size 0 or a size computed at run time on MSVC. Use `malloc` for run-time sizes.',
  C2037: 'The struct is only declared, not defined, at this point, so its fields are unknown. Define the struct before using its fields.',
  C2223: 'The struct is incomplete here: define its fields before using `->`.',
  C2232: 'Use `.` on a struct value and `->` on a pointer to a struct.',
  C2231: 'This is a pointer to a struct: use `->` instead of `.`.',
  C2106: 'The left side of `=` is not something you can assign to (an array name, a function call, a constant...).',
  C2440: 'The value cannot be converted to the target type. Check pointer types and casts.',
  C4716: 'The function must return a value, but it has no `return` statement.',
  C4715: 'Some path through the function reaches the end without returning a value.',
  C4700: 'This variable is read before it is given a value.',
  C4172: 'This returns the address of a local variable, which is destroyed when the function returns: a dangling pointer. Return memory from `malloc` instead.',
  C4244: 'A wider type is converted to a narrower one (e.g. `double` to `int`), which can lose data.',
  C4267: 'A `size_t` (64-bit) is stored in a smaller type such as `int`.',
  C4018: 'Signed/unsigned comparison: e.g. `int i < strlen(s)`. A negative value would compare as a huge positive number.',
  C2084: 'This function is defined twice.',
  C1004: 'The file ended unexpectedly: a `{` or a comment is never closed.',
  C2449: 'There is code outside of any function (a stray `{` or statement at file scope).',
  C2054: 'Expected `(` after this name. Check the previous line for a typo.',
  C4098: 'A `void` function cannot return a value.',
};

function inlineCode(text) {
  const span = h('span');
  String(text).split(/(`[^`]+`)/).forEach((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) span.append(h('code', null, part.slice(1, -1)));
    else span.append(part);
  });
  return span;
}

export function explainDiagnostic(d) {
  if (d.code === 'LNK2005' && /\bmain\b/.test(d.message)) {
    return 'Don\'t write `main()` in a problem: the test harness provides it. Use the Playground for complete programs.';
  }
  if (d.code === 'LNK2019' || d.code === 'LNK2001') {
    const m = /unresolved external symbol (\w+)(?: referenced in function (\w+))?/.exec(d.message);
    if (m && d.file === 'driver.obj') return `The test harness calls \`${m[1]}\`, but your code doesn't define it. Check the function's name and spelling.`;
    if (m) return `\`${m[1]}\` is called${m[2] ? ` in \`${m[2]}\`` : ''} but never defined. Is it a typo, or a function you forgot to write?`;
  }
  return DIAG_HELP[d.code] || null;
}

export function renderDiagnostics(diags, { onGoto }) {
  const list = h('ul', { class: 'diag-list' });
  const shown = diags.filter((d) => d.severity !== 'note' && d.code !== 'LNK1120' && d.code !== 'LNK1169');
  for (const d of shown) {
    const friendly = explainDiagnostic(d);
    list.append(h('li', {
      class: d.severity,
      onclick: () => d.line && onGoto && onGoto(d.line),
    },
    h('span', { class: 'sev' }, d.severity === 'error' ? 'error' : 'warning'),
    h('div', null,
      h('div', null, d.line ? h('span', { class: 'loc' }, `Line ${d.line}: `) : null, d.message),
      friendly ? h('div', { class: 'diag-friendly' }, inlineCode(friendly)) : null)));
  }
  return list;
}

// ------------------------------------------------------------------ frames

function isUser(f) { return f && f.k === 'user'; }

function compressFrames(frames) {
  const out = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && last.fn === f.fn && last.line === f.line && last.file === f.file) last.times += 1;
    else out.push({ ...f, times: 1 });
  }
  return out;
}

function renderTrace(frames, onGoto) {
  const list = h('ul', { class: 'trace' });
  compressFrames(frames).slice(0, 12).forEach((f, i) => {
    let where;
    if (f.k === 'user') where = h('span', { class: 'at' }, `${f.file}:${f.line}`);
    else if (f.k === 'harness') where = h('span', { class: 'at' }, 'test harness');
    else where = h('span', { class: 'at' }, '(C library)');
    list.append(h('li', {
      class: `${f.k}${i === 0 ? ' first' : ''}`,
      onclick: f.k === 'user' && onGoto ? () => onGoto(f.line) : null,
      title: f.k === 'user' ? 'Show this line in the editor' : null,
    },
    h('span', { class: 'arrow' }, i === 0 ? '▸' : '↳'),
    h('span', { class: 'fn' }, `${f.fn}()`),
    h('span', null, f.k === 'lib' ? ' ' : i === 0 ? ' at ' : ' called from '),
    where,
    f.times > 1 ? h('span', { class: 'at' }, `  ×${f.times}${f.times >= 20 ? '+' : ''}`) : null));
  });
  return list;
}

function siteLabel(stack, site, onGoto) {
  const f = (stack || []).find(isUser);
  if (f) {
    return h('span', null,
      h('span', { class: 'lnk', onclick: () => onGoto && onGoto(f.line) }, `${f.file}:${f.line}`),
      ` in ${f.fn}()`);
  }
  if (site && site.file && !/harness|driver|lc_/i.test(site.file) && site.line) {
    return h('span', { class: 'lnk', onclick: () => onGoto && onGoto(site.line) }, `${site.file}:${site.line}`);
  }
  return h('span', null, 'the test harness');
}

function renderBlock(block, onGoto) {
  if (!block) return null;
  const rows = [];
  const what = block.harness
    ? `${fmtBytes(block.size)} input block (an array or string the test harness passed to your function)`
    : `${fmtBytes(block.size)} block`;
  rows.push(h('div', null, h('b', null, 'Memory: '), what));
  if (!block.harness) rows.push(h('div', null, h('b', null, 'Allocated at '), siteLabel(block.allocStack, block.alloc, onGoto)));
  if (block.freed) {
    rows.push(h('div', null, h('b', null, block.realloc ? 'Released by realloc at ' : 'Freed at '),
      block.harness && !block.freeStack?.some(isUser) ? h('span', null, 'the end of the previous test case')
        : siteLabel(block.freeStack, block.free, onGoto)));
  }
  return h('div', { class: 'block-info' }, rows);
}

// A runtime error report (the "fatal" record from the runtime).
export function renderFatal(fatal, { onGoto } = {}) {
  const frames = fatal.frames || [];
  const firstReal = frames.find((f) => f.k !== 'lib');
  const notes = [];
  if (firstReal && firstReal.k === 'harness' && fatal.kind !== 'bad_input') {
    notes.push('The crash happened inside the test harness while it was using what your function returned or left behind. '
      + 'Your result is probably malformed: a string without its \'\\0\', a list that contains freed nodes, or a dangling pointer.');
  }
  if (frames[0] && frames[0].k === 'lib' && frames.some(isUser)) {
    notes.push(`The crash happened inside ${frames[0].fn}(), a C library function your code called: check the arguments you passed to it (sizes, buffer lengths, NULL pointers).`);
  }
  if (fatal.kind === 'stack_overflow' && frames.length) {
    const rec = compressFrames(frames)[0];
    if (rec && rec.k === 'user') notes.push(`${rec.fn}() keeps calling itself without reaching a base case.`);
  }
  const tip = TIPS[fatal.kind];
  return h('div', { class: 'err-card' },
    h('div', { class: 'err-head' }, icon('alert'), fatal.title || 'Runtime error', h('span', { class: 'err-kind' }, fatal.kind)),
    fatal.ctx ? h('div', { class: 'err-msg', style: { marginBottom: 0 } }, h('b', null, `While the test harness was freeing ${fatal.ctx}:`)) : null,
    h('div', { class: 'err-msg' }, fatal.msg),
    notes.map((n) => h('div', { class: 'err-ctx' }, n)),
    frames.length ? renderTrace(frames, onGoto) : null,
    renderBlock(fatal.block, onGoto),
    tip ? h('div', { class: 'tip' }, icon('bulb'), h('div', null, h('b', null, 'How to fix: '), inlineCode(tip))) : null);
}

// leaks: [{ bytes, count, site, frames }]
export function renderLeaks({ leaks, leakBytes, leakBlocks }, { onGoto, atExit = false } = {}) {
  const list = h('ul', { class: 'leak-sites' });
  let harnessLeak = false;
  for (const l of leaks || []) {
    const userFrames = (l.frames || []).filter(isUser);
    const byHarness = !userFrames.length;
    if (byHarness) harnessLeak = true;
    list.append(h('li', null,
      h('span', { class: 'bytes' }, `${fmtBytes(l.bytes)}`),
      h('span', null, `${plural(l.count, 'block')} allocated `,
        byHarness ? 'by the test harness' : h('span', null, 'at ', h('span', { class: 'lnk', onclick: () => onGoto && onGoto(userFrames[0].line) }, `${userFrames[0].file}:${userFrames[0].line}`), ` in ${userFrames[0].fn}()`)),
      userFrames.length > 1 ? h('span', { class: 'via' }, `← ${userFrames.slice(1, 3).map((f) => `${f.fn}():${f.line}`).join(' ← ')}`) : null));
  }
  return h('div', { class: 'err-card leak' },
    h('div', { class: 'err-head' }, icon('drop'), `Memory leak: ${fmtBytes(leakBytes)} in ${plural(leakBlocks, 'block')} never freed`),
    h('div', { class: 'err-msg' }, atExit
      ? 'When the program ended, these blocks were still allocated. Each one needs a matching free().'
      : 'When the test case ended, these blocks were still allocated and nothing pointed to them any more from the caller\'s side.'),
    list,
    harnessLeak ? h('div', { class: 'err-ctx' }, 'Blocks allocated by the test harness are parts of the input (for example list nodes). If your code unlinks such a node, it becomes responsible for freeing it.') : null,
    h('div', { class: 'tip' }, icon('bulb'), h('div', null, h('b', null, 'How to fix: '), inlineCode(LEAK_TIP))));
}

// Editor marks for a crash line and leaking allocation sites.
export function marksFor(fatal, leaks) {
  const marks = [];
  if (fatal) {
    const f = (fatal.frames || []).find(isUser);
    if (f) marks.push({ line: f.line, kind: 'crash', message: `**${fatal.title}**\n\n${fatal.msg}` });
  }
  for (const l of leaks || []) {
    const f = (l.frames || []).find(isUser);
    if (f) marks.push({ line: f.line, kind: 'leak', message: `**Leaked:** ${fmtBytes(l.bytes)} in ${plural(l.count, 'block')} allocated here ${l.count > 1 ? 'were' : 'was'} never freed.` });
  }
  return marks;
}

export const VERDICTS = {
  accepted: { label: 'Accepted', tone: 'good' },
  wrong_answer: { label: 'Wrong Answer', tone: 'bad' },
  runtime_error: { label: 'Runtime Error', tone: 'bad' },
  memory_leak: { label: 'Memory Leak', tone: 'warn' },
  time_limit: { label: 'Time Limit Exceeded', tone: 'bad' },
  output_limit: { label: 'Output Limit Exceeded', tone: 'bad' },
  compile_error: { label: 'Compile Error', tone: 'bad' },
  invalid_input: { label: 'Invalid Test Case', tone: 'warn' },
  no_compiler: { label: 'Compiler Not Found', tone: 'bad' },
  internal_error: { label: 'Internal Error', tone: 'bad' },
  ok: { label: 'Finished', tone: 'good' },
};
