/* lc_driver.h - the test-harness API used by problem drivers (driver.c).
 *
 * A driver reads each test case from the input (one JSON value per
 * parameter), calls the user's function, prints the result with lc_out_*,
 * frees whatever the result owns, and ends the case. lc_end_case() then
 * reports leaks for everything allocated during the case and not freed.
 *
 *     int main(void) {
 *         while (lc_next_case()) {
 *             char *s = lc_read_str();
 *             char *copy = myStrdup(s);
 *             lc_out_str(copy);
 *             LC_FREE_RESULT(copy, "the string returned by myStrdup()");
 *             lc_end_case();
 *         }
 *         return lc_finish();
 *     }
 */
#ifndef LC_DRIVER_H
#define LC_DRIVER_H

#include <stddef.h>
#include <stdbool.h>

typedef enum { LCJ_NULL, LCJ_BOOL, LCJ_NUM, LCJ_STR, LCJ_ARR } LcJsonType;

typedef struct LcJson {
    LcJsonType type;
    int boolean;
    double num;
    long long inum;
    char *str;              /* NUL-terminated (strings) */
    int len;                /* string length or number of array items */
    struct LcJson **items;  /* array items */
} LcJson;

/* ---- test case loop ---- */
int  lc_next_case(void);    /* 1 if another case follows (starts it), 0 at end of input */
void lc_end_case(void);     /* checks leaks and records the case output */
int  lc_finish(void);       /* return value for main() */

/* ---- input: each call consumes the next value of the current case ---- */
const LcJson *lc_read_json(void);
int        lc_read_int(void);
long long  lc_read_ll(void);
double     lc_read_double(void);
bool       lc_read_bool(void);
char      *lc_read_str(void);                   /* NULL for null */
int       *lc_read_int_array(int *count);
char     **lc_read_str_array(int *count);
int      **lc_read_int_matrix(int *rows, int **cols);

/* ---- JSON helpers for structured input (e.g. design problems) ---- */
int           lc_json_len(const LcJson *v);
const LcJson *lc_json_at(const LcJson *v, int i);
int           lc_json_int(const LcJson *v);
long long     lc_json_ll(const LcJson *v);
const char   *lc_json_str(const LcJson *v);    /* scratch copy, do not pass to user code */
bool          lc_json_is_null(const LcJson *v);

/* ---- harness-owned memory: guarded like user blocks, freed at end of case ---- */
void *lc_harness_alloc(size_t size);
char *lc_harness_str(const LcJson *v);          /* guarded copy of a JSON string */
int  *lc_harness_ints(const LcJson *arr, int *count);
void  lc_make_readonly(const void *harness_ptr); /* writes will fault: for const inputs */
void  lc_harness_release(void *harness_ptr);       /* free a harness block right away */

/* ---- output: builds one JSON value per case ---- */
void lc_out_int(long long v);
void lc_out_bool(bool v);
void lc_out_double(double v, int decimals);
void lc_out_str(const char *s);
void lc_out_null(void);
void lc_out_int_array(const int *a, int n);
void lc_out_str_array(char *const *a, int n);
void lc_out_begin(void);   /* [ */
void lc_out_end(void);     /* ] */

/* ---- checks ---- */
void      lc_fail(const char *fmt, ...);                   /* fail this case with a message */
void      lc_abort_case(const char *title, const char *fmt, ...); /* fatal error found by the driver */
long long lc_alloc_count(void);                            /* allocations made by the program so far */
long long lc_free_count(void);
long long lc_block_size(const void *p);                    /* size of the live block starting at p, or -1 */
void      lc_free_owned(void *p, const char *what, const char *file, int line);

#define LC_FREE_RESULT(p, what) lc_free_owned((p), (what), __FILE__, __LINE__)

#endif
