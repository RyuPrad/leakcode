<!-- {"title": "Decisions and Loops: if, while and for", "summary": "Comparing values, choosing what runs with if and else, and repeating work with while and for loops, plus the classic mistakes to avoid.", "practice": ["is-even", "largest-of-three", "letter-grade", "sum-one-to-n", "count-digits", "is-prime"]} -->
# Decisions and loops

So far, every line of a program ran exactly once, from top to bottom. Real programs make choices ("is the password right?") and repeat work ("for every item in the basket..."). This lesson covers both.

## Comparisons: true or false

A comparison checks two values and produces **1 for true** or **0 for false**:

| Operator | Means |
|---|---|
| `==` | equal (two `=` signs!) |
| `!=` | not equal |
| `<` `<=` | less than, less than or equal |
| `>` `>=` | greater than, greater than or equal |

Combine conditions with `&&` (**and**: both must be true), `||` (**or**: at least one must be true) and `!` (**not**):

```c
age >= 13 && age <= 19      // a teenager
day == 6 || day == 7        // the weekend
!(x > 0)                    // x is not positive
```

## if and else

`if` runs a block of code only when its condition is true. `else` gives the alternative:

```c
if (temperature > 30) {
    printf("hot\n");
} else if (temperature > 15) {
    printf("warm\n");
} else {
    printf("cold\n");
}
```

C checks the conditions from the top and runs the **first** block whose condition is true, then skips the rest. The final `else` runs only if none of them was true.

```c
#include <stdio.h>

int main(void) {
    int score = 72;
    if (score >= 90) {
        printf("A\n");
    } else if (score >= 80) {
        printf("B\n");
    } else if (score >= 70) {
        printf("C\n");
    } else {
        printf("below C\n");
    }
    return 0;
}
```

> **Try it:** press *Visualize* and step through with the → key: the highlighted line shows which line runs next, so you can see which checks are skipped. Then change `score` and run it again.

## while: repeat as long as a condition holds

```c
int n = 1;
while (n <= 5) {
    printf("%d ", n);
    n++;
}
// prints: 1 2 3 4 5
```

The condition is checked **before** every round. When it becomes false, the program continues after the loop's closing brace. If nothing inside the loop ever makes the condition false, for example if you forget `n++`, the loop never ends: an **infinite loop**. LeakCode stops a program that runs for too long.

`while` is the right loop when you don't know in advance how many rounds you need. This one counts the digits of a number by removing them one at a time:

```c
#include <stdio.h>

int main(void) {
    int n = 2026;
    int digits = 0;
    while (n > 0) {
        n = n / 10;      // drop the last digit: 2026 -> 202 -> 20 -> 2 -> 0
        digits++;
    }
    printf("%d digits\n", digits);
    return 0;
}
```

## for: counting loops

Most loops count from one number to another, so C has a compact loop that puts the three parts on one line:

```c
for (int i = 0; i < 5; i++) {
    printf("%d ", i);
}
// prints: 0 1 2 3 4
```

| Part | When it runs | Here |
|---|---|---|
| start | once, before the first round | `int i = 0` |
| condition | before every round; the loop stops when it is false | `i < 5` |
| step | after every round | `i++` |

The line `for (int i = 0; i < n; i++)` runs exactly `n` times, with `i` going from `0` to `n - 1`. You will write it thousands of times: it matches the way arrays are numbered, which is the topic of the Arrays lesson.

```c
#include <stdio.h>

int main(void) {
    int n = 5;
    int sum = 0;
    for (int i = 1; i <= n; i++) {
        sum += i;
    }
    printf("1 + 2 + ... + %d = %d\n", n, sum);
    return 0;
}
```

> **Try it:** visualize this one and watch `i` and `sum` change on every round of the loop.

## break and continue

- `break` leaves the loop immediately.
- `continue` skips the rest of the current round and moves on to the next one.

```c
#include <stdio.h>

int main(void) {
    // print the odd numbers below 10, but stop at the first one above 6
    for (int n = 1; n < 10; n++) {
        if (n % 2 == 0) {
            continue;        // even: skip to the next n
        }
        if (n > 6) {
            break;           // 7: leave the loop
        }
        printf("%d ", n);
    }
    printf("\n");            // prints: 1 3 5
    return 0;
}
```

## Loops inside loops

A loop inside another loop runs completely for every round of the outer one. This prints a small multiplication table, one row per round of the outer loop:

```c
#include <stdio.h>

int main(void) {
    for (int row = 1; row <= 3; row++) {
        for (int col = 1; col <= 4; col++) {
            printf("%4d", row * col);    // %4d: at least 4 characters wide
        }
        printf("\n");
    }
    return 0;
}
```

## Classic mistakes

- **`=` instead of `==`.** `if (x = 5)` *stores* 5 in `x` and is then always true. The compiler won't stop you, so double-check every condition.
- **A stray semicolon.** In `if (x > 0);` or `for (...);` the `;` is an empty statement that becomes the whole body. The block below then runs once, unconditionally.
- **Off by one.** `i <= n` when you meant `i < n`, or the reverse. Ask yourself: what is the first value of `i`, what is the last, and how many rounds is that?
- **A loop that never ends.** Check that something inside the loop moves it towards its condition becoming false.

## Summary

- Comparisons give 1 (true) or 0 (false); combine them with `&&`, `||` and `!`.
- `if` / `else if` / `else` runs the first block whose condition is true.
- `while (condition)` repeats while the condition holds; `for (start; condition; step)` is the counting loop.
- `for (int i = 0; i < n; i++)` runs `n` times, with `i` from `0` to `n - 1`.
- `break` leaves a loop, `continue` skips to its next round.
