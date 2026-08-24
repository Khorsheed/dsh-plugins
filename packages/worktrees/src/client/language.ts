/**
 * Prism language hint for a repo-relative path's extension, so the content
 * view's official CodeBlock renders with syntax highlighting instead of
 * plain text. The mapping mirrors ui-file-preview's path-utils (this plugin
 * stays dependency-free, so the map is copied).
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
