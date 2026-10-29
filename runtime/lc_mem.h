/* lc_mem.h - force-included (/FI) into every translation unit LeakCode builds.
 *
 * Routes the C allocation functions through the LeakCode memory checker
 * (lc_rt.c) so leaks, double frees, overflows and use-after-free bugs can be
 * reported together with the exact source line that caused them.
 */
#ifndef LC_MEM_H
#define LC_MEM_H

#ifndef _CRT_SECURE_NO_WARNINGS
#define _CRT_SECURE_NO_WARNINGS
#endif

/* Every standard header that declares an allocation function is included
 * *before* the macros below exist, so later #includes in user code are
 * harmless no-ops instead of being macro-expanded. */
#include <stddef.h>
#include <stdlib.h>
#include <malloc.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif
void *lc_malloc(size_t size, const char *file, int line);
void *lc_calloc(size_t count, size_t size, const char *file, int line);
void *lc_realloc(void *ptr, size_t size, const char *file, int line);
void  lc_free(void *ptr, const char *file, int line);
char *lc_strdup(const char *s, const char *file, int line);
char *lc_strndup(const char *s, size_t n, const char *file, int line);
#ifdef __cplusplus
}
#endif

#define malloc(size)        lc_malloc((size), __FILE__, __LINE__)
#define calloc(count, size) lc_calloc((count), (size), __FILE__, __LINE__)
#define realloc(ptr, size)  lc_realloc((ptr), (size), __FILE__, __LINE__)
#define free(ptr)           lc_free((ptr), __FILE__, __LINE__)
#define strdup(s)           lc_strdup((s), __FILE__, __LINE__)
#define _strdup(s)          lc_strdup((s), __FILE__, __LINE__)
#define strndup(s, n)       lc_strndup((s), (n), __FILE__, __LINE__)

#endif
