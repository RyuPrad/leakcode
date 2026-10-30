<!-- {"title": "Linked Structures: Ownership in Practice", "summary": "Lists and trees made of heap nodes: the pointer-to-pointer technique, freeing in the right order, and recursion versus iteration.", "practice": ["build-and-free-a-list", "remove-linked-list-elements", "merge-two-sorted-lists", "deep-copy-a-list", "free-a-binary-tree", "delete-node-in-a-bst"]} -->
# Linked structures: ownership in practice

A linked list or tree is a set of separately allocated **nodes** connected by pointers. The structure owns its nodes: whoever removes a node from it becomes responsible for freeing that node.

```c
struct ListNode {
    int val;
    struct ListNode *next;     // NULL marks the end
};
```

## Three ways to walk a list

```c
for (struct ListNode *p = head; p != NULL; p = p->next)    // read-only walk
    printf("%d ", p->val);
```

To **modify** the list while walking (insert, remove), you need the pointer that points *to* the current node: either the previous node, or a **pointer to the link** itself:

```c
struct ListNode **link = &head;           // first the head pointer, then some node's next
while (*link != NULL) {
    if ((*link)->val < 0) {
        struct ListNode *dead = *link;
        *link = dead->next;               // unlink: works for the head too
        free(dead);                       // we unlinked it, so we free it
    } else {
        link = &(*link)->next;
    }
}
```

The pointer-to-pointer version has no special case for the first node, which is why it shows up in so many solutions here (append, remove, merge, insert into a BST).

## Freeing: save before you free

```c
while (head != NULL) {
    struct ListNode *next = head->next;   // read it while the node is still ours
    free(head);
    head = next;
}
```

For trees, free children before parents (*post-order*), or save the child pointers in locals first.

## A complete example

```c
#include <stdio.h>
#include <stdlib.h>

struct ListNode { int val; struct ListNode *next; };

/* Inserts val into a sorted list; returns the (possibly new) head. */
struct ListNode *insertSorted(struct ListNode *head, int val) {
    struct ListNode **link = &head;
    while (*link != NULL && (*link)->val < val)
        link = &(*link)->next;
    struct ListNode *node = malloc(sizeof *node);
    if (node == NULL) return head;
    node->val = val;
    node->next = *link;
    *link = node;
    return head;
}

void freeList(struct ListNode *head) {
    while (head != NULL) {
        struct ListNode *next = head->next;
        free(head);
        head = next;
    }
}

int main(void) {
    int input[] = { 5, 1, 4, 2, 3 };
    struct ListNode *list = NULL;
    for (int i = 0; i < 5; i++) list = insertSorted(list, input[i]);
    for (struct ListNode *p = list; p; p = p->next) printf("%d ", p->val);
    printf("\n");
    freeList(list);
    return 0;
}
```

## Recursion or iteration?

Recursive code on trees is short and natural, because a tree *is* recursive. But each call uses a stack frame, and the stack is limited (8 MB here, often 1 MB on Windows by default). Recursing down a 100 000-node list, or a tree that degenerated into a list, can overflow it. Iterative versions with an explicit stack or the pointer-to-pointer trick use O(1) or heap memory instead.

## Design checklist for a linked structure

- Every node allocated with `malloc` has exactly one parent (or is the root/head).
- Removing a node: unlink first, then free.
- Destroying the structure: visit every node once, free children before parents.
- Copying the structure: allocate new nodes (a deep copy), never share them.
- After any operation, run it under LeakCode: a leak usually means a node was unlinked but not freed; a use-after-free usually means it was freed but not unlinked.
