/**
 * The content pane's contract: the kind union a consuming surface adapts its
 * own Remote payload into, the translation keys the pane prints, and the props
 * it accepts.
 *
 * Two boundaries are deliberate. First, the kernel never imports a consumer's
 * wire types — each surface maps its own read result into {@link PreviewRead}
 * (`local-files` collapses its kind union directly; `worktrees` maps its
 * `ReadFileResult` / `LocalImageResult` and reports a deleted or unreadable
 * file through `missing.reason`). Second, the kernel owns no locale namespace:
 * it prints through {@link PreviewTranslator}, a loose `(key, params) => string`
 * adapter the consumer builds from its own typed `t` in one line, which keeps
 * both surfaces on their existing dictionaries without the kernel registering
 * anything.
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */
import type { ReactNode } from 'react'
import type { StructuredLabels } from './labels.ts'

/** Why a file has no readable content; the translator turns it into copy. */
export type MissingReason = 'noSelection' | 'deleted' | 'unreadable'

/** One loaded read, normalized across every consuming surface. */
export type PreviewRead =
  | {
    readonly kind: 'text'
    readonly path: string
    readonly content: string
    /** Host truncated the read at its cap; the pane shows the notice. */
    readonly truncated?: boolean
    /** Host detected `<script>` or an event attribute; enables the script tier. */
    readonly htmlScripted?: boolean
  }
  | { readonly kind: 'image'; readonly path: string; readonly url: string; readonly size?: number }
  | { readonly kind: 'binary'; readonly path: string; readonly size?: number }
  | { readonly kind: 'missing'; readonly path: string; readonly reason?: MissingReason }
  | { readonly kind: 'too-large'; readonly path: string; readonly size?: number }
  | { readonly kind: 'error'; readonly path: string; readonly message?: string }

/**
 * Every string the pane prints. Consumers register these keys in their OWN
 * locale namespace and translate them; a package-level test asserts the set
 * resolves in the consumer's dictionary, so a missing key is a test failure
 * rather than an English string in a Chinese UI.
 */
export type PreviewKey =
  | 'action.copyPath'
  | 'action.copied'
  | 'action.showInFolder'
  | 'action.openIDE'
  | 'action.chooseIDE'
  | 'action.reload'
  | 'action.more'
  | 'detail.noSelection'
  | 'detail.back'
  | 'detail.diff'
  | 'detail.content'
  | 'detail.preview'
  | 'detail.source'
  | 'detail.views'
  | 'detail.deleted'
  | 'search.placeholder'
  | 'search.noMatch'
  | 'search.hit'
  | 'search.prev'
  | 'search.next'
  | 'preview.htmlToggle'
  | 'preview.htmlSource'
  | 'preview.htmlRender'
  | 'preview.htmlScript'
  | 'preview.htmlScriptStop'
  | 'preview.staticHint'
  | 'preview.scriptConfirm'
  | 'preview.scriptRun'
  | 'preview.scriptCancel'
  | 'preview.slowHint'
  | 'preview.fullscreen'
  | 'preview.exitFullscreen'
  | 'local.binary'
  | 'local.tooLarge'
  | 'local.noSelection'
  | 'local.unreadable'
  | 'state.loading'
  | 'state.error'
  | 'action.edit'
  | 'edit.label'
  | 'edit.editing'
  | 'edit.dirty'
  | 'edit.save'
  | 'edit.saving'
  | 'edit.discard'
  | 'edit.discardConfirm'
  | 'edit.keepEditing'
  | 'edit.conflict'
  | 'edit.overwrite'
  | 'edit.takeTheirs'
  | 'edit.unsupported'
  | 'edit.missing'
  | 'edit.failed'
  | 'media.imageFailed'

/** The key list above, materialized so consumers can test their dictionary. */
export const PREVIEW_KEYS: readonly PreviewKey[] = [
  'action.copyPath',
  'action.copied',
  'action.showInFolder',
  'action.openIDE',
  'action.chooseIDE',
  'action.reload',
  'action.more',
  'detail.noSelection',
  'detail.back',
  'detail.diff',
  'detail.content',
  'detail.preview',
  'detail.source',
  'detail.views',
  'detail.deleted',
  'search.placeholder',
  'search.noMatch',
  'search.hit',
  'search.prev',
  'search.next',
  'preview.htmlToggle',
  'preview.htmlSource',
  'preview.htmlRender',
  'preview.htmlScript',
  'preview.htmlScriptStop',
  'preview.staticHint',
  'preview.scriptConfirm',
  'preview.scriptRun',
  'preview.scriptCancel',
  'preview.slowHint',
  'preview.fullscreen',
  'preview.exitFullscreen',
  'local.binary',
  'local.tooLarge',
  'local.noSelection',
  'local.unreadable',
  'state.loading',
  'state.error',
  'action.edit',
  'edit.label',
  'edit.editing',
  'edit.dirty',
  'edit.save',
  'edit.saving',
  'edit.discard',
  'edit.discardConfirm',
  'edit.keepEditing',
  'edit.conflict',
  'edit.overwrite',
  'edit.takeTheirs',
  'edit.unsupported',
  'edit.missing',
  'edit.failed',
  'media.imageFailed',
]

/**
 * Translate one preview key through the consumer's own dictionary. The kernel
 * holds no namespace, so the consumer adapts its typed `t` once
 * (`(key, params) => t(key as never, params as never)`) and passes the result.
 * @param key - one of {@link PreviewKey}.
 * @param params - interpolation values (`search.hit`, `state.error`).
 * @returns the localized string.
 */
export type PreviewTranslator = (
  key: PreviewKey,
  params?: Readonly<Record<string, string | number>>,
) => string

