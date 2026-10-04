/**
 * The chapter reader's adaptation layer onto the shared content pane
 * (ui-content-preview): the manuscript read folded into the kernel's
 * `PreviewRead`, the translator over this plugin's dictionary, and the
 * structured-render chrome. Everything the kernel needs that is specific to
 * THIS plugin lives here (the local-files precedent).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PreviewRead, PreviewTranslator, StructuredLabels,
} from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type {} from './locales.ts'

/**
 * Map a chapter manuscript read onto the kernel's contract.
 * @param path - the manuscript's absolute path (display + scroll namespace).
 * @param body - the chapter text ('' renders as missing, not an empty document).
 * @returns the kernel's normalized read.
 */
export function chapterPreviewRead(path: string, body: string | undefined): PreviewRead {
  if (body === undefined || body === '') return { kind: 'missing', path, reason: 'deleted' }
  return { kind: 'text', path, content: body }
}

/**
 * The pane's translator over this plugin's `story` dictionary. The cast is the
 * single place the kernel's namespace-free key set meets this plugin's typed
 * one; the spec's PREVIEW_KEYS pass keeps the two honest.
 * @param t - the locale-bound translator for this plugin's namespace.
 * @returns the kernel's translator.
 */
export function previewTranslator(t: TranslateNS<'story'>): PreviewTranslator {
  return (key, params) => t(key as never, params as never)
}

/** JsonTree chrome over this plugin's dictionary. */
function jsonTreeLabels(t: TranslateNS<'story'>): JsonTreeLabels {
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
function markdownLabels(t: TranslateNS<'story'>): MarkdownLabels {
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
export function structuredLabels(t: TranslateNS<'story'>): StructuredLabels {
  return { json: jsonTreeLabels(t), markdown: markdownLabels(t) }
}
