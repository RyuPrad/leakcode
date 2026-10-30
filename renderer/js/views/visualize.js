// The memory visualizer: run a program line by line and watch its stack
// frames, heap blocks and pointers change (data from runtime/lc_trace.c).

import { h, icon, clear, fmtBytes, plural, debounce, makeResizable, confirmDialog } from '../util.js';
import { api } from '../state.js';
import { createEditor, setCompileMarkers, clearMarks, revealLine, getMonaco } from '../editor.js';
import { renderFatal, renderDiagnostics } from '../diagnose.js';
import { takePendingVisualizer } from '../actions.js';
import { openSettings } from './settings.js';

const SVG = 'http://www.w3.org/2000/svg';
const PLAY_MS = 900;

const ESCAPES = { 0: '\\0', 9: '\\t', 10: '\\n', 13: '\\r' };

function charText(c) {
  if (ESCAPES[c] !== undefined) return `'${ESCAPES[c]}'`;
  if (c >= 32 && c < 127) return `'${String.fromCharCode(c)}'`;
  return String(c);
}

function eachPointer(v, fn) {
  if (!v) return;
  if (v.k === 'ptr') fn(v.to || {});
  else if (v.k === 'arr') v.items.forEach((x) => eachPointer(x, fn));
  else if (v.k === 'struct') v.f.forEach((x) => eachPointer(x.v, fn));
}

// How many pointers away from the stack each heap block is: 1 for blocks a
// variable points to, 2 for blocks those blocks point to, and so on. Each
// variable claims everything it reaches before the next one, so a cursor
// into a list (p, tail, next) does not pull its node out of the chain.
function reachDepth(snap) {
  const byId = new Map(snap.heap.map((b) => [b.id, b]));
  const depth = new Map();
  const visit = (v, d, queue) => eachPointer(v, (to) => {
    if (byId.has(to.h) && !depth.has(to.h)) {
      depth.set(to.h, d);
      queue.push(to.h);
    }
  });
  snap.frames.forEach((f) => f.vars.forEach((v) => {
    const queue = [];
    visit(v.v, 1, queue);
    for (let i = 0; i < queue.length; i++) visit(byId.get(queue[i]).v, depth.get(queue[i]) + 1, queue);
  }));
  return depth;
}

function describeEvents(st, prev) {
  const out = [];
  const evs = st.ev || [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    const next = evs[i + 1];
    if ((e.e === 'malloc' || e.e === 'calloc') && next && next.e === 'realloc') {
      out.push({ tone: 'move', text: `realloc() at line ${next.line} moved the data of block #${next.h} into a new ${fmtBytes(e.size)} block #${e.h}, then freed #${next.h}.` });
      i++;
    } else if (e.e === 'malloc' || e.e === 'calloc') {
      out.push({ tone: 'add', text: `${e.e}() at line ${e.line} reserved a new ${fmtBytes(e.size)} block #${e.h} on the heap${e.e === 'malloc' ? ' (its bytes are garbage until you write them)' : ', filled with zeros'}.` });
    } else if (e.e === 'free') {
      out.push({ tone: 'free', text: `free() at line ${e.line} gave block #${e.h} back. Pointers to it are now dangling.` });
    } else if (e.e === 'realloc') {
      out.push({ tone: 'free', text: `realloc() at line ${e.line} released block #${e.h}.` });
    }
  }
  if (prev && !st.final) {
    const a = prev.frames.length, b = st.frames.length;
    if (b > a) out.push({ tone: 'call', text: `${st.frames[b - 1].fn}() was called: a new stack frame holds its parameters and local variables.` });
    else if (b < a) out.push({ tone: 'ret', text: `${prev.frames[a - 1].fn}() returned: its frame was removed, and its local variables no longer exist.` });
  }
  // pointers that became dangling in this step
  if (prev && !st.final) {
    st.frames.forEach((f, fi) => f.vars.forEach((v) => {
      if (v.v && v.v.k === 'ptr' && v.v.to && v.v.to.freed) {
        const pf = prev.frames[fi];
        const pv = pf && pf.fn === f.fn && pf.vars.find((x) => x.n === v.n);
        if (pv && !(pv.v && pv.v.to && pv.v.to.freed)) {
          out.push({ tone: 'warn', text: `${v.n} still holds the address of freed block #${v.v.to.h}: it is a dangling pointer. Using it is a bug; set it to NULL.` });
        }
      }
    }));
  }
  // blocks that just became unreachable (all frames must be there to tell)
  if (prev && !st.final && st.frames.length < 32) {
    const was = reachDepth(prev);
    const now = reachDepth(st);
    const existed = new Set(prev.heap.map((b) => b.id));
    for (const b of st.heap) {
      if (!b.freed && !now.has(b.id) && (was.has(b.id) || !existed.has(b.id))) {
        out.push({ tone: 'warn', text: `Block #${b.id} is no longer reachable: no variable points to it, directly or through other blocks. Unless a global variable holds its address, it can never be freed now: a memory leak.` });
      }
    }
  }
  return out;
}

