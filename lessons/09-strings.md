<!-- {"title": "C Strings: Bytes with a Zero at the End", "summary": "Why every string needs one more byte than its length, where string literals live, and which library functions will happily overflow your buffers.", "practice": ["string-length", "reverse-a-string", "safe-string-copy", "duplicate-a-string", "fix-the-off-by-one"]} -->
# C strings: bytes with a zero at the end

You met strings briefly in the Arrays lesson. C has no special string type: a "string" is a sequence of `char`s that ends at the first byte equal to `0`, written `'\0'` (the *null terminator*). The terminator is how every function finds the end. The functions that work on strings, such as `strlen` (length) and `strcpy` (copy), come from `#include <string.h>`.

```
"cat"  →  'c' 'a' 't' '\0'      4 bytes, length 3
```

**A string of length n needs n + 1 bytes.** Most string bugs come from forgetting this.

In the program below, `%zu` is the `printf` placeholder for sizes (the type `size_t` that `strlen` and `sizeof` give back), and `\"` puts a quote character inside a string.

```c
#include <stdio.h>
#include <string.h>

int main(void) {
    char word[] = "cat";
    printf("strlen = %zu, sizeof = %zu\n", strlen(word), sizeof word);  // 3 and 4
    word[1] = '\0';                       // cut the string short
    printf("now: \"%s\" (strlen %zu)\n", word, strlen(word));
    return 0;
}
```

## Arrays, pointers and literals

```c
char a[] = "hello";       // an array of 6 chars, a writable COPY of the literal
char *p = "hello";        // a pointer to the literal itself, which is READ-ONLY
const char *q = "hello";  // the honest way to write the line above
```

String literals live in static, read-only memory. `p[0] = 'H'` compiles but crashes. Declare such pointers `const char *` and the compiler stops you.

## The dangerous functions

| Function | Problem | Safer choice |
|---|---|---|
| `strcpy(dst, src)` | no idea how big `dst` is | `snprintf(dst, size, "%s", src)` or your own bounded copy |
| `strcat(dst, src)` | same, plus rescans `dst` | track the length yourself, `memcpy` |
| `sprintf(dst, ...)` | no bounds | `snprintf(dst, size, ...)` |
| `gets(buf)` | removed from C11: can't be used safely | `fgets(buf, size, stdin)` |
| `strncpy(dst, src, n)` | may leave `dst` without `'\0'` | terminate manually, or `snprintf` |
| `scanf("%s", buf)` | no bounds | `scanf("%99s", buf)` for a 100-byte buffer |

```c
#include <stdio.h>
#include <string.h>

int main(void) {
    char small[8];
    const char *name = "Alexandria";
    snprintf(small, sizeof small, "%s", name);      // truncates safely
    printf("\"%s\" (%zu of %zu chars kept)\n", small, strlen(small), strlen(name));

    int needed = snprintf(NULL, 0, "Hello, %s!", name);   // measure first
    printf("a greeting would need %d chars + 1 byte for '\\0'\n", needed);
    return 0;
}
```

## Comparing strings

`==` compares **addresses**, not contents. Two equal strings at different addresses are not `==`. Use `strcmp(a, b) == 0`.

## Characters are small integers

A `char` is a 1-byte integer. `'a'` is 97, and `'0'` is 48, not 0. Converting a digit character to its value is `c - '0'`. When calling `<ctype.h>` functions such as `isdigit` or `toupper`, cast to `unsigned char` first: `toupper((unsigned char)c)`. Passing a negative `char` (non-ASCII bytes) is undefined behavior.

## Checklist for every string you build

1. Count the bytes, including the terminator.
2. Allocate (or check the buffer size) **before** writing.
3. Write the `'\0'`.
4. If the string came from `malloc`, someone must `free` it: say who in a comment.
