/**
 * The local-files adaptation layer onto the shared content pane.
 *
 * Everything the kernel needs that is specific to THIS plugin lives here and
 * nowhere else: the mapping from the `localFiles` wire kind union into the
 * kernel's `PreviewRead`, the translator over this plugin's dictionary, and the
 * structured-render chrome. Swapping the pane implementation, or retiring it
 * once the host exposes a reusable renderer, is a change to this file plus the
 * import in WorkspaceView — nothing else in the plugin knows the pane's shape.
 *
 * @module @khorsheed/dsh-local-files
 */
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PreviewRead, PreviewTranslator, StructuredLabels,
} from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type { LocalFilesRead } from '../types.ts'

/**
 * Map one local-files read onto the kernel's contract.
 *
 * The wire type carries `path` plus optional per-kind fields, so the arms are
 * spelled out rather than cast: an image read with no URL (the host refuses to
 * inline an oversized or unreadable image) becomes `missing`/`unreadable`
 * instead of rendering an `<img>` with no source.
 * @param read - the plugin's read result, or null before a fetch lands.
 * @returns the kernel's normalized read.
 */
export function toPreviewRead(read: LocalFilesRead | null): PreviewRead | null {
  if (read === null) return null
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
 * The pane's translator over this plugin's `localFiles` dictionary. The cast is
 * the single place the kernel's namespace-free key set meets this plugin's
 * typed one; `previewKeysFor` in the test suite keeps the two honest.
 * @param t - the locale-bound translator for this plugin's namespace.
 * @returns the kernel's translator.
 */
export function previewTranslator(t: TranslateNS<'localFiles'>): PreviewTranslator {
  return (key, params) => t(key as never, params as never)
}

/** JsonTree chrome over this plugin's dictionary. */
function jsonTreeLabels(t: TranslateNS<'localFiles'>): JsonTreeLabels {
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
function markdownLabels(t: TranslateNS<'localFiles'>): MarkdownLabels {
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
export function structuredLabels(t: TranslateNS<'localFiles'>): StructuredLabels {
  return { json: jsonTreeLabels(t), markdown: markdownLabels(t) }
}
