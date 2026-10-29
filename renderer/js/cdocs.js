// A pocket reference of the C standard library, shown in editor hovers and
// autocomplete. `mem` holds the memory-safety notes that matter most here.

export const CDOCS = {
  // <stdlib.h> memory
  malloc: { h: 'stdlib.h', sig: 'void *malloc(size_t size)', doc: 'Allocates `size` bytes of **uninitialized** heap memory and returns a pointer to it, or NULL on failure.', mem: 'You own the block: `free()` it exactly once. New blocks contain garbage (LeakCode fills them with 0xCD).' },
  calloc: { h: 'stdlib.h', sig: 'void *calloc(size_t count, size_t size)', doc: 'Allocates an array of `count` elements of `size` bytes, **all bits zero**. Returns NULL on failure (including when count * size overflows).', mem: 'Free with `free()`. Handy for structs whose pointers must start as NULL.' },
  realloc: { h: 'stdlib.h', sig: 'void *realloc(void *ptr, size_t size)', doc: 'Resizes the block at `ptr` to `size` bytes, possibly **moving** it. The contents up to the smaller size are kept. `realloc(NULL, n)` behaves like `malloc(n)`.', mem: 'After a successful call the old pointer is invalid: always use the returned one (`p = realloc(p, n)`), and update every other pointer into the block. On failure it returns NULL and the old block is still yours.' },
  free: { h: 'stdlib.h', sig: 'void free(void *ptr)', doc: 'Releases a block obtained from malloc, calloc or realloc. `free(NULL)` does nothing.', mem: 'Pass exactly the pointer you were given, once. Afterwards every pointer to the block is dangling: set it to NULL.' },
  strdup: { h: 'string.h', sig: 'char *strdup(const char *s)', doc: 'Returns a newly allocated copy of the string `s` (POSIX / C23, available on MSVC as `_strdup`).', mem: 'The copy is yours: `free()` it.' },
  strndup: { h: 'string.h', sig: 'char *strndup(const char *s, size_t n)', doc: 'Returns a newly allocated copy of at most `n` characters of `s`, always NUL-terminated.', mem: 'The copy is yours: `free()` it.' },

  // <string.h>
  memcpy: { h: 'string.h', sig: 'void *memcpy(void *dst, const void *src, size_t n)', doc: 'Copies `n` bytes from `src` to `dst` and returns `dst`.', mem: 'The regions must **not overlap** (use memmove then). `dst` must have room for `n` bytes.' },
  memmove: { h: 'string.h', sig: 'void *memmove(void *dst, const void *src, size_t n)', doc: 'Copies `n` bytes from `src` to `dst`, correctly even when the regions overlap. Returns `dst`.' },
  memset: { h: 'string.h', sig: 'void *memset(void *dst, int value, size_t n)', doc: 'Sets `n` bytes starting at `dst` to `(unsigned char)value`. Returns `dst`.', mem: 'Works byte by byte: `memset(a, 1, n * sizeof(int))` does **not** make every int 1.' },
  memcmp: { h: 'string.h', sig: 'int memcmp(const void *a, const void *b, size_t n)', doc: 'Compares the first `n` bytes. Returns <0, 0 or >0.' },
  strlen: { h: 'string.h', sig: 'size_t strlen(const char *s)', doc: 'Returns the number of characters before the terminating `\'\\0\'`.', mem: 'A string of length n occupies **n + 1** bytes. Crashes on NULL, and reads past the end if the `\'\\0\'` is missing.' },
  strcpy: { h: 'string.h', sig: 'char *strcpy(char *dst, const char *src)', doc: 'Copies `src` including its `\'\\0\'` into `dst`. Returns `dst`.', mem: 'No bounds check: `dst` needs at least `strlen(src) + 1` bytes.' },
  strncpy: { h: 'string.h', sig: 'char *strncpy(char *dst, const char *src, size_t n)', doc: 'Copies at most `n` characters, padding with `\'\\0\'` if `src` is shorter.', mem: 'If `src` has n or more characters, the result is **not** NUL-terminated.' },
  strcat: { h: 'string.h', sig: 'char *strcat(char *dst, const char *src)', doc: 'Appends `src` to the end of the string in `dst`.', mem: '`dst` needs room for `strlen(dst) + strlen(src) + 1` bytes.' },
  strncat: { h: 'string.h', sig: 'char *strncat(char *dst, const char *src, size_t n)', doc: 'Appends at most `n` characters of `src`, then a `\'\\0\'`.', mem: 'Needs room for `strlen(dst) + n + 1` bytes.' },
  strcmp: { h: 'string.h', sig: 'int strcmp(const char *a, const char *b)', doc: 'Compares two strings lexicographically. Returns <0, 0 or >0.', mem: 'Use it (not `==`) to compare string contents: `==` compares addresses.' },
  strncmp: { h: 'string.h', sig: 'int strncmp(const char *a, const char *b, size_t n)', doc: 'Compares at most `n` characters.' },
  strchr: { h: 'string.h', sig: 'char *strchr(const char *s, int c)', doc: 'Returns a pointer to the first occurrence of `c` in `s`, or NULL.' },
  strrchr: { h: 'string.h', sig: 'char *strrchr(const char *s, int c)', doc: 'Returns a pointer to the last occurrence of `c` in `s`, or NULL.' },
  strstr: { h: 'string.h', sig: 'char *strstr(const char *haystack, const char *needle)', doc: 'Returns a pointer to the first occurrence of `needle` in `haystack`, or NULL.' },
  strtok: { h: 'string.h', sig: 'char *strtok(char *s, const char *delims)', doc: 'Splits a string into tokens. Pass the string on the first call and NULL afterwards.', mem: '**Modifies** its input (writes `\'\\0\'` over delimiters) and keeps hidden state: never use it on string literals or `const` input.' },

  // <stdio.h>
  printf: { h: 'stdio.h', sig: 'int printf(const char *format, ...)', doc: 'Prints formatted output to stdout. Common conversions: `%d` int, `%ld` long, `%lld` long long, `%zu` size_t, `%u` unsigned, `%f` double, `%c` char, `%s` string, `%p` pointer, `%x` hex.' },
  fprintf: { h: 'stdio.h', sig: 'int fprintf(FILE *stream, const char *format, ...)', doc: 'Like printf, but to `stream` (e.g. `stderr`).' },
  sprintf: { h: 'stdio.h', sig: 'int sprintf(char *dst, const char *format, ...)', doc: 'Formats into the buffer `dst`.', mem: 'No bounds check: prefer `snprintf`.' },
  snprintf: { h: 'stdio.h', sig: 'int snprintf(char *dst, size_t size, const char *format, ...)', doc: 'Formats into `dst`, writing at most `size` bytes including the `\'\\0\'`. Returns the length the full output **would** have.', mem: '`snprintf(NULL, 0, fmt, ...)` returns the length you need to allocate (plus 1 for the `\'\\0\'`).' },
  scanf: { h: 'stdio.h', sig: 'int scanf(const char *format, ...)', doc: 'Reads formatted input from stdin into the pointed-to variables. Returns the number of items read (EOF at end of input).', mem: 'Pass addresses: `scanf("%d", &x)`. `%s` has no bounds: use a width like `%99s` for a 100-byte buffer.' },
  fgets: { h: 'stdio.h', sig: 'char *fgets(char *buf, int size, FILE *stream)', doc: 'Reads a line (including the newline, if it fits) of at most `size - 1` characters. Returns NULL at end of file.' },
  puts: { h: 'stdio.h', sig: 'int puts(const char *s)', doc: 'Writes `s` and a newline to stdout.' },
  putchar: { h: 'stdio.h', sig: 'int putchar(int c)', doc: 'Writes one character to stdout.' },
  getchar: { h: 'stdio.h', sig: 'int getchar(void)', doc: 'Reads one character from stdin, or returns EOF.', mem: 'Store the result in an `int`, not a `char`, so EOF can be told apart from a real character.' },
  fopen: { h: 'stdio.h', sig: 'FILE *fopen(const char *path, const char *mode)', doc: 'Opens a file. Returns NULL on failure.', mem: 'Every successful fopen needs an `fclose`.' },
  fclose: { h: 'stdio.h', sig: 'int fclose(FILE *stream)', doc: 'Closes a stream opened with fopen.' },

  // <stdlib.h> misc
  atoi: { h: 'stdlib.h', sig: 'int atoi(const char *s)', doc: 'Converts the leading digits of `s` to an int. No error reporting: prefer `strtol`.' },
  strtol: { h: 'stdlib.h', sig: 'long strtol(const char *s, char **end, int base)', doc: 'Parses a long integer. If `end` is not NULL, `*end` is set to the first character not parsed.' },
  abs: { h: 'stdlib.h', sig: 'int abs(int x)', doc: 'Absolute value. `abs(INT_MIN)` overflows.' },
  qsort: { h: 'stdlib.h', sig: 'void qsort(void *base, size_t count, size_t size, int (*cmp)(const void *, const void *))', doc: 'Sorts an array of `count` elements of `size` bytes, using `cmp` to compare two elements.', mem: 'The comparator receives pointers **to** the elements: for an `int` array, cast to `const int *`.' },
  bsearch: { h: 'stdlib.h', sig: 'void *bsearch(const void *key, const void *base, size_t count, size_t size, int (*cmp)(const void *, const void *))', doc: 'Binary-searches a sorted array. Returns a pointer to a matching element, or NULL.' },
  exit: { h: 'stdlib.h', sig: 'void exit(int status)', doc: 'Ends the program.', mem: 'In LeakCode problems, return from your function instead.' },

  // <ctype.h>
  isdigit: { h: 'ctype.h', sig: 'int isdigit(int c)', doc: 'Non-zero if `c` is a decimal digit.', mem: 'Pass an `unsigned char` value: `isdigit((unsigned char)s[i])`.' },
  isalpha: { h: 'ctype.h', sig: 'int isalpha(int c)', doc: 'Non-zero if `c` is a letter.' },
  isspace: { h: 'ctype.h', sig: 'int isspace(int c)', doc: 'Non-zero for space, \\t, \\n, \\v, \\f, \\r.' },
  isalnum: { h: 'ctype.h', sig: 'int isalnum(int c)', doc: 'Non-zero if `c` is a letter or a digit.' },
  toupper: { h: 'ctype.h', sig: 'int toupper(int c)', doc: 'Upper-case version of `c` (other characters are returned unchanged).' },
  tolower: { h: 'ctype.h', sig: 'int tolower(int c)', doc: 'Lower-case version of `c`.' },

  // <assert.h>
  assert: { h: 'assert.h', sig: 'void assert(scalar expression)', doc: 'Aborts the program with a message if `expression` is false. Use it to check your own assumptions while debugging.' },
};

