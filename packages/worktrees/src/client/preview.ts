/**
 * The worktrees adaptation layer onto the shared content pane.
 *
 * Worktrees keeps what is genuinely its own — the git status, the diff bodies,
 * the commit list — and hands the kernel a normalized read plus the chrome
 * callbacks. Repo-relative paths are resolved against the worktree root here,
 * because every per-file gesture the host exposes takes an absolute path.
 *
 * @module @khorsheed/dsh-worktrees
 */
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PreviewRead, PreviewTranslator, StructuredLabels,
} from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type { ChangedFile, LocalImageResult, ReadFileResult } from '../types.ts'

/** Whether a changed file was deleted in its segment. */
export function isDeleted(file: ChangedFile | undefined): boolean {
  return file?.status === 'D'
}

/** One selection's raw read inputs, as the tab's store holds them. */
export interface WorktreeReadInputs {
  /** The repo-relative selected path. */
  readonly path: string
  /** The file has no content any more (deleted in its segment). */
  readonly deleted: boolean
  /** The file is untracked — no diff, and the content IS the change. */
  readonly untracked: boolean
  /** A fetch failure for this selection, or null. */
  readonly error: string | null
  /** The fetched text content, or null. */
  readonly content: ReadFileResult | null
  /** The fetched inline image, or null. */
  readonly image: LocalImageResult | null | undefined
}

/**
 * Map worktrees' read inputs onto the kernel's contract.
 *
 * A deleted file reports `missing/deleted` (the pane prints the deleted copy),
 * an inline image wins over text, and an unmet selection resolves to null so
 * the pane's loading placeholder shows while the fetch is in flight — the
 * untracked case carries its own note through the pane's `notice` prop instead
 * of a distinct placeholder.
 * @param inputs - the selection's raw read inputs.
 * @returns the kernel's normalized read, or null before a fetch lands.
 */
export function toPreviewRead(inputs: WorktreeReadInputs): PreviewRead | null {
  if (inputs.deleted) return { kind: 'missing', path: inputs.path, reason: 'deleted' }
  if (inputs.image !== null && inputs.image !== undefined) {
    return { kind: 'image', path: inputs.path, url: inputs.image.dataUrl }
  }
  if (inputs.error !== null) return { kind: 'error', path: inputs.path, message: inputs.error }
  if (inputs.content === null) return null
  return {
    kind: 'text',
    path: inputs.path,
    content: inputs.content.content,
    ...(inputs.content.htmlScripted === true ? { htmlScripted: true } : {}),
  }
}

/**
 * Resolve a repo-relative path against the worktree root — every host-open
 * gesture takes an absolute path, and the host route accepts directories, so
 * callers pass the resolved parent directory.
 * @param root - the worktree's absolute root ('' when the summary has not landed).
 * @param path - the repo-relative path.
 * @returns the absolute path.
 */
export function absolutePath(root: string, path: string): string {
  if (root === '') return path
  return `${root.replace(/\/+$/, '')}/${path}`
}

/** The pane's translator over this plugin's `worktrees` dictionary. */
export function previewTranslator(t: TranslateNS<'worktrees'>): PreviewTranslator {
  return (key, params) => t(key as never, params as never)
}

/** JsonTree chrome over this plugin's dictionary. */
function jsonTreeLabels(t: TranslateNS<'worktrees'>): JsonTreeLabels {
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
function markdownLabels(t: TranslateNS<'worktrees'>): MarkdownLabels {
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
export function structuredLabels(t: TranslateNS<'worktrees'>): StructuredLabels {
  return { json: jsonTreeLabels(t), markdown: markdownLabels(t) }
}
