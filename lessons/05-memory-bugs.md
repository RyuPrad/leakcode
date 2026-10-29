<!-- {"title": "The Memory Bugs, and How to Read LeakCode's Reports", "summary": "Leaks, overflows, use-after-free, double frees, uninitialized memory and dangling pointers: what each looks like, why it often 'works' anyway, and what the report tells you.", "practice": ["fix-the-leak", "fix-the-use-after-free", "fix-the-off-by-one", "fix-the-dangling-pointer", "fix-the-shallow-copy", "fix-the-realloc-bug"]} -->
# The memory bugs, and how to read LeakCode's reports

C trusts you completely. Most memory mistakes are **undefined behavior**: the language makes no promise about what happens. The program may crash, print garbage, or, worst of all, appear to work until some unrelated change makes it fail. LeakCode exists to turn "appears to work" into a precise report.

## How LeakCode catches bugs

- Every `malloc` block gets memory pages of its own, placed so the block **ends exactly at an inaccessible page**. Reading or writing even one byte past the end faults immediately.
- Freed blocks are made inaccessible and never reused, so any later access faults: **use-after-free**.
- The bytes just before each block hold a guard pattern that is checked on `free`, which catches writes *before* the start.
- The allocator remembers where each block was allocated and freed, and which blocks are still alive when a test case ends: **leaks**.
- The compiler's run-time checks (`/RTC1`) catch uninitialized locals and local-array overflows.

A report always answers three questions: **what** went wrong, **where** (the line that did it, plus the calls that led there), and **which memory** (where the block was allocated and, if relevant, freed). Click any `solution.c:NN` link to jump to that line.

## The bugs

### Memory leak
A block is never freed, so nothing can ever free it once its last pointer is gone.
```c
char *tmp = malloc(100);
/* ... */
return result;      // tmp is lost
```
**Report:** the bytes and blocks still allocated, and the line that allocated each one.

### Heap buffer overflow
Reading or writing past the end of a block: `i <= n` loops, a missing `+ 1` for `'\0'`, wrong size arithmetic.
```c
char *s = malloc(strlen(word));   // one byte short
strcpy(s, word);                  // writes the '\0' past the end
```
**Report:** how far past the end, the block's size, and where it was allocated.

### Use after free
Using memory through a pointer whose block was freed (a *dangling pointer*).
```c
free(node);
node = node->next;    // reads freed memory
```
**Report:** the access, plus where the block was allocated **and** freed. After `realloc`, the old block counts as freed.

### Double free and invalid free
Freeing the same block twice (often through two "owners"), or freeing something that never came from `malloc`: a local array, a string literal, an input you don't own, a pointer you advanced.

### Uninitialized memory
Fresh `malloc` memory and local variables contain leftovers. LeakCode fills them with recognizable patterns:

| You see | Bytes | Meaning |
|---|---|---|
| `-842150451`, `ÍÍÍÍ`, pointer `0xCDCDCDCD...` | `0xCD` | `malloc`'d memory you never initialized |
| `-858993460`, `ÌÌÌÌ`, pointer `0xCCCCCCCC...` | `0xCC` | an uninitialized local variable |
| `-572662307`, pointer `0xDDDDDDDD...` | `0xDD` | memory that was freed |
| `0xFDFDFDFD` | `0xFD` | guard bytes outside a block |

When a crash involves a pointer with one of these patterns, the report says which kind it is.

### Returning the address of a local
```c
char *label(void) {
    char buf[32];
    /* ... */
    return buf;       // buf dies when label returns
}
```
The compiler warns (*C4172*). Read compiler warnings: several memory bugs are caught before the program even runs.

### Stack overflows
Infinite or very deep recursion exhausts the stack (8 MB here). The report shows the recursing function and the line.

## Try it

This program contains three bugs. Run it, fix the first one reported, run again, and repeat until it is clean.

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Node { char *name; struct Node *next; } Node;

Node *push(Node *head, const char *name) {
    Node *n = malloc(sizeof *n);
    n->name = malloc(strlen(name));          // bug 1
    strcpy(n->name, name);
    n->next = head;
    return n;
}

int main(void) {
    Node *list = NULL;
    list = push(list, "alpha");
    list = push(list, "beta");
    for (Node *p = list; p != NULL; p = p->next)
        printf("%s\n", p->name);
    for (Node *p = list; p != NULL; p = p->next)   // bug 2
        free(p);                                    // bug 3: names are never freed
    return 0;
}
```

## Habits that prevent most memory bugs

1. Allocate `len + 1` for strings, and write the `+ 1` as you type `malloc`.
2. Loop with `i < n`, never `i <= n`, unless you can say why.
3. Save `next` before freeing a node.
4. After `free(p)`, set `p = NULL` if `p` stays in scope.
5. Decide who owns each block at the moment you allocate it, and write it down.
6. Treat compiler warnings as errors.
