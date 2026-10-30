<!-- {"title": "Functions: Naming a Piece of Work", "summary": "Writing your own functions with parameters and return values, why a function only gets copies of its arguments, and how every call gets its own stack frame.", "practice": ["largest-of-three", "power", "is-prime"]} -->
# Functions: naming a piece of work

A **function** is a named block of code that takes some inputs, does one job, and can give back a result. You have already used one (`printf`) and written one (`main`). Writing your own lets you solve a problem once, give the solution a name, and use it as often as you like.

```c
#include <stdio.h>

int square(int x) {          // takes an int called x, gives back an int
    return x * x;            // hand the result back to the caller
}

int main(void) {
    int a = square(4);                     // runs square with x = 4: a becomes 16
    printf("%d %d\n", a, square(a + 1));   // prints: 16 289
    return 0;
}
```

| Part | In `square` | Meaning |
|---|---|---|
| return type | `int` | the type of the value the function gives back |
| name | `square` | what you write to call it |
| parameters | `(int x)` | the inputs, each with a type and a name |
| body | `{ return x * x; }` | the code that runs every time it is called |

`return` ends the function **immediately** and hands the value back to the caller. A function that gives nothing back has the return type `void`, and a function without inputs has `(void)` as its parameter list:

```c
void printLine(int length) {
    for (int i = 0; i < length; i++) {
        printf("-");
    }
    printf("\n");
}
```

## Calling a function

Writing `square(4)` **calls** the function: the program jumps into `square` with `x` set to 4, runs its body, and comes back with the result. The values you pass are called **arguments**, and they are matched to the parameters by position. With `int power(int base, int exponent)`, the call `power(2, 10)` sets `base` to 2 and `exponent` to 10.

A function can return early. This is common in functions that answer a yes/no question:

```c
#include <stdio.h>
#include <stdbool.h>

bool isLeapYear(int year) {
    if (year % 400 == 0) return true;
    if (year % 100 == 0) return false;
    return year % 4 == 0;
}

int main(void) {
    for (int y = 1999; y <= 2004; y++) {
        printf("%d: %s\n", y, isLeapYear(y) ? "leap" : "normal");
    }
    return 0;
}
```

(`isLeapYear(y) ? "leap" : "normal"` is a compact if/else that picks one of two values; `%s` prints text.)

## Arguments are copies

A function receives **copies** of its arguments. Changing a parameter only changes the copy; the caller's variable stays the same:

```c
#include <stdio.h>

void tryToReset(int n) {
    n = 0;                    // changes this function's copy only
}

int main(void) {
    int value = 42;
    tryToReset(value);
    printf("%d\n", value);    // still 42
    return 0;
}
```

This is called **pass by value**. If you want a function to produce a new value, `return` it: `value = reset();`. And when a function really needs to change the caller's variables, you give it their *addresses* instead. That is one of the main reasons pointers exist, and the Pointers lesson starts exactly there.

## Local variables

Variables declared inside a function, including its parameters, are **local**: they exist only while that call is running, and other functions can't see them. Two functions can both have a variable called `i` without any conflict.

A variable declared inside a pair of braces exists only inside those braces:

```c
for (int i = 0; i < 3; i++) {
    int doubled = i * 2;      // a new doubled in every round
}
// neither i nor doubled exists here
```

## Every call gets its own frame

Each time a function is called, it gets a fresh **stack frame**: a small area of memory that holds its parameters and local variables. When the function returns, its frame is thrown away, and the local variables with it.

```c
#include <stdio.h>

int withTax(int price) {
    int tax = price / 10;
    return price + tax;
}

int main(void) {
    int book = withTax(200);
    int pen = withTax(30);
    printf("%d %d\n", book, pen);
    return 0;
}
```

> **Try it:** press *Visualize*. Every call to `withTax` adds a frame to the stack, with its own `price` and `tax`, and the frame disappears when the function returns.

A function can even call itself; this is called **recursion**, and each call then has its own frame with its own copy of the parameters. The *Recursion and the call stack* example in the visualizer shows four frames of the same function stacked up.

## Declare before you call

The compiler reads your file from top to bottom, so it must know about a function before the first call. Either define the function above the code that calls it (as in all the examples so far), or put a **prototype** at the top: a copy of the function's first line, ending with `;`:

```c
#include <stdio.h>

int square(int x);            // prototype: "this function exists"

int main(void) {
    printf("%d\n", square(3));
    return 0;
}

int square(int x) {           // the full definition can come later
    return x * x;
}
```

## What makes a good function

- It does **one** job, and its name says what that job is: `isPrime`, `largest`, `printReceipt`.
- It gets what it needs through its parameters and gives its result back with `return`.
- It is short enough to read in one go. When a function grows long, split part of it into a helper function.

## Summary

- A function has a return type, a name, parameters and a body; `return` hands back a result and leaves the function.
- `void` means "returns nothing" (or, as a parameter list, "takes nothing").
- Arguments are copied into the parameters: a function can't change the caller's variables through them.
- Locals live in the function's stack frame and disappear when it returns.
- Define a function above its first call, or declare it with a prototype.