/**
 * The per-file HOST-OPEN gestures, each optional so a caller can expose a
 * subset. The copy-path gesture is not here: it carries acceptance semantics,
 * so it lives in {@link ContentPaneProps.onCopyPath} (the pane renders the
 * button only when that callback exists).
 */
export interface PreviewChrome {
  /** Open the file's PARENT DIRECTORY in the host file manager. */
  readonly openFolder?: (() => void) | undefined
  /** Open the file in the host editor/IDE. */
  readonly openIDE?: (() => void) | undefined
  /**
   * When more than one IDE resolved, the pane renders a split control: the
   * button opens the current choice, the caret lists these. One choice (or
   * none) keeps the plain single button, so a surface that only ever picks one
   * app renders exactly what it did before.
   */
  readonly ideChoices?: readonly IdeChoice[] | undefined
  /** Open the file with the chosen IDE (the split control's menu). */
  readonly onIdeChoice?: ((id: string) => void) | undefined
}

/** One probed IDE the split control can offer. */
export interface IdeChoice {
  readonly id: string
  /** Display name (the host app's own label — data, not a translated string). */
  readonly label: string
}

/** The content pane's view selector when a caller supplies a diff body. */
export type PreviewView = 'diff' | 'content'

/** Props of the shared content pane. */
/**
 * One save attempt's answer. `conflict` means the file on disk no longer
 * matches the content the edit started from (the model or another program
 * wrote it meanwhile); `unsupported` means the file cannot round-trip through
 * a text edit (not UTF-8, grew past the read cap); `missing` means it is gone.
 */
export type SaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'conflict' | 'unsupported' | 'missing' | 'error'; readonly message?: string | undefined }

/** What the pane hands the caller's save. */
export interface SaveRequest {
  /** The full new text, line endings restored to the file's own convention. */
  readonly content: string
  /** The text the edit started from (the read's content), or null to
   * overwrite whatever is on disk — the conflict bar's "overwrite" gesture. */
  readonly base: string | null
}

export interface ContentPaneProps {
  /** The selected file's path ('' renders the empty placeholder). */
  readonly path: string
  /** The normalized read, or null until a fetch lands. */
  readonly read: PreviewRead | null
  /** Whether a fetch is in flight. */
  readonly loading: boolean
  /** Human-readable fetch failure, or null. */
  readonly error: string | null
  /** Namespaces the scroll-memory cache; sessions never share an offset. */
  readonly sessionId?: string | undefined
  /** The absolute path shown in the header (falls back to `path`). */
  readonly displayPath?: string | undefined
  /** Host-open gestures; each renders only when supplied. */
  readonly chrome?: PreviewChrome | undefined
  /** Locale chrome for the structured renderers (JsonTree / MarkdownText). */
  readonly labels: StructuredLabels
  /** Locale adapter over the consumer's own dictionary. */
  readonly t: PreviewTranslator
  /** Called when the copy-path gesture is accepted (the caller owns the clipboard). */
  readonly onCopyPath?: (() => Promise<boolean>) | undefined
  /**
   * Re-reads the current file through the caller's own Remote and resolves once
   * the fresh read is applied. Renders the reload button FIRST in the title
   * actions; while the returned promise is pending the button is disabled and
   * its icon spins. A surface whose read cannot go stale (a file pinned at a
   * commit) simply omits it, and no button renders.
   */
  readonly onReload?: (() => Promise<void>) | undefined
  /**
   * Writes an edited text file through the caller's own Remote. Supplying it
   * makes complete (non-truncated) text reads editable: the header gains an
   * edit action, the source face becomes a textarea, and the rendered face
   * shows the draft. On `ok` the caller re-reads the file BEFORE resolving, so
   * the pane leaves edit mode onto the saved content. Surfaces whose reads
   * are pinned (a commit) or off-host browsers simply omit it.
   */
  readonly onSave?: ((request: SaveRequest) => Promise<SaveOutcome>) | undefined
  /**
   * Loads one local image a markdown document names (`![](docs/shot.png)`,
   * `<img src="./a.png">`), given its path resolved against the document's
   * directory in this surface's own path space. Resolves a displayable URL
   * (data:, blob:, or a route on this origin), or undefined — the image then
   * stays its alt text. Omitted: local images stay alt text.
   */
  readonly resolveImage?: ((path: string) => Promise<string | undefined>) | undefined
  /**
   * Opens one local file a markdown link names (`[English](README.en.md)`),
   * resolved like {@link resolveImage}. Omitted: such links stay plain text.
   */
  readonly onOpenFile?: ((path: string, options?: { line?: number }) => void) | undefined
  /** Renders the back control when supplied (leaving a nested file view). */
  readonly onBack?: (() => void) | undefined
  /** The diff body, when this surface has one; enables the diff/content toggle. */
  readonly diffView?: ReactNode
  /** The active view when `diffView` is supplied (caller-owned state). */
  readonly view?: PreviewView
  /** Called when the caller should switch view (required to show the toggle). */
  readonly onViewChange?: ((view: PreviewView) => void) | undefined
  /**
   * Replaces the kernel's plain `<img>` body for `image` reads when supplied —
   * the worktrees surface uses it for its zoom/lightbox viewer. The kernel's
   * own rendering stays the default so a caller without one needs nothing.
   */
  readonly imageView?: ReactNode
  /**
   * Extra chrome rendered above the body but OUTSIDE the read's own rendering —
   * the worktrees surface uses it for its untracked-file note, so the kernel
   * never has to learn what a git status is.
   */
  readonly notice?: ReactNode
  /** When true the pane sits inside an already-padded container. */
  readonly embedded?: boolean
}
