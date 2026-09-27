/**
 * The datasets tab's read-only preview: content rendering is delegated to the
 * official reader primitives, replicating the products tab's scheme over them
 * (that tab's pane is the community file-preview package's private
 * assembly — cross-plugin imports are forbidden, so this file re-assembles
 * the same visual family from the same official parts). Markdown renders
 * through the official `MarkdownText` pipeline (the chat's renderer), JSON
 * through the official `JsonTree` inspector (the RPC payload panel's tree),
 * everything else through the official `CodeBlock` syntax highlighter.
 * Document forms (markdown/JSON) sit in the same block chrome the official
 * code/diff blocks use — a rounded surface with a small format banner — so
 * every preview reads as one family. There is no self-rolled renderer here.
 */

import type { ReactNode } from 'react'
import { CodeBlock, JsonTree, MarkdownText, type JsonTreeLabels, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './preview.module.css'

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

/** JSON tree cap: beyond this many source chars the parsed tree is too heavy; keep the code view. */
const JSON_TREE_MAX_CHARS = 150_000

/** Localized JsonTree labels over this plugin's `datasets` namespace. */
function jsonTreeLabels(t: TranslateNS<'datasets'>): JsonTreeLabels {
  return {
    copyValue: t('json.copyValue'),
    copyJson: t('json.copyJson'),
    copyPath: t('json.copyPath'),
    copyPrettyJson: t('json.copyPrettyJson'),
    copyCompactJson: t('json.copyCompactJson'),
    copied: t('json.copied'),
    copyFailed: t('json.copyFailed'),
    collapseNode: t('json.collapseNode'),
    expandNode: t('json.expandNode'),
    copyButtonTitle: action => t('json.copyButtonTitle', { action }),
  }
}

/** Localized MarkdownText chrome copy over this plugin's `datasets` namespace. */
function markdownLabels(t: TranslateNS<'datasets'>): MarkdownLabels {
  return {
    code: { copyLabel: t('preview.copy'), copiedLabel: t('preview.copied') },
    footnotes: t('preview.footnotes'),
  }
}

/**
 * Parse one text read as JSON for the tree preview. Only plain objects and
 * arrays within the size cap qualify; scalars and any parse failure —
 * including `.jsonc` comment syntax — fall back to the code view.
 */
function jsonTreeData(content: string): object | unknown[] | null {
  if (content.length > JSON_TREE_MAX_CHARS) return null
  try {
    const value: unknown = JSON.parse(content)
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * One file's content through the official reading experience. Structured
 * document forms first (JSON tree, rendered markdown), wrapped in the block
 * chrome; every other text file is a syntax-highlighted CodeBlock, which
 * carries its own chrome.
 * @param props - the layer-relative display path, the file content, and the locale seat.
 */
export function DatasetPreview(props: { path: string; content: string; t: TranslateNS<'datasets'> }) {
  const { path, content, t } = props
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot).toLowerCase()
  const lang = languageFor(path)
  let documentBody: ReactNode | null = null
  if (ext === '.json' || ext === '.jsonc') {
    const data = jsonTreeData(content)
    if (data !== null) documentBody = <JsonTree data={data} label={t('preview.treeLabel')} labels={jsonTreeLabels(t)} />
  } else if (lang === 'markdown') {
    documentBody = <MarkdownText text={content} labels={markdownLabels(t)} />
  }
  if (documentBody === null) return <CodeBlock code={content} lang={lang} copyLabel={t('preview.copy')} copiedLabel={t('preview.copied')} />
  return (
    <div className={css.structured}>
      <div className={css.structuredBanner}>
        <span className={css.structuredInfo}>{lang ?? ext.slice(1)}</span>
      </div>
      <div className={css.structuredBody}>{documentBody}</div>
    </div>
  )
}
