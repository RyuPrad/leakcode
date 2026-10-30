<!-- {"title": "Structs in Memory: Alignment and Opaque Types", "summary": "How structs are laid out in memory, why sizeof is often larger than you expect, and how C libraries hide their internals behind pointers.", "practice": ["bytes-of-an-integer", "ring-buffer", "reference-counted-strings", "bump-allocator"]} -->
# Structs in memory: alignment and opaque types

The Structs lesson showed how to define and use a `struct`. This one looks underneath: how its bytes are arranged, and how C libraries use structs to hide their internals. A struct's fields are stored **in declaration order**, but not necessarily back to back.

## Alignment and padding

Each type has an *alignment*: its address must be a multiple of some number (usually its size, up to 8 or 16). An `int` sits at multiples of 4 and a `double` or pointer at multiples of 8. The compiler inserts **padding** to respect this:

```c
#include <stdio.h>
#include <stddef.h>

struct Wasteful { char a; double b; char c; };   // 1 + 7 pad + 8 + 1 + 7 pad = 24
struct Compact  { double b; char a; char c; };   // 8 + 1 + 1 + 6 pad = 16

int main(void) {
    printf("Wasteful: %zu bytes (b at offset %zu)\n", sizeof(struct Wasteful), offsetof(struct Wasteful, b));
    printf("Compact:  %zu bytes (a at offset %zu)\n", sizeof(struct Compact), offsetof(struct Compact, a));
    return 0;
}
```

- Ordering fields from largest to smallest alignment minimizes padding.
- `sizeof` a struct is always a multiple of its alignment, so arrays of structs stay aligned.
- **Always use `sizeof`** when allocating: `malloc(sizeof(struct Node))` or `malloc(sizeof *node)`. Never add up the field sizes by hand.

## `.` vs `->`

```c
struct Point { int x, y; };
struct Point p = { 1, 2 };
struct Point *pp = &p;
p.x = 10;        // on the struct itself
pp->y = 20;      // on a pointer: shorthand for (*pp).y
```

## Copying structs is shallow

`a = b;` copies every member, but a pointer member is copied as an address: both structs then point to the **same** data. If both later free it, that's a double free (see *Fix the Shallow Copy*). Structs that own memory need explicit copy and destroy functions.

## Opaque types: hiding the internals

A header can declare a struct type without defining it:

```c
/* vec.h: what users see */
typedef struct IntVec IntVec;          // "incomplete type": no fields visible
IntVec *vecCreate(void);
void vecPush(IntVec *v, int x);
void vecFree(IntVec *v);

/* vec.c: the only place that knows the layout */
struct IntVec { int *data; int size, capacity; };
```

Users can only hold `IntVec *` pointers and call the functions. They can't allocate an `IntVec` themselves or touch its fields, so the library is free to change its layout. `FILE *` works exactly like this, and so do the design problems here: the harness only ever sees your pointer.

## Flexible array members

A struct may end with an array of unspecified size, sized at `malloc` time. The header and its data then share one allocation:

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Message {
    size_t length;
    char text[];               // flexible array member: must be last
} Message;

Message *messageNew(const char *s) {
    size_t n = strlen(s);
    Message *m = malloc(sizeof *m + n + 1);   // header + characters + '\0'
    if (m == NULL) return NULL;
    m->length = n;
    memcpy(m->text, s, n + 1);
    return m;
}

int main(void) {
    Message *m = messageNew("one allocation, one free");
    printf("%zu: %s\n", m->length, m->text);
    free(m);                   // frees the header AND the text
    return 0;
}
```

## Bytes and endianness

Any object can be viewed as raw bytes through an `unsigned char *`. Multi-byte integers are stored least-significant byte first on x86 and ARM (*little-endian*). Code that writes integers to files or networks should use shifts and masks so its output doesn't depend on the machine.
