<!-- {"title": "Your First C Program", "summary": "Start here if you have never written C. What a program is, how C code becomes something your computer runs, and what every line of Hello, World means.", "practice": ["add-two-numbers"], "part": "Part 1: C from scratch"} -->
# Your first C program

**New to C? You are in the right place.** These first lessons assume you have never written C before. Each one explains a few ideas with short programs you can run straight from the page, and ends with exercises to practise on.

C is a programming language from 1972 that still runs much of the world: Windows and Linux, databases, game engines, the software inside your router. It is small and *close to the machine*: you decide exactly how memory is used. That makes C fast, and it makes C the best language for learning how memory really works, which is what this app is about.

## From text to a running program

A C program starts as plain text in a file such as `main.c`. Your computer can't run text, so a **compiler** translates it into machine code, an `.exe` file, which the processor then runs:

```
main.c  ──compiler──▶  program.exe  ──run──▶  what it prints
```

LeakCode does all of this for you. When you press **Run**, it compiles your code with Microsoft's C compiler (MSVC), runs the result, and shows what it printed. If the compiler can't understand your code, you get a **compile error** instead, pointing at the line where it got stuck.

## Hello, World

The traditional first program prints one line of text:

```c
#include <stdio.h>

int main(void) {
    printf("Hello, World!\n");
    return 0;
}
```

> **Try it:** press *Run in Playground* under the program, then change the text between the quotes and press *Run* again.

Line by line:

| Code | What it means |
|---|---|
| `#include <stdio.h>` | Use the *standard input/output* library. It provides `printf`. |
| `int main(void)` | Every C program starts in a function called `main`. A **function** is a named block of code. `int` says `main` gives back a whole number when it finishes; `void` says it takes no inputs. |
| `{` ... `}` | Curly braces group the lines that belong to `main`. |
| `printf("Hello, World!\n");` | Print the text between the quotes. `\n` means "start a new line". |
| `return 0;` | Finish `main` and report 0, which means "everything went fine". |

The program runs from the top of `main` to the bottom, one line at a time.

### Semicolons and braces

Every instruction (a **statement**) ends with a semicolon `;`, like a full stop ends a sentence. Lines that open a block, such as `int main(void) {`, don't get one. Forgetting a `;` is the most common first error, and it is harmless: the compiler tells you where.

The spaces at the start of lines (**indentation**) are only for humans: they show which lines are inside which braces. The compiler ignores them, but please keep them tidy. The editor indents for you when you press Enter.

## Printing more

`printf` prints exactly what you give it. It doesn't add a new line by itself:

```c
#include <stdio.h>

int main(void) {
    printf("one ");
    printf("two\n");
    printf("three\n");
    printf("%d + %d = %d\n", 2, 3, 2 + 3);
    return 0;
}
```

This prints:

```
one two
three
2 + 3 = 5
```

The last line shows what makes `printf` useful: each `%d` in the text is a placeholder that is replaced, in order, by the numbers after the comma. Here they are `2`, `3` and the result of `2 + 3`. You will use this all the time from the next lesson on.

## Comments

Text after `//` up to the end of the line, or anything between `/*` and `*/`, is a **comment**: a note for humans that the compiler ignores.

```c
// This whole line is a comment.
printf("hi\n");   /* and so is this part */
```

## Reading a compile error

Delete the semicolon after `printf("Hello, World!\n")` in the first program and run it. Instead of output, you get an error like this:

```
main.c:5  error C2143: syntax error: missing ';' before 'return'
```

It tells you the **file and line** (`main.c`, line 5), an **error code** (`C2143`) and what went wrong. Notice that the line is the one *after* the mistake: the compiler only noticed the missing `;` when it reached `return`. Two habits make errors much easier:

- Fix the **first** error first. Later errors are often side effects of the first one.
- Look at the reported line **and the line before it**.

## How exercises work

In the *Practice* tab you don't write whole programs. Each exercise asks you to write **one function**. LeakCode's test harness calls your function with many different inputs and compares what it gives back with the correct answers. The first exercise, *Add Two Numbers*, looks like this:

```c
int add(int a, int b) {
    return a + b;
}
```

It has the same shape as `main`: a name (`add`), the inputs in parentheses (two whole numbers called `a` and `b`), and a body in braces. `return a + b;` gives the sum back to whoever called the function. The next lessons explain each part properly; for now, just recognise the shape.

Press **Run** to try your code on the examples, and **Submit** to run every hidden test. Whatever happens, LeakCode tells you what went wrong and on which line.

## Summary

- A compiler turns your C text into a program the computer can run.
- Every program starts in `main`, and runs from top to bottom.
- Statements end with `;`, and blocks of code are wrapped in `{ }`.
- `printf` prints text; `\n` starts a new line; each `%d` is replaced by a number.
- When the compiler complains, read the first error, and check the line it names and the one before.
