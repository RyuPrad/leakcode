<!-- {"title": "Variables, Types and Arithmetic", "summary": "Storing values in named variables, the basic types (int, double, char, bool), doing arithmetic, and the surprise of integer division.", "practice": ["add-two-numbers", "celsius-to-fahrenheit", "is-even"]} -->
# Variables, types and arithmetic

A **variable** is a named place in memory that holds a value. In C, every variable has a **type** that says what kind of value it can hold, and you must **declare** it (give its type and its name) before you use it:

```c
int age;           // declare: a variable called age that holds an int (a whole number)
age = 20;          // assign: store 20 in it
int year = 2026;   // declare and give it a first value in one step
age = age + 1;     // read age, add 1, store the result back: age is now 21
```

The `=` sign means **"store the value on the right into the variable on the left"**. It is not the "equals" of maths, which is why `age = age + 1` makes perfect sense in C.

## The basic types

| Type | Holds | Example | Print it with |
|---|---|---|---|
| `int` | whole numbers from about −2.1 billion to +2.1 billion | `int count = -3;` | `%d` |
| `long long` | much bigger whole numbers (up to about 9.2 × 10¹⁸) | `long long big = 5000000000;` | `%lld` |
| `double` | numbers with a fractional part | `double price = 9.99;` | `%f`, or `%.2f` for 2 decimals |
| `char` | a single character, written in single quotes | `char grade = 'A';` | `%c` |
| `bool` | `true` or `false` (needs `#include <stdbool.h>`) | `bool done = false;` | `%d` (prints 1 or 0) |

```c
#include <stdio.h>
#include <stdbool.h>

int main(void) {
    int apples = 7;
    double price = 0.35;
    char grade = 'B';
    bool hungry = true;

    printf("%d apples cost %.2f\n", apples, apples * price);
    printf("grade %c, hungry: %d\n", grade, hungry);
    return 0;
}
```

> **Try it:** press *Visualize* under this program. It runs the program one line at a time, and you can watch each variable get its value.

Each type uses a fixed number of **bytes** of memory: a `char` takes 1 byte, an `int` 4, and a `double` or a `long long` 8. You can ask with `sizeof`: `sizeof(int)` is 4. Sizes will matter a lot once you manage memory yourself.

A `char` is really a small number: each character has a code, and `'A'` is stored as 65. That is why `'A' + 1` is `'B'`.

## Arithmetic

| Operator | Meaning | Example | Result |
|---|---|---|---|
| `+` `-` `*` | add, subtract, multiply | `7 * 3` | `21` |
| `/` | divide | `7 / 2` | `3` (not 3.5!) |
| `%` | remainder after dividing | `7 % 2` | `1` |

Multiplication and division happen before addition and subtraction, like in maths. Use parentheses when in doubt: `(a + b) / 2`.

### Integer division drops the fraction

When **both** sides of `/` are whole numbers, the result is a whole number too: the fraction is simply thrown away. `7 / 2` is `3`, and `1 / 3` is `0`. If at least one side is a `double`, you get the exact answer: `7 / 2.0` is `3.5`.

To divide two `int` variables exactly, convert one of them to `double` first. Writing a type in parentheses before a value converts it; this is called a **cast**:

```c
#include <stdio.h>

int main(void) {
    int a = 7, b = 2;
    printf("%d / %d = %d\n", a, b, a / b);          // 3
    printf("%d %% %d = %d\n", a, b, a % b);         // 1    (%% prints a % sign)
    printf("exactly: %.1f\n", (double)a / b);       // 3.5
    printf("too late: %.1f\n", (double)(a / b));    // 3.0: the int division happened first
    return 0;
}
```

The remainder operator `%` is more useful than it looks:

- `n % 2 == 0` is true exactly when `n` is even.
- `n % 10` is the last digit of `n`, and `n / 10` removes that digit.

### Shortcuts

You'll see these everywhere:

```c
count = count + 1;   // add one, can also be written:
count += 1;
count++;             // the shortest form: "increment"
total -= 5;          // total = total - 5
total *= 2;          // total = total * 2
```

## Always give a variable a value

A variable you declare without a value holds **garbage**: whatever bytes happened to be in that piece of memory. C does not set it to 0 for you.

```c
int total;           // garbage!
total = total + 5;   // garbage + 5 is still garbage
```

Give every variable a starting value: `int total = 0;`. In the visualizer, a variable that has no value yet shows as `?`.

## Numbers that are too big

An `int` can't go past 2 147 483 647. A calculation that goes further **overflows**: the result is wrong, usually a strange negative number, and C gives no warning. When values can get large (sums of many numbers, factorials, money in cents), use `long long`.

## Reading a number from the keyboard

`scanf` reads what the user types. In LeakCode, type your input in the *Input* box of the Playground before you press *Run*:

```c
#include <stdio.h>

int main(void) {
    int n = 0;
    printf("Enter a number: ");
    scanf("%d", &n);
    printf("Twice %d is %d\n", n, 2 * n);
    return 0;
}
```

Notice the `&` before `n`. It gives `scanf` the *location* of `n` in memory, so that `scanf` can store the number there. The Pointers lesson explains exactly how that works; for now, remember that `scanf` needs an `&` before the variable's name.

## Summary

- Declare a variable with its type and name, and always give it a starting value.
- `int` for whole numbers, `long long` for big ones, `double` for fractions, `char` for characters, `bool` for true/false.
- `int / int` throws away the fraction; cast to `double` for an exact result.
- `%` gives the remainder: great for "is it even?" and for digits.
- `printf` placeholders: `%d` int, `%lld` long long, `%f` double, `%c` char.
