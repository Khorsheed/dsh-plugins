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
