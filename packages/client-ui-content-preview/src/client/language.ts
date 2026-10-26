/**
 * Path classification for the shared content pane: the prism language hint for
 * a path's extension (so the content view's official CodeBlock highlights
 * instead of rendering plain text), plus the markdown / HTML predicates the
 * pane dispatches on and the basename/dirname helpers its header needs. Pure
 * string functions — no locale, no host state.
 */

/** The prism language name by file extension. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.jsonc': 'json', '.md': 'markdown', '.mdx': 'markdown',
  '.yml': 'yaml', '.yaml': 'yaml', '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less', '.sh': 'bash', '.bash': 'bash',
  '.py': 'python', '.sql': 'sql', '.xml': 'xml', '.toml': 'toml', '.ini': 'ini',
  '.go': 'go', '.rs': 'rust', '.java': 'java', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
  '.kotlin': 'kotlin', '.vue': 'vue', '.svelte': 'svelte', '.dockerfile': 'docker',
  '.graphql': 'graphql', '.proto': 'protobuf', '.diff': 'diff', '.patch': 'diff',
}

/**
 * The prism language name for a path's extension, or undefined for
 * auto-detection (unknown extensions fall back to plain text).
 * @param path - repo-relative file path.
 * @returns the language hint, or undefined.
 */
export function languageFor(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return LANGUAGE_BY_EXTENSION[path.slice(dot).toLowerCase()]
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])

/**
 * Whether a path is a Markdown file, which the detail pane renders as a
 * rendered preview (MarkdownText) instead of a raw code block.
 * @param path - repo-relative or absolute file path.
 * @returns true for .md/.markdown/.mdx files.
 */
export function isMarkdown(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return MARKDOWN_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** The file's basename (after the last path separator). A trailing separator
 * (e.g. '/a/b/') is ignored so the last real segment is returned; the bare
 * root ('/') yields ''. */
export function basenameOf(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return slash < 0 ? trimmed : trimmed.slice(slash + 1)
}

/** The file's dirname (everything before the basename). */
export function dirnameOf(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return slash < 0 ? '' : trimmed.slice(0, slash)
}

const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])

/** Whether a path is an HTML file, which the detail pane renders in a
 * sandboxed iframe (source ⇄ render) rather than a raw code block. */
export function isHtmlFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return HTML_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Alias of {@link isHtmlFile} matching the file-preview pane's naming. */
export function isHtmlPath(path: string): boolean {
  return isHtmlFile(path)
}
