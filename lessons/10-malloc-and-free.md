<!-- {"title": "malloc, calloc, realloc and free", "summary": "The four functions of the C heap, the idioms that keep you out of trouble, and how to make ownership explicit.", "practice": ["duplicate-a-string", "make-a-range", "filter-even-numbers", "dynamic-array", "fix-the-realloc-bug"]} -->
# malloc, calloc, realloc and free

So far all your variables lived on the stack, and that has two limits. A local variable disappears when its function returns, so a function can't build an array and hand it back. And an array's size is fixed when you write the program, while the amount of data often depends on what happens while it runs (how many lines are in a file, how many items the user adds).

The **heap** solves both. You ask for a number of bytes while the program runs, you get back the address of a fresh block of memory, and that block stays yours until you give it back. Here is the whole cycle:

```c
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n = 4;                                   // could come from the user
    int *nums = malloc(n * sizeof(int));         // ask for room for n ints
    if (nums == NULL) return 1;                  // no memory left (rare, but possible)
    for (int i = 0; i < n; i++) {
        nums[i] = i * 10;                        // use it like an array
    }
    printf("%d %d\n", nums[0], nums[3]);
    free(nums);                                  // give it back when you're done
    return 0;
}
```

> **Try it:** press *Visualize*. The block appears in the heap column when `malloc` runs (its contents start as `?`, garbage), and it's marked freed when `free` runs.

The heap is managed through four functions from `<stdlib.h>`:

| Function | What it does | Contents of the new memory |
|---|---|---|
| `malloc(size)` | allocates `size` bytes | **garbage** (uninitialized) |
| `calloc(count, size)` | allocates `count * size` bytes | all zero |
| `realloc(p, size)` | resizes a block, possibly **moving** it | old contents kept, new part garbage |
| `free(p)` | gives a block back | (no longer yours) |

All three allocation functions return `NULL` when they fail.

## The allocation idiom

```c
int *arr = malloc(n * sizeof *arr);
if (arr == NULL) {
    /* handle the failure: return an error, clean up, ... */
}
```

- `sizeof *arr` is "the size of whatever `arr` points to", here `sizeof(int)`. It stays correct if you later change the type, which is why experienced programmers prefer it.
- In C, don't cast `malloc`'s result. `void *` converts implicitly, and the cast only hides mistakes.
- `n * sizeof *arr` can overflow for huge `n`. `calloc(n, sizeof *arr)` checks for that.

```c
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n = 5;
    int *squares = malloc(n * sizeof *squares);
    if (squares == NULL) return 1;
    for (int i = 0; i < n; i++) squares[i] = i * i;

    int *zeros = calloc(n, sizeof *zeros);       // starts as all zero
    if (zeros == NULL) { free(squares); return 1; }

    for (int i = 0; i < n; i++) printf("%d/%d ", squares[i], zeros[i]);
    printf("\n");
    free(squares);
    free(zeros);
    return 0;
}
```

## realloc, done right

`realloc` may move the block. After a successful call **only the returned pointer is valid**; any other pointer into the old block is dangling. On failure it returns `NULL` and leaves the old block untouched, so never write `p = realloc(p, n)`:

```c
int *bigger = realloc(arr, newCount * sizeof *arr);
if (bigger == NULL) {
    /* arr is still valid here: keep using it, or free it */
} else {
    arr = bigger;
}
```

Grow **geometrically** (double the capacity) rather than by a constant: n appends then cost O(n) in total instead of O(n²).

## free: the rules

1. Free every block exactly **once**.
2. Pass exactly the pointer the allocator returned: not `p + 1`, not a pointer to a local or a global.
3. Don't touch the block afterwards, through any pointer.
4. `free(NULL)` is allowed and does nothing, which makes cleanup code simpler.

```c
free(p);
p = NULL;     // a later accidental use becomes an obvious NULL crash
```

## Ownership: who frees?

Every heap block needs exactly one **owner**: the piece of code that will free it. Write the rule down at the function boundary:

```c
/* Returns a newly allocated copy of s. The caller must free() it. */
char *duplicate(const char *s);

/* Borrows s: does not keep the pointer after returning. */
void printUpper(const char *s);

/* Takes ownership of node: it will be freed with the list. */
void listAppend(List *list, Node *node);
```

Common patterns:

- **create / destroy pairs** (`createMatrix`/`freeMatrix`, `fopen`/`fclose`): the library frees what it allocated.
- **caller frees** (`strdup`, and many functions that return a new string or array): documented in the function's contract.
- **borrow**: a `const T *` parameter is only used during the call. Copy it if you need it later.

## Seeing it in action

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Returns a new string; the caller frees it. */
char *repeat(const char *s, int times) {
    size_t len = strlen(s);
    char *out = malloc(len * times + 1);
    if (out == NULL) return NULL;
    for (int i = 0; i < times; i++) memcpy(out + i * len, s, len);
    out[len * times] = '\0';
    return out;
}

int main(void) {
    char *a = repeat("ab", 3);
    char *b = repeat("-", 10);
    printf("%s\n%s\n", a, b);
    free(a);
    // forgot free(b): run this to see LeakCode's leak report, then fix it
    return 0;
}
```
