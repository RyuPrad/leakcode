<!-- {"title": "Pointers: Addresses You Can Hold", "summary": "What an address is, the & and * operators, letting a function change the caller's variables, NULL, pointer arithmetic, and how arrays turn into pointers.", "practice": ["swap-two-integers", "min-and-max", "sum-with-pointer-arithmetic", "reverse-array-in-place", "find-the-first-match"], "part": "Part 2: Pointers and memory"} -->
# Pointers: addresses you can hold

Pointers have a reputation for being hard, but the idea is simple, and you have already met it twice: `scanf("%d", &n)` needs an `&`, and a function that receives an array can change the caller's elements. Both work because of **addresses**.

## Memory is a long row of numbered bytes

Your computer's memory is an enormous row of bytes, and every byte has a number, its **address**, like the house numbers along a very long street. Every variable occupies some of those bytes: a `char` takes 1, an `int` 4 bytes in a row. The address of a variable is the address of its first byte.

A **pointer** is a variable whose value is an address. It also knows the *type* of what it points to, so `int *` means "the address of an `int`".

## & and *

Two operators do all the work:

- `&x` gives the **address of** `x`.
- `*p` means **the variable at** the address stored in `p`. Reading `*p` reads that variable; writing `*p = 7` writes it.

```c
#include <stdio.h>

int main(void) {
    int x = 42;
    int *p = &x;         // p holds the address of x: "p points to x"
    *p = 7;              // write to the variable p points to, so x becomes 7
    printf("x = %d, *p = %d\n", x, *p);
    printf("x lives at address %p\n", (void *)&x);
    return 0;
}
```

> **Try it:** press *Visualize*. A pointer is drawn as a dot with an arrow to the variable it points to, and when line `*p = 7` runs you can see `x` change, although the line never mentions `x`.

| Expression | Meaning | Type |
|---|---|---|
| `x` | the int | `int` |
| `&x` | where `x` lives | `int *` |
| `p` | the address stored in p | `int *` |
| `*p` | the int at that address, here `x` itself | `int` |

The star has two jobs, which confuses everyone at first. In a **declaration** (`int *p`) it means "p is a pointer to an int". In an **expression** (`*p = 7`) it means "go to the address in p".

`%p` prints an address, in hexadecimal. The exact number changes from run to run and isn't interesting in itself; what matters is which variable it leads to. (`printf` expects a `void *`, a pointer to "anything", for `%p`, hence the `(void *)` conversion.)

## Why pointers exist

**1. To let a function change the caller's variables.** In the Functions lesson, `tryToReset(value)` couldn't change `value`, because the function only got a copy. If the function gets the variable's *address* instead, it can reach the original:

```c
#include <stdio.h>

void swap(int *a, int *b) {
    int tmp = *a;      // the caller's first variable
    *a = *b;
    *b = tmp;
}

int main(void) {
    int x = 1, y = 2;
    swap(&x, &y);      // pass the addresses, not the values
    printf("x = %d, y = %d\n", x, y);    // x = 2, y = 1
    return 0;
}
```

The parameters `a` and `b` are still copies, but copies of *addresses*, so `*a` and `*b` are the caller's `x` and `y` themselves. This is exactly what `scanf` does with `&n`.

**2. To return more than one result.** A function can `return` only one value, but it can write any number of results through pointers (*out-parameters*): `void minMax(const int *nums, int n, int *outMin, int *outMax)`.

**3. To work with memory whose size is only known while the program runs**: arrays from `malloc`, linked lists, trees. That's the second half of this course.

## NULL: pointing nowhere

`NULL` is a special pointer value that means "points to nothing". Functions use it to say "no result": searching a string for a character that isn't there, an allocation that failed, the end of a linked list. Following a `NULL` pointer (`*p` when `p` is `NULL`) crashes the program, so **check before you follow**:

```c
char *colon = strchr(line, ':');   // finds ':' in line, or returns NULL
if (colon != NULL) {
    *colon = '\0';
}
```

A pointer that was never given a value is worse than `NULL`: it holds garbage, an address that leads anywhere. Always initialise pointers, to a real address or to `NULL`.

## Arrays and pointers

In most expressions, an array's name turns into a pointer to its first element: `a` means `&a[0]`. That is why a function that receives an array can modify it (it got the address of the caller's elements), and why it can't know the array's length. These two declarations mean the same thing:

```c
int sumArray(int nums[], int numsSize);
int sumArray(int *nums, int numsSize);    // what the compiler actually sees
```

The exercises from here on use the second form.

### Pointer arithmetic

Adding a number to a pointer moves it by whole **elements**, not bytes. If `p` points to `a[0]`, then `p + 2` points to `a[2]`. In fact, `a[i]` is just a short way of writing `*(a + i)`.

```c
#include <stdio.h>

int main(void) {
    int a[4] = { 10, 20, 30, 40 };
    int *p = a;                 // the same as &a[0]
    printf("%d %d %d\n", *p, *(p + 1), p[2]);   // 10 20 30
    p = p + 3;                  // now points to a[3]
    printf("%d\n", *p);         // 40
    int *end = a + 4;           // one past the last element: fine to compute, never to read
    printf("%d elements\n", (int)(end - a));     // subtracting gives a distance in elements
    return 0;
}
```

Arithmetic is only allowed inside one array (plus the position just past its end). Anything further is the buffer overflow you met in the Arrays lesson.

## Pointers to structs

With a pointer to a struct, use an arrow to reach a field: `pp->x` is a shorter way to write `(*pp).x`.

```c
struct Point { int x, y; };
struct Point pt = { 1, 2 };
struct Point *pp = &pt;
pp->y = 20;          // changes pt.y
```

## const: a promise not to write

Many functions in the exercises take parameters like `const int *nums` or `const char *s`. The `const` promises that the function only **reads** through that pointer: the compiler rejects any write, and LeakCode's test harness even makes such inputs read-only, so a stray write is caught on the spot.

```c
const int *p;        // the int can't be changed through p (p itself can move)
int *const q = &x;   // q can't move, but *q can be written
```

## Rules to remember

- `&x` is the address of `x`; `*p` is the variable `p` points to.
- To let a function change your variable, pass its address.
- Initialise every pointer, to a real address or to `NULL`, and check for `NULL` before following one that may be `NULL`.
- Pointer arithmetic counts in elements, and must stay inside one array.
- A pointer doesn't keep what it points to alive. When that variable or block is gone, the pointer **dangles**, and using it is a bug.
