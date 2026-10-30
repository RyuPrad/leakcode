# LeakCode

A Windows desktop app for learning C and memory management, starting from zero: 14 lessons (six on C basics for complete beginners, then pointers and memory), a **memory visualizer** that runs your program line by line and draws its stack, heap and pointers, 58 hands-on exercises in 10 chapters, **typing practice** with C words and real snippets from the lessons, and a playground. Every program you run is checked for leaks, buffer overflows, use-after-free, double frees and other memory bugs, and each report points to the exact line.

## Requirements

- Windows 10/11 x64
- **Visual Studio Build Tools** with the *Desktop development with C++* workload (provides the MSVC compiler). LeakCode finds it automatically.

## Running

- Packaged app: `dist\LeakCode-win32-x64\LeakCode.exe` (build it with `npm run package`)
- From source: `npm install`, `npm run vendor` (once), then `npm start`

If Electron doesn't start after `npm install`, its binary download was skipped (some npm setups don't run install scripts): run `node node_modules/electron/install.js`.

## How it works

| Part | Where |
|---|---|
| Electron main process, IPC | `main.js`, `preload.js` |
| Compiler detection and invocation (MSVC via vcvars) | `src/compiler.js` |
| Building, running and judging programs | `src/judge.js` |
| Problem and lesson loading, user data | `src/problems.js`, `src/content.js`, `src/store.js` |
| C runtime: checking allocator, crash reporter, test harness | `runtime/` |
| Visualizer: line-by-line tracing of stack frames, heap blocks and pointers | `runtime/lc_trace.c`, `renderer/js/views/visualize.js` |
| Typing practice: C words and snippets taken from the lessons and examples | `src/typing.js`, `renderer/js/views/typing.js` |
| UI (Monaco editor, views) | `renderer/` |
| Problems (one file per chapter) | `problems/*.lc` |
| Lessons | `lessons/*.md` |
| Visualizer examples | `visualizer/examples.lc` |

The runtime (`runtime/lc_rt.c`) replaces `malloc`/`free` (through macros in `lc_mem.h`) with an allocator that gives every block its own pages followed by an inaccessible guard page, and makes freed blocks inaccessible. Invalid accesses fault on the offending instruction; a crash handler then symbolizes the stack with DbgHelp and the program's PDB. MSVC's `/RTC1` checks cover uninitialized locals and local-array overflows.

## Adding a problem

Add a `@@@ problem <id>` block to a file in `problems/` with these parts: `meta` (JSON: title, difficulty, params, examples...), `description`, `prelude`, `starter`, `solution`, `driver` and `tests`, plus an optional `editorial`. See `runtime/lc_driver.h` for the harness API. Then check it:

```
node tools/verify.js <id>
```

## Checks

```
node tools/selftest.js       # the runtime detects each kind of bug
node tools/verify.js         # every reference solution passes, examples match, starters behave
node tools/mistakes.js       # common wrong solutions get the right verdict
node tools/check-lessons.js  # lesson and playground programs behave as described
node tools/check-trace.js    # print what the visualizer records for a program
npm run package              # build dist\LeakCode-win32-x64
```
