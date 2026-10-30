<!-- {"title": "Arrays: Many Values in a Row", "summary": "Storing many values of one type, counting positions from 0, looping over arrays, passing them to functions, and why C never checks that an index is in range.", "practice": ["sum-of-an-array", "average-of-an-array", "double-every-element"]} -->
# Arrays: many values in a row

An **array** stores several values of the same type, side by side in memory, under a single name:

```c
int scores[5] = { 90, 72, 85, 64, 100 };
```

```
index:      0     1     2     3     4
         ┌─────┬─────┬─────┬─────┬─────┐
scores   │  90 │  72 │  85 │  64 │ 100 │
         └─────┴─────┴─────┴─────┴─────┘
```

- The positions are called **indexes**, and they **start at 0**. `scores[0]` is the first element and `scores[4]` the last: an array of `n` elements has the indexes `0` to `n - 1`.
- `scores[i]` works like any other variable: you can read it (`total += scores[i];`) and write it (`scores[1] = 75;`).
- The number of elements is fixed when the array is declared. `int counts[26] = {0};` sets all 26 elements to 0, while `int scores[5];` without a list holds garbage until you fill it.
- With a list, you can leave the size out and let the compiler count: `int primes[] = { 2, 3, 5, 7 };` has 4 elements.

## Loops and arrays

Arrays and `for` loops belong together: the loop visits each index in turn.

```c
#include <stdio.h>

int main(void) {
    int scores[5] = { 90, 72, 85, 64, 100 };
    int total = 0;
    for (int i = 0; i < 5; i++) {
        total += scores[i];
    }
    printf("total %d, average %.1f\n", total, total / 5.0);
    return 0;
}
```

> **Try it:** press *Visualize*. The array is drawn as a row of numbered boxes, and you can watch `i` move along it while `total` grows.

The same pattern finds the largest element: start with the first one, then let every other element challenge it.

```c
int best = scores[0];
for (int i = 1; i < 5; i++) {
    if (scores[i] > best) {
        best = scores[i];
    }
}
```

## C never checks your index

`scores[5]` and `scores[-1]` are **outside** the array, yet C compiles them without a word, and at run time it reads or writes whatever memory happens to be there. This mistake, going past the end of an array, is called a **buffer overflow**, and it is one of the most common and most dangerous bugs in C: it can silently change other variables or crash the program much later.

The usual cause is a loop that goes one step too far:

```c
for (int i = 0; i <= 5; i++)   // i reaches 5: one past the end of scores!
```

In LeakCode you don't have to guess: the checker stops the program at the bad access and shows you the line.

## Arrays and functions

A function that receives an array does **not** learn how many elements it has. That's why you always pass the length as a second parameter:

```c
#include <stdio.h>

int sumArray(int nums[], int numsSize) {
    int sum = 0;
    for (int i = 0; i < numsSize; i++) {
        sum += nums[i];
    }
    return sum;
}

int main(void) {
    int a[] = { 3, 1, 4, 1, 5 };
    printf("%d\n", sumArray(a, 5));    // prints 14
    return 0;
}
```

There is an important difference from the variables in the Functions lesson: an array is **not copied** when you pass it. The function works directly on the caller's array, so if it changes `nums[i]`, the caller sees the change:

```c
#include <stdio.h>

void doubleAll(int nums[], int numsSize) {
    for (int i = 0; i < numsSize; i++) {
        nums[i] = nums[i] * 2;
    }
}

int main(void) {
    int a[] = { 1, 2, 3 };
    doubleAll(a, 3);
    printf("%d %d %d\n", a[0], a[1], a[2]);    // prints 2 4 6
    return 0;
}
```

Why the difference? The function actually receives the *address* of the first element, not a copy of all the elements. The Pointers lesson explains this in detail.

### Counting the elements

Where an array is declared, `sizeof` tells you its size in bytes, so dividing by the size of one element gives the number of elements:

```c
int a[] = { 3, 1, 4, 1, 5 };
int count = sizeof a / sizeof a[0];   // 20 bytes / 4 bytes = 5
```

This only works where the array was declared. Inside `sumArray`, `nums` is just an address, and `sizeof nums` is the size of an address (8 bytes), whatever the array's length. That is another reason to pass the length along.

## Text is an array of characters

A piece of text, a **string**, is stored as an array of `char`s, followed by a special character with the value 0, written `'\0'`, that marks the end:

```c
char name[] = "cat";       // 4 chars: 'c' 'a' 't' '\0'
printf("%s starts with %c\n", name, name[0]);    // %s prints a string
```

That invisible extra character causes a lot of bugs, so strings get a lesson of their own later.

## Arrays of arrays

An array can hold other arrays: a **two-dimensional** array is a grid of rows and columns.

```c
#include <stdio.h>

int main(void) {
    int grid[2][3] = {
        { 1, 2, 3 },
        { 4, 5, 6 },
    };
    for (int row = 0; row < 2; row++) {
        for (int col = 0; col < 3; col++) {
            printf("%d ", grid[row][col]);
        }
        printf("\n");
    }
    return 0;
}
```

## Summary

- An array holds a fixed number of values of one type; indexes go from `0` to `n - 1`.
- Loop over an array with `for (int i = 0; i < n; i++)`.
- C never checks indexes: going past the end is a buffer overflow, a serious bug.
- Pass an array's length to functions along with the array. The function works on the caller's array, not on a copy.
- Strings are arrays of `char` that end with `'\0'`.