export const KEYWORDS = {
  sizeof: 'Yields the size in bytes of a type or object, as a `size_t`. `sizeof arr` is the whole array only where `arr` is a real array; for a pointer (including an array parameter) it is just the pointer size (8 bytes here).',
  NULL: 'The null pointer constant: a pointer that points to nothing. Dereferencing it crashes.',
  size_t: 'Unsigned integer type for sizes and counts (64-bit here). Print it with `%zu`. Careful: `size_t` can never be negative, so `i >= 0` is always true.',
  const: 'Promises the value will not be modified through this name. `const char *s`: the characters are read-only. `char *const s`: the pointer itself is read-only.',
  static: 'At file scope: visible only in this file. Inside a function: the variable keeps its value between calls (and lives for the whole program).',
  struct: 'Groups named fields into one type. Access fields with `.` on a struct and `->` on a pointer to a struct (`p->x` means `(*p).x`).',
  typedef: 'Creates an alias for a type, e.g. `typedef struct Node Node;`.',
  void: 'No value. `void *` is a generic pointer that converts to any object pointer type without a cast.',
};

const C_WORDS = ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern',
  'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof',
  'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'bool', 'true', 'false',
  'NULL', 'size_t', 'uint8_t', 'uint32_t', 'int64_t', 'uint64_t', 'uintptr_t', 'ptrdiff_t', 'INT_MAX', 'INT_MIN'];

