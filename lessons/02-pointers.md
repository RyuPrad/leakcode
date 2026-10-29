<!-- {"title": "Pointers: Addresses You Can Hold", "summary": "Address-of, dereference, NULL, pointer arithmetic, arrays that decay into pointers, and what const really protects.", "practice": ["swap-two-integers", "min-and-max", "sum-with-pointer-arithmetic", "reverse-array-in-place", "find-the-first-match"]} -->
# Pointers: addresses you can hold

Every object in memory has an **address**: the number of its first byte. A pointer is a variable that stores such an address, together with the *type* of object it points to.

```c
int x = 42;
int *p = &x;     // & : "address of" x
*p = 7;          // * : "the object at" p, so this writes x
```

| Expression | Meaning | Type |
|---|---|---|
| `x` | the int | `int` |
| `&x` | where `x` lives | `int *` |
| `p` | the stored address | `int *` |
| `*p` | the int at that address | `int` |

```c
#include <stdio.h>

int main(void) {
    int x = 42;
    int *p = &x;
    printf("x = %d, stored at %p\n", x, (void *)&x);
    printf("p = %p, *p = %d\n", (void *)p, *p);
    *p = 7;
    printf("after *p = 7, x = %d\n", x);
    return 0;
}
```

## Why pointers exist

1. **To let a function change the caller's variables.** C passes arguments by value. To modify the caller's data, pass its address (`swap(&a, &b)`, `scanf("%d", &n)`).
2. **To avoid copying.** Passing a 1 MB struct copies 1 MB; passing its address copies 8 bytes.
3. **To build structures whose size changes at run time**: arrays from `malloc`, linked lists, trees.

## NULL

`NULL` is a pointer that points to nothing. Functions use it to say "no result" (`strchr`, `malloc` on failure, the end of a list). Dereferencing it is the classic crash, so **check before you use**:

```c
char *colon = strchr(line, ':');
if (colon != NULL)
    *colon = '\0';
```

## Pointer arithmetic

Adding an integer to a pointer moves it by whole **elements**, not bytes:

```c
#include <stdio.h>

int main(void) {
    int a[4] = { 10, 20, 30, 40 };
    int *p = a;                 // same as &a[0]
    printf("%d %d %d\n", *p, *(p + 1), p[2]);   // p[2] means *(p + 2)
    printf("p + 1 is %zu bytes after p\n", (size_t)((char *)(p + 1) - (char *)p));
    int *end = a + 4;           // one past the last element: OK to compute, not to read
    printf("elements between a and end: %td\n", end - a);
    return 0;
}
```

- `p + n` is `n * sizeof(*p)` bytes further.
- `q - p` is the number of elements between two pointers into the **same** array.
- `a[i]` is defined as `*(a + i)`.

## Arrays decay into pointers

In most expressions, an array's name turns into a pointer to its first element. That is why you can pass an array to a function expecting `int *`, and why **the function cannot know the array's length**:

```c
void f(int arr[]) {               // really: int *arr
    printf("%zu\n", sizeof arr);  // 8: the size of a pointer, not of the array!
}
```

Always pass the length alongside the pointer (`int *nums, int numsSize`), as every problem here does.

## const: a promise about who may write

```c
const int *p;        // the int is read-only through p (p itself can move)
int *const q = &x;   // q can't move, but *q can be written
const int *const r;  // neither
```

A parameter like `const char *s` documents that the function only *reads* the string. The compiler enforces it, and LeakCode's harness even makes such inputs physically read-only, so a write is caught on the spot.

## Rules to remember

- Initialize every pointer: to a real address or to `NULL`. An uninitialized pointer holds garbage.
- Check for `NULL` before dereferencing anything that may be NULL.
- Only do arithmetic within one array (plus "one past the end").
- A pointer doesn't keep its target alive. When the object dies (function returned, block freed), the pointer **dangles**.
