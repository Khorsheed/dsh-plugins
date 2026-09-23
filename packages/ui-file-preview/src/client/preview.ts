/**
 * The ui-file-preview adaptation layer onto the shared content pane.
 *
 * This plugin renders the session's products; the pane itself is the kernel's.
 * Everything that is specific to THIS surface lives here: the mapping from the
 * `filePreview` wire kind union into the kernel's `PreviewRead`, the translator
 * over this plugin's dictionary, the structured-render chrome, and the IDE
 * choices the kernel's split control lists. Retiring the kernel is an edit to
 * this file plus the import in FilePreviewTab.
 *
 * @module @khorsheed/dsh-client-ui-file-preview
 */
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PreviewRead, PreviewTranslator, StructuredLabels,
} from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type { FilePreviewRead } from '@khorsheed/dsh-file-preview/types'

/**
 * Map one file-preview read onto the kernel's contract.
 *
 * The wire type carries `path` plus optional per-kind fields (like the
 * local-files one), so the arms are spelled out rather than cast: an image read
 * with no URL becomes `missing`/`unreadable` instead of an `<img>` with no
 * source.
 * @param read - the host's read result.
 * @returns the kernel's normalized read.
 */
export function toPreviewRead(read: FilePreviewRead): PreviewRead {
  switch (read.kind) {
    case 'text':
      return {
        kind: 'text',
        path: read.path,
        content: read.content ?? '',
        ...(read.truncated === true ? { truncated: true } : {}),
        ...(read.htmlScripted === true ? { htmlScripted: true } : {}),
      }
    case 'image':
      return read.url === undefined
        ? { kind: 'missing', path: read.path, reason: 'unreadable' }
        : { kind: 'image', path: read.path, url: read.url, ...(read.size === undefined ? {} : { size: read.size }) }
    case 'binary':
      return { kind: 'binary', path: read.path, ...(read.size === undefined ? {} : { size: read.size }) }
    case 'too-large':
      return { kind: 'too-large', path: read.path, ...(read.size === undefined ? {} : { size: read.size }) }
    case 'missing':
      return { kind: 'missing', path: read.path }
    case 'error':
      return { kind: 'error', path: read.path, ...(read.message === undefined ? {} : { message: read.message }) }
  }
}

/**
 * The pane's translator over this plugin's `filePreview` dictionary.
 * @param t - the locale-bound translator for this plugin's namespace.
 * @returns the kernel's translator.
 */
export function previewTranslator(t: TranslateNS<'filePreview'>): PreviewTranslator {
  return (key, params) => t(key as never, params as never)
}

/** JsonTree chrome over this plugin's dictionary. */
function jsonTreeLabels(t: TranslateNS<'filePreview'>): JsonTreeLabels {
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

/** MarkdownText chrome over this plugin's dictionary. */
function markdownLabels(t: TranslateNS<'filePreview'>): MarkdownLabels {
  return {
    code: { copyLabel: t('action.copy'), copiedLabel: t('action.copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/**
 * The structured-render chrome for the kernel's JSON tree / CSV table / markdown.
 * @param t - the locale-bound translator for this plugin's namespace.
 * @returns the kernel's label object.
 */
export function structuredLabels(t: TranslateNS<'filePreview'>): StructuredLabels {
  return { json: jsonTreeLabels(t), markdown: markdownLabels(t) }
}