export const SNIPPETS = [
  { label: 'for', detail: 'for loop', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}' },
  { label: 'while', detail: 'while loop', body: 'while (${1:condition}) {\n\t$0\n}' },
  { label: 'if', detail: 'if statement', body: 'if (${1:condition}) {\n\t$0\n}' },
  { label: 'malloc-check', detail: 'allocate and check for NULL', body: '${1:int} *${2:p} = malloc(${3:n} * sizeof *${2:p});\nif (${2:p} == NULL) {\n\t${4:return NULL;}\n}\n$0' },
  { label: 'struct', detail: 'typedef struct', body: 'typedef struct ${1:Name} {\n\t$0\n} ${1:Name};' },
  { label: 'main', detail: 'main function', body: '#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n\t$0\n\treturn 0;\n}' },
  { label: 'printf', detail: 'printf with newline', body: 'printf("${1:%d}\\n", ${2:value});' },
  { label: 'list-walk', detail: 'walk a linked list', body: 'for (struct ListNode *${1:p} = ${2:head}; ${1:p} != NULL; ${1:p} = ${1:p}->next) {\n\t$0\n}' },
  { label: 'free-list', detail: 'free every node of a list', body: 'while (${1:head} != NULL) {\n\tstruct ListNode *next = ${1:head}->next;\n\tfree(${1:head});\n\t${1:head} = next;\n}' },
];

