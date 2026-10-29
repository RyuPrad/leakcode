/* lc_ds.h - linked-list and binary-tree helpers for drivers.
 *
 * Define LC_WANT_LIST and/or LC_WANT_TREE, then include this header after the
 * problem prelude has defined struct ListNode / struct TreeNode. Nodes are
 * allocated with the tracked malloc, so the user's code may free them, and
 * the helpers that walk a returned structure detect cycles and shared nodes.
 */
#ifndef LC_DS_H
#define LC_DS_H

#include "lc_driver.h"

#ifdef LC_WANT_LIST
static struct ListNode *lc_list_from_json(const LcJson *arr)
{
    struct ListNode *head = NULL, **tail = &head;
    int i, n = lc_json_len(arr);
    for (i = 0; i < n; i++) {
        struct ListNode *node = (struct ListNode *)malloc(sizeof *node);
        node->val = lc_json_int(lc_json_at(arr, i));
        node->next = NULL;
        *tail = node;
        tail = &node->next;
    }
    return head;
}

static struct ListNode *lc_read_list(void) { return lc_list_from_json(lc_read_json()); }

static void lc_check_list_acyclic(struct ListNode *head)
{
    struct ListNode *slow = head, *fast = head;
    while (fast && fast->next) {
        slow = slow->next;
        fast = fast->next->next;
        if (slow == fast)
            lc_abort_case("Your list contains a cycle",
                "Following the next pointers of the list you returned never reaches NULL: some node's next "
                "pointer points back to an earlier node. Make sure the last node's next is set to NULL.");
    }
}

static void lc_out_list(struct ListNode *head)
{
    lc_check_list_acyclic(head);
    lc_out_begin();
    for (; head; head = head->next) lc_out_int(head->val);
    lc_out_end();
}

static void lc_free_list(struct ListNode *head, const char *what)
{
    lc_check_list_acyclic(head);
    while (head) {
        struct ListNode *next = head->next;
        lc_free_owned(head, what, __FILE__, __LINE__);
        head = next;
    }
}
#endif

#ifdef LC_WANT_TREE
static struct TreeNode *lc_tree_node(int val)
{
    struct TreeNode *t = (struct TreeNode *)malloc(sizeof *t);
    t->val = val;
    t->left = t->right = NULL;
    return t;
}

/* LeetCode-style level order with nulls: [1,2,3,null,4] */
static struct TreeNode *lc_tree_from_json(const LcJson *arr)
{
    int n = lc_json_len(arr), i = 1, qh = 0, qt = 0;
    struct TreeNode **q, *root;
    if (n == 0 || lc_json_is_null(lc_json_at(arr, 0))) return NULL;
    q = (struct TreeNode **)lc_harness_alloc(sizeof(*q) * (size_t)n);
    root = lc_tree_node(lc_json_int(lc_json_at(arr, 0)));
    q[qt++] = root;
    while (qh < qt && i < n) {
        struct TreeNode *cur = q[qh++];
        const LcJson *v = lc_json_at(arr, i++);
        if (!lc_json_is_null(v)) q[qt++] = cur->left = lc_tree_node(lc_json_int(v));
        if (i < n) {
            v = lc_json_at(arr, i++);
            if (!lc_json_is_null(v)) q[qt++] = cur->right = lc_tree_node(lc_json_int(v));
        }
    }
    return root;
}

static struct TreeNode *lc_read_tree(void) { return lc_tree_from_json(lc_read_json()); }

/* Collects the nodes in level order (NULL children included) into a harness
 * array, refusing structures that are not trees (cycles or shared nodes). */
static struct TreeNode **lc_tree_levels(struct TreeNode *root, int *count)
{
    int cap = 64, n = 0, head = 0, seen_cap = 64, nseen = 0, k;
    struct TreeNode **q = (struct TreeNode **)lc_harness_alloc(sizeof(*q) * (size_t)cap);
    struct TreeNode **seen = (struct TreeNode **)lc_harness_alloc(sizeof(*seen) * (size_t)seen_cap);
    q[n++] = root;
    while (head < n) {
        struct TreeNode *cur = q[head++];
        if (!cur) continue;
        for (k = 0; k < nseen && nseen < 4096; k++)
            if (seen[k] == cur)
                lc_abort_case("Your tree is not a tree",
                    "The same node is reachable twice from the root (a cycle or a node with two parents).");
        if (nseen == seen_cap) {
            struct TreeNode **ns = (struct TreeNode **)lc_harness_alloc(sizeof(*ns) * (size_t)seen_cap * 2);
            memcpy(ns, seen, sizeof(*ns) * (size_t)seen_cap);
            seen = ns;
            seen_cap *= 2;
        }
        seen[nseen++] = cur;
        if (n + 2 > cap) {
            struct TreeNode **nq;
            if (cap > (1 << 22))
                lc_abort_case("Your tree is too large", "The tree you returned has millions of nodes (or a cycle).");
            nq = (struct TreeNode **)lc_harness_alloc(sizeof(*nq) * (size_t)cap * 2);
            memcpy(nq, q, sizeof(*nq) * (size_t)cap);
            q = nq;
            cap *= 2;
        }
        q[n++] = cur->left;
        q[n++] = cur->right;
    }
    while (n > 0 && !q[n - 1]) n--;
    *count = n;
    return q;
}

static void lc_out_tree(struct TreeNode *root)
{
    int n, i;
    struct TreeNode **q = lc_tree_levels(root, &n);
    lc_out_begin();
    for (i = 0; i < n; i++) {
        if (q[i]) lc_out_int(q[i]->val);
        else lc_out_null();
    }
    lc_out_end();
}

static void lc_free_tree(struct TreeNode *root, const char *what)
{
    int n, i;
    struct TreeNode **q = lc_tree_levels(root, &n);
    for (i = 0; i < n; i++)
        if (q[i]) lc_free_owned(q[i], what, __FILE__, __LINE__);
}
#endif

#endif
