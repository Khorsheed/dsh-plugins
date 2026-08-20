/**
 * The datasets tab's read-only preview: content rendering is delegated to the
 * official reader primitives — markdown files render through the official
 * `MarkdownText` pipeline (the same renderer the chat uses: headings, tables,
 * emphasis, links, math), everything else through the official `CodeBlock`
 * syntax highlighter. There is no self-rolled markdown renderer here; the tab
 * only navigates the tree and hands the selected file's content over.
 */

import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

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
  '.kotlin': 'kotlin', '.diff': 'diff', '.patch': 'diff',
}

/** The prism language name for a path's extension, or undefined for auto-detection. */
export function languageFor(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return LANGUAGE_BY_EXTENSION[path.slice(dot).toLowerCase()]
}

/**
 * One file's content through the official reading experience: markdown
 * renders as the document (MarkdownText), every other text file as
 * syntax-highlighted source (CodeBlock).
 * @param props - the layer-relative display path and the file content.
 */
export function DatasetPreview(props: { path: string; content: string }) {
  const { path, content } = props
  if (languageFor(path) === 'markdown') return <MarkdownText text={content} />
  return <CodeBlock code={content} lang={languageFor(path)} />
}
