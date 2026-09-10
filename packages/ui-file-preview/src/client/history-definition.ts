/**
 * The change-history document renderer's static identity: the implementation
 * id (registry + keyed seat share it) and the file suffixes it answers to.
 *
 * The registry matches by suffix only, with no wildcard — the list enumerates
 * the common text suffixes, wide rather than exhaustive (a suffix absent here
 * simply keeps its official renderer alone in the dropdown). Compound
 * suffixes (tar.gz) are deliberately avoided: at equal band the longer suffix
 * wins, and outranking an official renderer by length is a takeover this
 * package does not want.
 */

/** The change-history renderer's implementation id (registry + seat key). */
export const FILE_HISTORY_ID = '@khorsheed/dsh-client-ui-file-preview/history'

/** The text file suffixes the change-history renderer answers to. */
export const HISTORY_EXTENSIONS: readonly string[] = [
  'md', 'mdx', 'txt', 'log',
  'json', 'jsonc', 'jsonl', 'csv', 'tsv', 'xml', 'svg',
  'yaml', 'yml', 'toml', 'ini',
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'sh', 'bash', 'sql',
  'html', 'htm', 'css', 'scss', 'less',
  'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'rb', 'php', 'swift', 'kt',
  'vue', 'svelte', 'diff', 'patch',
]

/**
 * Suffixes the detail view's preview stack renders: the change-history text
 * set plus the image formats the pane's image arm serves. Everything else
 * (pdf, archives, binaries) stays with the official document tab — the tab
 * type's `canOpen` filters on this set before claiming an address.
 */
export const RENDERABLE_EXTENSIONS: readonly string[] = [
  ...HISTORY_EXTENSIONS,
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico',
]

const RENDERABLE = new Set(RENDERABLE_EXTENSIONS)

/**
 * Whether the detail view can render this path's content (suffix match,
 * case-insensitive, compound suffixes intentionally not special-cased).
 * @param path - any file path spelling.
 */
export function renderablePath(path: string): boolean {
  const base = path.replaceAll('\\', '/').toLowerCase()
  const name = base.slice(base.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 && RENDERABLE.has(name.slice(dot + 1))
}
