<!-- {"title": "Structs: Grouping Related Data", "summary": "Defining your own types that bundle several values together, reading and writing their fields, typedef, arrays of structs, and passing structs to functions.", "practice": ["manhattan-distance"]} -->
# Structs: grouping related data

Often several values belong together: a point has an `x` and a `y`, a student has a name, an age and an average. A **struct** bundles such values into one new type. Each value inside it is called a **field** (or *member*):

```c
struct Point {
    int x;
    int y;
};                         // don't forget this semicolon

struct Point p = { 3, 4 }; // x = 3, y = 4 (in the order the fields are declared)
p.x = 10;                  // a dot reaches a field
printf("(%d, %d)\n", p.x, p.y);
```

The `struct Point { ... };` part only describes the new type: it creates no variable. `struct Point p` then declares a variable of that type, just like `int n` declares an `int`.

Fields can have different types, including arrays:

```c
struct Student {
    char name[20];
    int age;
    double average;
};
```

## typedef: a shorter name

Writing `struct Student` every time gets long. `typedef` gives a type a second name, and it is common to define and name a struct in one go:

```c
typedef struct {
    char name[20];
    int age;
    double average;
} Student;

Student s = { "Ada", 20, 17.5 };
printf("%s is %d\n", s.name, s.age);
```

`printf` has no placeholder for a whole struct: print its fields one by one.

## Arrays of structs, and structs in functions

```c
#include <stdio.h>

typedef struct {
    int width;
    int height;
} Rect;

int area(Rect r) {
    return r.width * r.height;
}

int main(void) {
    Rect rooms[3] = { { 4, 3 }, { 5, 5 }, { 2, 6 } };
    int total = 0;
    for (int i = 0; i < 3; i++) {
        total += area(rooms[i]);
    }
    printf("total floor area: %d\n", total);
    return 0;
}
```

> **Try it:** press *Visualize*. The `rooms` array shows each struct with its fields, and every call to `area` gets a frame with its own copy `r`.

`rooms[i].width` reads the `width` of the struct at index `i`: first pick the element, then the field.

## Structs are copied

A struct behaves like an `int`: assigning it, passing it to a function or returning it from one copies **every field**.

```c
Rect a = { 2, 3 };
Rect b = a;          // b is a separate copy
b.width = 100;       // a.width is still 2
```

So a function that receives a struct works on its own copy. To change the caller's struct, either return the new struct (`r = grow(r);`) or pass its address, which the next lesson, Pointers, explains. With a pointer to a struct you reach the fields with an arrow, `p->width`, instead of a dot. Structs and pointers together are how linked lists and trees are built, near the end of this course.

## Summary

- `struct Name { fields };` defines a new type; `struct Name var;` declares a variable of it.
- `var.field` reads or writes one field.
- `typedef struct { ... } Name;` lets you write just `Name`.
- Structs are copied when assigned, passed or returned, like any other value.