function snippetFor(name, sig) {
  const inside = /\((.*)\)/.exec(sig);
  if (!inside || inside[1] === 'void') return `${name}()`;
  const params = inside[1].split(',').map((p, i) => {
    const words = p.trim().replace(/[*\[\]]/g, ' ').split(/\s+/).filter(Boolean);
    const arg = p.trim() === '...' ? '...' : words[words.length - 1] || `arg${i}`;
    return `\${${i + 1}:${arg}}`;
  });
  return `${name}(${params.join(', ')})`;
}

export function completionItems(monaco, range) {
  const K = monaco.languages.CompletionItemKind;
  const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const items = [];
  for (const [name, d] of Object.entries(CDOCS)) {
    items.push({
      label: name, kind: K.Function, detail: d.sig, range, insertText: snippetFor(name, d.sig), insertTextRules: R,
      documentation: { value: `${d.doc}${d.mem ? `\n\n**Memory:** ${d.mem}` : ''}\n\n\`#include <${d.h}>\`` },
    });
  }
  for (const w of C_WORDS) items.push({ label: w, kind: K.Keyword, insertText: w, range });
  for (const s of SNIPPETS) {
    items.push({ label: s.label, kind: K.Snippet, detail: s.detail, insertText: s.body, insertTextRules: R, range, sortText: `~${s.label}` });
  }
  return items;
}

export function hoverFor(word) {
  const d = CDOCS[word];
  if (d) {
    return [
      { value: `\`\`\`c\n${d.sig}\n\`\`\`` },
      { value: `${d.doc}${d.mem ? `\n\n**Memory:** ${d.mem}` : ''}\n\n*#include <${d.h}>*` },
    ];
  }
  if (KEYWORDS[word]) return [{ value: `**${word}**: ${KEYWORDS[word]}` }];
  return null;
}
