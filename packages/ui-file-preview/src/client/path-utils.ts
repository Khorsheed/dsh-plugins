/** Pure path display helpers for the file-preview tab. */

import { isAbsoluteWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { FilePreviewEntry } from '@khorsheed/dsh-file-preview/types'

/** The last path segment; the path itself when it has no separator. */
export function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? path : path.slice(slash + 1)
}

/** Everything before the last path separator ('' when the path has none). */
export function parentPath(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash <= 0 ? '' : path.slice(0, slash)
}

/**
 * Sort touched files by their last recorded activity, newest first. The fold
 * keeps first-seen order; the view presents latest-first so the agent's most
 * recent work is at the top.
 * @param entries - the fold's first-seen entries.
 * @returns a new array sorted by descending last-occurrence seq.
 */
export function sortByLatest(entries: readonly FilePreviewEntry[]): FilePreviewEntry[] {
  return [...entries].sort((a, b) => b.seq - a.seq)
}

/**
 * Case-insensitive substring match of a search query against a file's display
 * path (the whole path, so a directory name matches too). Empty and
 * whitespace-only queries match nothing deliberately — the view treats them as
 * "no search" and shows the unfiltered list.
 * @param path - the entry's display path.
 * @param query - the trimmed search term.
 * @returns whether the path contains the query, ignoring case.
 */
export function matchesQuery(path: string, query: string): boolean {
  if (query.length === 0) return false
  return path.toLowerCase().includes(query.toLowerCase())
}

/**
 * Split a file name into [before, match, after] for the first case-insensitive
 * occurrence of `query`, so the view can highlight the matched substring.
 * @param name - the display name to search.
 * @param query - the trimmed search term.
 * @returns the three parts, or null when the name does not contain the query.
 */
export function highlightMatch(name: string, query: string): readonly [string, string, string] | null {
  if (query.length === 0) return null
  const at = name.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return null
  return [name.slice(0, at), name.slice(at, at + query.length), name.slice(at + query.length)]
}

/** Strip a workspace root prefix for compact display; the path stands when unrelated. */
export function relativeToCwd(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd.length === 0) return path
  if (path === cwd) return basename(path)
  const rooted = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(rooted) ? path.slice(rooted.length) : path
}

/**
 * Whether the official document tab can render this path: the `file` resource
 * is workspace-scoped (the host answers outside-workspace stats with
 * `workspace-file/outside-workspace`), so only workspace-rooted paths get a
 * `dsh-resource://file/...` open. Relative paths qualify (the host resolves
 * them against the session root); an absolute path qualifies when the session
 * cwd is known and contains it, or when the cwd is unknown — the host's own
 * failure line is the honest answer there.
 * @param cwd - the session's workspace root, when known.
 * @param path - the recorded display path (absolute or workspace-relative).
 * @returns whether `openResource` stands a chance of rendering the file.
 */
export function isWithinWorkspace(cwd: string | undefined, path: string): boolean {
  if (!isAbsoluteWorkspacePath(path)) return true
  if (cwd === undefined || cwd.length === 0) return true
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const target = path.replace(/\\/g, '/')
  return target === root || target.startsWith(`${root}/`)
}

/** Whether a path names an HTML document (`.html`/`.htm`), offered a
 * sandboxed render view alongside the source view. */
export function isHtmlPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  const ext = path.slice(dot).toLowerCase()
  return ext === '.html' || ext === '.htm'
}

/** Map a file extension to a prism language name for CodeBlock, or undefined to auto-detect. */
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

/** The prism language name for a path's extension, or undefined for auto-detection. */
export function languageFor(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return LANGUAGE_BY_EXTENSION[path.slice(dot).toLowerCase()]
}
