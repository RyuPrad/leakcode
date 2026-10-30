<!-- {"title": "Where Your Data Lives: Stack, Heap and Static Memory", "summary": "The three places a C variable can live, how long each one lasts, and who is responsible for cleaning it up.", "practice": ["swap-two-integers", "find-the-first-match"]} -->
# Where your data lives

In the Functions lesson you saw that every call gets a **stack frame** for its parameters and local variables, and that the frame disappears when the function returns. The stack is one of the three kinds of memory a C program uses. Every object lives in one of them, and knowing which one answers the two questions behind every memory bug: *how long does this exist, and who cleans it up?*

| | **Stack** (automatic) | **Heap** (dynamic) | **Static** |
|---|---|---|---|
| What lives there | local variables, parameters | whatever you `malloc` | globals, `static` variables, string literals |
| Created | when the function is entered | when you call `malloc`/`calloc`/`realloc` | when the program starts |
| Destroyed | **automatically** when the function returns | **only** when you call `free` | when the program ends |
| Size known | at compile time | at run time | at compile time |
| Typical size limit | ~1–8 MB in total | most of your RAM | fixed |

The program below uses all three. It also uses the two heap functions you'll study in detail in the *malloc and free* lesson: `malloc(n * sizeof *arr)` asks for enough bytes to hold `n` ints and returns the address of the first one (so the result goes into a pointer), and `free(a)` gives those bytes back. `int counter` is declared outside any function, which makes it a **global** variable: it lives in static memory.

```c
#include <stdio.h>
#include <stdlib.h>

int counter = 0;                  // static memory: lives for the whole program

int *makeArray(int n) {
    int local = n * 2;            // stack: gone when makeArray returns
    int *arr = malloc(n * sizeof *arr);   // heap: lives until free(arr)
    for (int i = 0; i < n; i++) arr[i] = local + i;
    counter++;
    return arr;                   // fine: the heap block outlives the function
}

int main(void) {
    int *a = makeArray(3);
    printf("%d %d %d (calls: %d)\n", a[0], a[1], a[2], counter);
    free(a);                      // our job, not the compiler's
    return 0;
}
```

> **Try it:** press *Visualize* and step through. The stack column shows `makeArray`'s frame appear and vanish; the heap column shows the block that outlives it.

## The stack: free, fast and short-lived

Each function call gets a *stack frame* holding its parameters and locals. When the function returns, the whole frame is popped in one step. That is why locals are so cheap, and why **you must never keep a pointer to a local after its function has returned**: the memory will be reused by the next call.

## The heap: you are in charge

`malloc` hands you a block that stays valid until you pass it to `free`. Nothing frees it for you: unlike Python or Java, C has no *garbage collector* that cleans up memory you no longer use. So every block needs an **owner**: a piece of code responsible for freeing it exactly once.

Three ways this goes wrong, and which LeakCode reports for you:

- **Leak**: nobody frees the block. The memory is lost until the program exits.
- **Use after free**: a pointer is used after its block was freed (a *dangling pointer*).
- **Double free**: two owners each free the same block.

## Pointers are just addresses

A pointer stores an address. It does **not** know which kind of memory it points into, how big the object is, or whether that object still exists. The compiler will happily let you return the address of a local, read past the end of an array, or use freed memory. The program might even appear to work, until it doesn't.

That is what LeakCode's checker is for: every block you allocate is fenced by inaccessible memory, freed blocks are poisoned, and the report tells you the exact line where things went wrong.

> **Try it:** press *Run in Playground* on the program above, then change it to forget `free(a)` and run again to see a leak report.