export function renderVisualize(root) {
  let editor = null;
  let destroyed = false;
  let busy = false;
  let examples = [];
  let trace = null;
  let steps = [];
  let index = 0;
  let tracedCode = null;
  let playTimer = null;
  let prevValues = new Map();
  let lineMarks = null;
  let outTab = 'output';
  let arrowState = null;

  // ------------------------------------------------------------- layout
  const editorHost = h('div', { class: 'editor-host' });
  const runBtn = h('button', { class: 'btn primary', title: 'Run the program step by step (Ctrl+Enter)', onclick: () => run() }, icon('play'), 'Visualize');
  const exampleSelect = h('select', {
    class: 'input', style: { height: '28px', fontSize: '13px', maxWidth: '230px' },
    onchange: async (e) => {
      const ex = examples.find((x) => x.id === e.target.value);
      e.target.value = '';
      if (ex) await loadExample(ex);
    },
  }, h('option', { value: '' }, 'Load an example…'));
  const editorPane = h('div', { class: 'pane pane-editor' },
    h('div', { class: 'pane-head editor-head' },
      h('span', { class: 'lang' }, icon('code'), 'main.c'),
      h('div', { class: 'grow' }),
      exampleSelect,
      h('div', { class: 'run-bar', style: { marginLeft: '8px' } }, runBtn)),
    editorHost);

  const counter = h('span', { class: 'viz-counter' });
  const slider = h('input', { type: 'range', class: 'viz-slider', min: '0', max: '0', value: '0', oninput: (e) => { stop(); show(Number(e.target.value)); } });
  const btn = (name, title, fn) => h('button', { class: 'btn sm icon-only', title, onclick: () => { stop(); fn(); } }, icon(name));
  const playBtn = h('button', { class: 'btn sm', onclick: () => togglePlay() });
  const controls = h('div', { class: 'viz-controls' },
    btn('first', 'First step (Home)', () => show(0)),
    btn('left', 'Previous step (←)', () => show(index - 1)),
    counter,
    btn('right', 'Next step (→)', () => show(index + 1)),
    btn('last', 'Last step (End)', () => show(steps.length - 1)),
    h('div', { class: 'grow' }),
    playBtn);
  const story = h('div', { class: 'viz-story' });
  const outHead = h('div', { class: 'viz-out-tabs' });
  const outBody = h('div', { class: 'viz-out-body' });
  const stdin = h('textarea', { class: 'input viz-stdin', spellcheck: 'false', placeholder: 'Input for scanf/getchar/fgets, used when you press Visualize.' });
  const lower = h('div', { class: 'pane viz-lower' },
    h('div', { class: 'pane-head viz-lower-head' }, controls),
    h('div', { class: 'viz-lower-body' }, slider, story, outHead, outBody));
  const gutterH = h('div', { class: 'gutter h' });
  const left = h('div', { class: 'viz-left' }, editorPane, gutterH, lower);

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'viz-arrows');
  svg.innerHTML = '<defs>'
    + '<marker id="viz-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="head"/></marker>'
    + '<marker id="viz-head-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="head bad"/></marker>'
    + '</defs>';
  const grid = h('div', { class: 'viz-grid' });
  const banner = h('div', { class: 'viz-banner', style: { display: 'none' } });
  const canvas = h('div', { class: 'viz-canvas' }, svg, grid);
  const stage = h('div', { class: 'viz-stage' }, canvas);
  const legend = h('div', { class: 'viz-legend' },
    h('span', null, h('i', { class: 'lg-ptr' }), 'pointer'),
    h('span', null, h('i', { class: 'lg-garbage' }, '?'), 'uninitialized'),
    h('span', null, h('i', { class: 'lg-changed' }), 'changed'),
    h('span', null, h('i', { class: 'lg-freed' }), 'freed'),
    h('span', null, h('i', { class: 'lg-leak' }), 'leaked'));
  const mem = h('div', { class: 'pane viz-mem' },
    h('div', { class: 'pane-head' }, h('span', { class: 'tab active' }, icon('chip'), 'Memory'), h('div', { class: 'grow' }), legend),
    banner, stage);
  const gutterV = h('div', { class: 'gutter v' });
  const layout = h('div', { class: 'viz-layout' }, left, gutterV, mem);
  root.append(layout);
  makeResizable(gutterV, left, { axis: 'x', min: 340, max: () => layout.clientWidth - 420, key: 'lc.vizLeft' });
  makeResizable(gutterH, lower, { axis: 'y', min: 160, max: () => left.clientHeight - 160, invert: true, key: 'lc.vizLower' });

  const save = debounce(() => {
    if (editor) api.saveVisualizer({ code: editor.getValue(), stdin: stdin.value });
  }, 600);
  stdin.addEventListener('input', save);
  const resizeObserver = new ResizeObserver(() => drawArrows());
  resizeObserver.observe(stage);
  grid.addEventListener('animationend', () => drawArrows());   // new blocks pop in scaled

  // ------------------------------------------------------------- values

  function cell(text, cls, title) {
    return h('span', { class: `vcell${cls ? ` ${cls}` : ''}`, title }, text);
  }

  // Renders one value; `anchor` names it for arrows, `path` identifies it
  // across steps (to highlight changes). Array elements get compact chars.
  function valueEl(v, anchor, path, ctx, element) {
    let el;
    if (!v) return cell('?');
    switch (v.k) {
      case 'int':
      case 'num':
        el = cell(v.v);
        break;
      case 'bool':
        el = cell(String(v.v));
        break;
      case 'char':
        if (!element) el = cell(charText(v.c), 'char', `char code ${v.c}`);
        else if (v.c > 32 && v.c < 127) el = cell(String.fromCharCode(v.c), 'char short', `${charText(v.c)}, char code ${v.c}`);
        else el = cell(v.c === 32 ? '␣' : ESCAPES[v.c] || String(v.c), 'char short esc', `${v.c === 32 ? 'space' : charText(v.c)}, char code ${v.c}`);
        break;
      case 'g':
        el = cell('?', 'garbage', v.g === 2
          ? 'Uninitialized heap memory: malloc does not clear it (its bytes are 0xCD here).'
          : 'Uninitialized: this variable was never given a value (its bytes are 0xCC here).');
        break;
      case 'ptr':
        el = pointerEl(v, ctx);
        break;
      case 'arr':
        el = arrayEl(v, anchor, path, ctx);
        break;
      case 'struct': {
        el = h('div', { class: 'vstruct', title: v.t });
        v.f.forEach((f) => {
          el.append(h('div', { class: 'vfield' },
            h('span', { class: 'vfname', title: f.t }, f.n),
            valueEl(f.v, null, `${path}.${f.n}`, ctx)));
        });
        break;
      }
      case 'bytes': {
        el = h('div', { class: 'varr bytes', title: 'Raw bytes: no typed pointer points here' });
        v.items.forEach((b, k) => el.append(h('div', { class: 'vitem' }, h('span', { class: 'vidx' }, k), cell(b.toString(16).padStart(2, '0'), 'byte'))));
        if (v.n > v.items.length) el.append(cell('…', 'more'));
        break;
      }
      default:
        el = cell('…', 'more');
    }
    if (anchor) ctx.anchors.set(anchor, el);
    if (v.k !== 'arr' && v.k !== 'struct' && v.k !== 'bytes') {
      const text = el.textContent + (el.dataset.target || '');
      ctx.values.set(path, text);
      if (prevValues.has(path) && prevValues.get(path) !== text) el.classList.add('changed');
    }
    return el;
  }

  function pointerEl(v, ctx) {
    const to = v.to || {};
    if (to.null) return cell('NULL', 'null', 'NULL: points to nothing');
    if (to.garbage) return cell('?', 'garbage ptr', 'Uninitialized pointer: it holds garbage, not an address you own.');
    if (to.lit !== undefined) return cell(`"${to.lit}"`, 'lit', 'Points to a string literal (read-only memory)');
    if (to.fn) return cell(`${to.fn}()`, 'fnptr', 'Points to a function');
    if (to.static) return cell('global', 'lit', 'Points to a global or static variable');
    if (to.bad) return cell('invalid', 'bad', `Holds ${v.v}, which is not a valid address`);
    const dot = h('span', { class: 'dot' });
    const el = h('span', { class: `vcell ptr${to.freed ? ' dangling' : ''}`, title: `${v.v}${to.freed ? ' (freed memory: dangling!)' : ''}` }, dot);
    el.dataset.target = to.h !== undefined ? `h${to.h}+${to.o}` : `s${to.f}.${to.v}+${to.o}`;
    ctx.arrows.push({ from: dot, to, dangling: Boolean(to.freed) });
    return el;
  }

  function arrayEl(v, anchor, path, ctx) {
    const el = h('div', { class: 'varr', title: `${v.n} × ${v.t}` });
    v.items.forEach((item, k) => {
      const itemEl = valueEl(item, anchor ? `${anchor}:${k}` : null, `${path}[${k}]`, ctx, true);
      el.append(h('div', { class: 'vitem' }, h('span', { class: 'vidx' }, k), itemEl));
    });
    if (v.n > v.items.length) el.append(h('div', { class: 'vitem' }, h('span', { class: 'vidx' }, '…'), cell(`+${v.n - v.items.length}`, 'more')));
    if (anchor) ctx.sizes.set(anchor, { es: v.es, n: v.n });
    if (v.s !== undefined) {
      return h('div', { class: 'vstring' }, el,
        h('span', { class: `vstr${v.term ? '' : ' unterminated'}`, title: v.term ? 'The characters up to the first \\0' : 'No \\0 in sight: not a valid C string yet' }, `"${v.s}"`));
    }
    return el;
  }

  // ------------------------------------------------------------- memory

  function heapBlock(hb, snap, created, ctx) {
    const leaked = snap.final && !hb.freed;
    const anchor = `h:${hb.id}`;
    let label = 'raw bytes';
    if (hb.t) label = hb.v && hb.v.k === 'arr' ? `${hb.t}[${hb.v.n}]` : hb.t;
    const body = hb.freed
      ? h('div', { class: 'hfreed' }, hb.realloc ? 'moved by realloc' : 'freed')
      : valueEl(hb.v, anchor, anchor, ctx);
    const el = h('div', { class: `hblock${hb.freed ? ' freed' : ''}${leaked ? ' leaked' : ''}${created.has(hb.id) ? ' new' : ''}` },
      h('div', { class: 'hblock-head' },
        h('span', { class: 'hid' }, `#${hb.id}`),
        h('span', { class: 'htype' }, hb.freed ? '' : label),
        h('span', { class: 'hsize' }, fmtBytes(hb.size))),
      h('div', { class: 'hblock-body' }, body),
      h('div', { class: 'hblock-foot' }, hb.freed
        ? `allocated at line ${hb.line}, ${hb.realloc ? 'moved' : 'freed'} at line ${hb.fline}`
        : leaked ? `LEAKED: allocated at line ${hb.line}, never freed` : `allocated at line ${hb.line}`));
    ctx.anchors.set(anchor, el);
    return el;
  }

  // The stack and heap columns of one step. Heap blocks stand in columns by
  // their distance from the stack (pointed to by a variable, then by those
  // blocks, ...), so most arrows run between neighbouring columns; blocks no
  // variable reaches go below.
  function buildMemory(st, ctx) {
    const snap = st.pseudo ? st.base : st;
    if (!snap) return [h('div', { class: 'viz-empty big' }, 'The program stopped before main() started.')];
    const stackCol = h('section', { class: 'viz-col' }, h('div', { class: 'viz-col-title' }, 'Stack'));
    if (!snap.frames.length) {
      stackCol.append(h('div', { class: 'viz-empty' }, snap.final ? 'main() has returned: no frames are left.' : 'No frames.'));
    }
    snap.frames.forEach((f, fi) => {
      const vars = h('div', { class: 'vvars' });
      f.vars.forEach((v, vi) => {
        const anchor = `s:${fi}:${vi}`;
        const valEl = valueEl(v.v, anchor, `s:${fi}:${f.fn}:${v.n}`, ctx);
        vars.append(h('div', { class: `vvar${v.p ? ' param' : ''}` },
          h('span', { class: 'vname', title: `${v.p ? 'parameter' : 'local variable'} at ${v.a}` }, v.n),
          h('span', { class: 'vtype' }, v.t),
          h('div', { class: 'vval' }, valEl)));
      });
      if (!f.vars.length) vars.append(h('div', { class: 'viz-empty' }, 'no variables'));
      stackCol.append(h('div', { class: `vframe${fi === snap.frames.length - 1 && !st.pseudo ? ' current' : ''}` },
        h('div', { class: 'vframe-head' }, h('span', { class: 'vfn' }, `${f.fn}()`), h('span', { class: 'vline' }, `line ${f.line}`)),
        vars));
    });

    const heapCol = h('section', { class: 'viz-col' }, h('div', { class: 'viz-col-title' }, 'Heap'));
    const created = new Set((st.ev || []).filter((e) => e.e === 'malloc' || e.e === 'calloc').map((e) => e.h));
    if (!snap.heap.length) {
      heapCol.append(h('div', { class: 'viz-empty' }, snap.final ? 'Every block was freed. No leaks!' : 'Nothing allocated yet: blocks from malloc, calloc and realloc appear here.'));
    }
    const depth = reachDepth(snap);
    const columns = [];
    const lost = [];
    for (const hb of snap.heap) {
      const d = depth.get(hb.id);
      if (d === undefined) lost.push(hb);
      else (columns[d - 1] || (columns[d - 1] = [])).push(hb);
    }
    if (columns.length) {
      heapCol.append(h('div', { class: 'viz-layers' }, columns.map((col) => h('div', { class: 'viz-layer' }, col.map((hb) => heapBlock(hb, snap, created, ctx))))));
    }
    if (lost.length) {
      heapCol.append(h('div', { class: 'viz-lost' },
        snap.final ? null : h('div', { class: 'viz-col-sub' }, 'Not reachable from any variable'),
        h('div', { class: 'viz-blocks' }, lost.map((hb) => heapBlock(hb, snap, created, ctx)))));
    }
    return [stackCol, heapCol];
  }

  function renderMemory(st) {
    const ctx = { anchors: new Map(), sizes: new Map(), arrows: [], values: new Map() };
    clear(grid);
    grid.append(...buildMemory(st, ctx));
    arrowState = ctx;
    requestAnimationFrame(() => drawArrows());
  }

  // The values one step earlier, to highlight what the last line changed.
  function valuesOf(st) {
    const ctx = { anchors: new Map(), sizes: new Map(), arrows: [], values: new Map() };
    buildMemory(st, ctx);
    return ctx.values;
  }

  function targetEl(ctx, to) {
    const base = to.h !== undefined ? `h:${to.h}` : `s:${to.f}:${to.v}`;
    const size = ctx.sizes.get(base);
    if (size && size.es && to.o % size.es === 0) {
      const k = to.o / size.es;
      if (ctx.anchors.has(`${base}:${k}`)) return { el: ctx.anchors.get(`${base}:${k}`), item: k };
      if (k === size.n) return { el: ctx.anchors.get(`${base}:${k - 1}`) || ctx.anchors.get(base), end: true };
    }
    return { el: ctx.anchors.get(base) };
  }

  // Routes: to a column further right, into the nearest point of the
  // target's left edge (passing below any blocks in the way); back to an
  // earlier column, out to the right, below the blocks and up into the
  // target's bottom; within a column, down into the next block's top, or out
  // to the right and back. Elements inside an array are pointed at from below.
  function drawArrows(state = arrowState) {
    for (const p of [...svg.querySelectorAll('path.arrow')]) p.remove();
    if (!state || !canvas.isConnected) return;
    svg.setAttribute('width', canvas.scrollWidth);
    svg.setAttribute('height', canvas.scrollHeight);
    const base = canvas.getBoundingClientRect();
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { el, left: r.left - base.left, right: r.right - base.left, top: r.top - base.top, bottom: r.bottom - base.top };
    };
    const boxes = [...grid.querySelectorAll('.vframe, .hblock')].map(rect);
    const boxOf = (el) => boxes.find((b) => b.el.contains(el));
    const hit = (skip, test) => boxes.find((b) => !skip.includes(b) && test(b));
    // does the curve p0 c1 c2 p3 run through a box?
    const crosses = ([x0, y0], [ax, ay], [bx, by], [x3, y3], skip) => {
      for (let i = 1; i < 24; i++) {
        const t = i / 24, u = 1 - t;
        const x = u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x3;
        const y = u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y3;
        if (hit(skip, (o) => x > o.left + 2 && x < o.right - 2 && y > o.top + 2 && y < o.bottom - 2)) return true;
      }
      return false;
    };
    // Straight runs already used by routes: each new one gets its own track.
    const hRuns = [], vRuns = [];
    const laneBelow = (y, a, b, skip) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let n = 0; n < 24; n++) {
        const box = hit(skip, (o) => o.left < hi && o.right > lo && o.top < y + 8 && o.bottom > y - 8);
        const run = !box && hRuns.find((l) => Math.abs(l.y - y) < 7 && l.lo < hi && l.hi > lo);
        if (box) y = box.bottom + 14;
        else if (run) y = run.y + 8;
        else break;
      }
      hRuns.push({ y, lo, hi });
      return y;
    };
    const track = (x, a, b, step, skip) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let n = 0; n < 24; n++) {
        const box = hit(skip, (o) => o.left < x + 4 && o.right > x - 4 && o.top < hi && o.bottom > lo);
        const run = !box && vRuns.find((l) => Math.abs(l.x - x) < 6 && l.lo < hi && l.hi > lo);
        if (box) x = step > 0 ? box.right + 12 : box.left - 12;
        else if (run) x = run.x + step;
        else break;
      }
      vRuns.push({ x, lo, hi });
      return x;
    };
    // a path through axis-aligned points, with rounded corners
    const rounded = (pts) => {
      let path = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
        const k = Math.min(10, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
        path += ` L${x - Math.sign(x - px) * k},${y - Math.sign(y - py) * k} Q${x},${y} ${x + Math.sign(nx - x) * k},${y + Math.sign(ny - y) * k}`;
      }
      return `${path} L${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
    };
    const fromBelow = new Map();   // arrows already entering an element's bottom
    for (const a of state.arrows) {
      const t = targetEl(state, a.to);
      if (!t.el || !a.from.isConnected) continue;
      const s = rect(a.from), r = rect(t.el);
      const x1 = (s.left + s.right) / 2, y1 = (s.top + s.bottom) / 2;
      const src = boxOf(a.from) || s, dst = boxOf(t.el) || r;
      const skip = [src, dst];
      const edge = Math.min((r.bottom - r.top) / 2, 14);
      const nearY = Math.min(Math.max(y1, r.top + edge), r.bottom - edge);
      // a pointer stored in an array leaves vertically, not across its neighbours
      const inArray = a.from.parentElement.parentElement.classList.contains('vitem');
      const exit = (x2, y2) => (inArray ? [x1, y1 + (y2 > y1 + 8 ? 40 : -40)] : [x1 + Math.max(40, Math.abs(x2 - x1) / 2), y1]);
      let x2, y2, c1, c2, d = null;
      if (t.end) {
        // one past the last element: the array's right edge
        x2 = r.right + 2; y2 = nearY;
        c1 = exit(x2, y2); c2 = [x2 + 40, y2];
      } else if (t.item > 0) {
        x2 = (r.left + r.right) / 2; y2 = r.bottom + 2;
        c1 = exit(x2, y2); c2 = [x2, y2 + 46];
      } else if (dst.left >= src.right - 1) {
        x2 = r.left - 2; y2 = nearY;
        c1 = exit(x2, y2); c2 = [x2 - Math.max(40, (x2 - x1) / 2), y2];
        if (src.el.classList.contains('vframe') && crosses([x1, y1], c1, c2, [x2, y2], skip)) {
          const lane = laneBelow(Math.max(y1, y2), src.right + 16, dst.left - 16, skip);
          const xa = track(src.right + 16, y1, lane, 7, skip);
          const xb = track(dst.left - 16, lane, y2, -7, skip);
          d = rounded([[x1, y1], [xa, y1], [xa, lane], [xb, lane], [xb, y2], [x2, y2]]);
        }
      } else if (dst.right <= src.left + 1) {
        const n = fromBelow.get(t.el) || 0;
        fromBelow.set(t.el, n + 1);
        x2 = Math.min(r.left + Math.min((r.right - r.left) / 2, 24) + 12 * n, r.right - 8); y2 = r.bottom + 2;
        const lane = laneBelow(Math.max(src.bottom, dst.bottom) + 14, x2, src.right + 40, skip);
        const xr = track(src.right + 14, y1, lane, 7, skip);
        d = rounded([[x1, y1], [xr, y1], [xr, lane], [x2, lane], [x2, y2]]);
      } else if (dst.top >= src.bottom - 1 && !hit(skip, (o) => o.top < dst.top && o.bottom > src.bottom && o.left < dst.right && o.right > dst.left)) {
        x2 = Math.min(Math.max(x1, r.left + 16), r.right - 16); y2 = r.top - 2;
        c1 = [x1, y1 + 40]; c2 = [x2, y2 - 40];
      } else {
        x2 = r.right + 2; y2 = nearY;
        let bulge = Math.max(x1, x2) + 30;
        for (let n = 0, b; n < 6 && (b = hit(skip, (o) => o.left < bulge && o.right > bulge && o.top < Math.max(y1, y2) && o.bottom > Math.min(y1, y2))); n++) bulge = b.right + 22;
        const cx = (8 * bulge - x1 - x2) / 6;
        c1 = [cx, y1]; c2 = [cx, y2];
      }
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d || `M${x1},${y1} C${c1} ${c2} ${x2},${y2}`);
      path.setAttribute('class', `arrow${a.dangling ? ' dangling' : ''}`);
      path.setAttribute('marker-end', `url(#${a.dangling ? 'viz-head-bad' : 'viz-head'})`);
      svg.append(path);
    }
  }

  // ------------------------------------------------------------- step UI

  function renderStory(st, i) {
    clear(story);
    if (!trace) return;
    const prev = i > 0 ? steps[i - 1] : null;
    const items = [];
    if (st.pseudo === 'error') {
      story.append(renderFatal(trace.fatal, { onGoto: (line) => editor && revealLine(editor, line) }));
      return;
    }
    if (st.final) {
      const leaks = st.heap.filter((b) => !b.freed);
      items.push({ tone: 'end', text: `main() returned ${st.ret}: the program has finished.` });
      if (leaks.length) {
        const bytes = leaks.reduce((s, b) => s + b.size, 0);
        items.push({ tone: 'warn', text: `${plural(leaks.length, 'block')} (${fmtBytes(bytes)}) were never freed: a memory leak. Nothing points to ${leaks.length > 1 ? 'them' : 'it'} any more, so ${leaks.length > 1 ? 'they' : 'it'} can never be freed.` });
      } else {
        items.push({ tone: 'ok', text: 'Every heap block was freed: no leaks.' });
      }
    } else {
      items.push({ tone: 'next', text: i === 0 ? `The program starts in main(). Line ${st.line} runs next.` : `Line ${st.line} runs next.` });
    }
    items.push(...describeEvents(st, prev && !prev.pseudo ? prev : null));
    for (const it of items) {
      story.append(h('div', { class: `viz-note ${it.tone}` }, it.text));
    }
    if (trace.truncated && i === steps.length - 1) {
      story.append(h('div', { class: 'viz-note warn' }, 'The visualizer stops recording after 1000 steps; the program continued without it.'));
    }
  }

  function renderOutTabs() {
    clear(outHead);
    const tab = (key, label) => h('button', {
      class: `tab${outTab === key ? ' active' : ''}`,
      onclick: () => { outTab = key; renderOutTabs(); renderOutput(); },
    }, label);
    outHead.append(tab('output', 'Output'), tab('input', 'Input (stdin)'));
  }

  function renderOutput() {
    clear(outBody);
    if (outTab === 'input') {
      outBody.append(stdin);
      return;
    }
    if (!trace || !steps.length) {
      outBody.append(h('div', { class: 'viz-empty' }, 'What the program prints appears here, step by step.'));
      return;
    }
    const st = steps[index];
    const atEnd = st.pseudo || st.final;
    const text = (atEnd ? trace.stdout : trace.stdout.slice(0, st.out)).replace(/\r\n/g, '\n');
    const pre = h('pre', { class: 'term' }, text || '');
    if (!text) pre.append(h('span', { style: { color: 'var(--text-faint)' } }, '(nothing printed yet)'));
    if (atEnd && trace.stderr) pre.append(h('span', { class: 'err-text' }, `\n${trace.stderr}`));
    outBody.append(pre);
  }

  async function decorateEditor(st, i) {
    if (!editor) return;
    const monaco = await getMonaco();
    if (!lineMarks) lineMarks = editor.createDecorationsCollection([]);
    const decos = [];
    const prev = i > 0 ? steps[i - 1] : null;
    const add = (line, cls, glyph, msg) => {
      if (!line) return;
      decos.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: cls, glyphMarginClassName: glyph, glyphMarginHoverMessage: msg ? { value: msg } : undefined } });
    };
    if (st.pseudo === 'error') {
      const f = (trace.fatal.frames || []).find((x) => x.k === 'user');
      if (f) add(f.line, 'lc-crash-line', 'lc-crash-glyph', `**${trace.fatal.title}**`);
    } else if (!st.final) {
      if (prev && !prev.pseudo && !prev.final && prev.line !== st.line) add(prev.line, 'viz-prev-line', null, null);
      add(st.line, 'viz-next-line', 'viz-next-glyph', 'Runs next');
      const line = st.line;
      const visible = editor.getVisibleRanges();
      if (line && !visible.some((r) => line >= r.startLineNumber && line <= r.endLineNumber)) editor.revealLineInCenter(line);
    }
    lineMarks.set(decos);
  }

  function show(i) {
    if (!steps.length) return;
    index = Math.max(0, Math.min(steps.length - 1, i));
    const st = steps[index];
    counter.textContent = `Step ${index + 1} of ${steps.length}`;
    slider.max = String(steps.length - 1);
    slider.value = String(index);
    renderStory(st, index);
    renderOutput();
    prevValues = index > 0 ? valuesOf(steps[index - 1]) : new Map();
    renderMemory(st);
    decorateEditor(st, index);
  }

  function togglePlay() {
    if (playTimer) {
      stop();
      return;
    }
    if (!steps.length) return;
    if (index >= steps.length - 1) show(0);
    playTimer = setInterval(() => {
      if (index >= steps.length - 1) stop();
      else show(index + 1);
    }, PLAY_MS);
    renderPlay();
  }

  function stop() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    renderPlay();
  }

  function renderPlay() {
    clear(playBtn).append(icon(playTimer ? 'pause' : 'play'), playTimer ? 'Pause' : 'Play');
    playBtn.disabled = !steps.length;
  }

  function setStale(stale) {
    banner.style.display = stale ? '' : 'none';
    clear(banner);
    if (stale) banner.append(icon('info'), 'The code changed since this run. Press Visualize to run it again.');
    stage.classList.toggle('stale', stale);
  }

  function intro() {
    clear(grid);
    clear(story);
    arrowState = null;
    drawArrows(null);
    const picks = h('div', { class: 'viz-picks' }, examples.slice(0, 8).map((ex) => h('button', { class: 'btn sm', onclick: () => loadExample(ex) }, ex.title)));
    grid.append(h('div', { class: 'viz-intro' },
      h('h2', null, 'See your program\'s memory'),
      h('p', null, 'Press ', h('b', null, 'Visualize'), ' to run the code one line at a time. You will see:'),
      h('ul', null,
        h('li', null, h('b', null, 'the stack: '), 'a frame for every function call, with its parameters and local variables'),
        h('li', null, h('b', null, 'the heap: '), 'every block from malloc, calloc and realloc, and when it is freed'),
        h('li', null, h('b', null, 'pointers: '), 'arrows from each pointer to the memory it points to, red when it dangles')),
      h('p', null, 'Start with an example:'),
      picks));
    story.append(h('div', { class: 'viz-note next' }, 'Use ← and → (or Play) to move through the steps once the program has run.'));
  }

  // ------------------------------------------------------------- actions

  function replaceCode(code) {
    const model = editor.getModel();
    editor.pushUndoStop();
    editor.executeEdits('leakcode', [{ range: model.getFullModelRange(), text: code }]);
    editor.pushUndoStop();
  }

  async function loadExample(ex) {
    if (!editor) return;
    const current = editor.getValue().trim();
    const isExample = examples.some((x) => x.code.trim() === current);
    if (current && !isExample && !await confirmDialog(`Load "${ex.title}"?`, 'This replaces the code in the editor (Ctrl+Z undoes it).', 'Load example')) return;
    replaceCode(ex.code);
    save();
    run();
  }

  async function run() {
    if (busy || !editor) return;
    busy = true;
    stop();
    runBtn.disabled = true;
    clear(runBtn).append(h('span', { class: 'spinner' }), 'Running…');
    clearMarks(editor);
    const code = editor.getValue();
    let result;
    try {
      result = await api.trace(code, stdin.value);
    } catch (e) {
      result = { verdict: 'internal_error', message: String(e && e.message ? e.message : e) };
    }
    if (destroyed) return;
    busy = false;
    runBtn.disabled = false;
    clear(runBtn).append(icon('play'), 'Visualize');
    trace = null;
    steps = [];
    prevValues = new Map();
    setStale(false);
    if (result.verdict === 'compile_error' || result.verdict === 'no_compiler' || result.verdict === 'internal_error') {
      clear(grid);
      clear(story);
      arrowState = null;
      drawArrows(null);
      if (result.verdict === 'compile_error') {
        setCompileMarkers(editor, result.diagnostics, 'main.c');
        const first = (result.diagnostics || []).find((d) => d.severity === 'error' && d.file === 'main.c');
        if (first) revealLine(editor, first.line);
        story.append(h('div', { class: 'viz-note bad' }, 'The program does not compile yet:'),
          renderDiagnostics((result.diagnostics || []).filter((d) => d.severity !== 'note'), { onGoto: (l) => revealLine(editor, l) }));
      } else {
        story.append(h('div', { class: 'viz-note bad' }, result.message || 'Something went wrong.'));
        if (result.verdict === 'no_compiler') story.append(h('button', { class: 'btn primary', onclick: () => openSettings() }, 'Set up the compiler'));
      }
      counter.textContent = '';
      slider.max = '0';
      renderPlay();
      renderOutput();
      return;
    }
    trace = result;
    tracedCode = code;
    steps = [...(result.steps || [])];
    setCompileMarkers(editor, (result.diagnostics || []).filter((d) => d.severity === 'warning'), 'main.c');
    if (result.fatal) {
      const last = [...steps].reverse().find((s) => !s.pseudo) || null;
      steps.push({ pseudo: 'error', base: last, line: last ? last.line : 0 });
    }
    if (!steps.length) {
      clear(grid);
      clear(story);
      story.append(h('div', { class: 'viz-note bad' }, result.verdict === 'time_limit'
        ? 'The program did not finish within 20 seconds (an infinite loop, or waiting for input?).'
        : 'The program ended before main() could be traced.'));
      renderOutput();
      renderPlay();
      return;
    }
    renderPlay();
    show(0);
  }

  function onKey(e) {
    if (root.classList.contains('hidden')) return;      // another tab is showing
    if (e.ctrlKey && e.key === 'Enter' && !e.defaultPrevented && !editorHost.contains(e.target)) {
      e.preventDefault();
      run();
      return;
    }
    const typing = e.target.closest && (e.target.closest('.editor-host') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (typing || !steps.length) return;
    if (e.key === 'ArrowRight') { stop(); show(index + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { stop(); show(index - 1); e.preventDefault(); }
    else if (e.key === 'Home') { stop(); show(0); e.preventDefault(); }
    else if (e.key === 'End') { stop(); show(steps.length - 1); e.preventDefault(); }
  }
  window.addEventListener('keydown', onKey);

  renderOutTabs();
  renderOutput();
  renderPlay();

  (async () => {
    const data = await api.getVisualizer();
    if (destroyed) return;
    examples = data.examples;
    for (const ex of examples) exampleSelect.append(h('option', { value: ex.id }, ex.title));
    const pending = takePendingVisualizer();
    const saved = data.state;
    stdin.value = pending ? pending.stdin || '' : (saved && saved.stdin) || '';
    editor = await createEditor(editorHost, {
      value: pending ? pending.code : (saved && saved.code) || (examples[0] ? examples[0].code : 'int main(void) { return 0; }\n'),
      onChange: (code) => {
        save();
        if (tracedCode !== null) setStale(code !== tracedCode);
      },
      keys: { submit: () => run() },
    });
    if (destroyed) {
      editor.dispose();
      return;
    }
    if (pending) {
      save();
      run();
    } else {
      intro();
    }
  })();

  return {
    hide() {
      stop();                 // pause Play while you are away
    },
    show() {
      // code sent by a "Visualize" button while this page stayed open
      const pending = editor ? takePendingVisualizer() : null;
      if (!pending) return;
      replaceCode(pending.code);
      stdin.value = pending.stdin || '';
      save();
      run();
    },
    destroy() {
      destroyed = true;
      stop();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKey);
      if (editor) {
        api.saveVisualizer({ code: editor.getValue(), stdin: stdin.value });
        editor.dispose();
      }
    },
  };
}
