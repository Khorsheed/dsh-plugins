/** Wire payload vocabulary of the file-preview Remote service. @module @khorsheed/dsh-file-preview/types */

/** The model-facing operation recorded on a file. */
export type FilePreviewOp = 'read' | 'write' | 'edit'

/** One file the session read, wrote, or edited, with the location of its last occurrence. */
export interface FilePreviewEntry {
  /** Display path exactly as the tool call recorded it (relative to the session cwd when it was). */
  readonly path: string
  /** The last recorded operation. */
  readonly op: FilePreviewOp
  /** Seq of the last `tool/call` event recorded for this path. */
  readonly seq: number
  /** Turn of the last occurrence. */
  readonly turn: number
  /** Step of the last occurrence. */
  readonly step: number
  /** Each write/edit change's diff, captured from the tool results' presentation meta, in event order. */
  readonly diffs: readonly FilePreviewDiff[]
  /** The last write/edit change's diff (the final `diffs` entry, for callers that want just the latest). */
  readonly lastDiff?: { readonly oldText: string | null; readonly newText: string } | undefined
}

/** One write/edit change of a file, in event order, with where it happened. */
export interface FilePreviewDiff {
  /** Seq of the `tool/result` event whose meta carried this diff. */
  readonly seq: number
  /** Turn of the change. */
  readonly turn: number
  /** Step of the change. */
  readonly step: number
  /** Prior content, or null for a new file / an overwrite. */
  readonly oldText: string | null
  /** Content after the change. */
  readonly newText: string
}

/** Whole-list response of `filePreview.list`. */
export interface FilePreviewList {
  /** Files in first-seen order, deduplicated by display path. */
  readonly entries: readonly FilePreviewEntry[]
  /** Seq of the last scanned session event (`-1` for an empty log). */
  readonly asOfSeq: number
  /** Whether the list was capped at the service's `maxFiles` limit. */
  readonly truncated: boolean
}

/** Read outcome classification of `filePreview.read`. */
export type FilePreviewReadKind = 'text' | 'image' | 'binary' | 'missing' | 'too-large' | 'error'

/** One `filePreview.read` response; exactly one of the content arms is populated. */
export interface FilePreviewRead {
  /** The resolved display path of the read target. */
  readonly path: string
  /** Outcome classification; `text`/`image` carry a renderable value, `error` carries message. */
  readonly kind: FilePreviewReadKind
  /** Current text content for `text` reads, capped by the service's `maxReadBytes`
   * (HTML files by `htmlMaxReadBytes`). */
  readonly content?: string
  /** Browser-loadable URL for `image` reads (host-served bytes, session-scoped). */
  readonly url?: string
  /** Whether `content` was truncated to the byte cap. */
  readonly truncated?: boolean
  /** HTML files only: best-effort hint that the document contains scripts
   * (`<script>` tags, inline event handlers, or `javascript:` URLs). A hint
   * for default-mode selection and warning — never a trust decision; the
   * sandbox and CSP are the real boundary. Absent for non-HTML reads and for
   * HTML without script markers. */
  readonly htmlScripted?: boolean
  /** Byte size of the file when the backend reported one. */
  readonly size?: number
  /** Human-readable failure detail for `error` reads. */
  readonly message?: string
}

/** Service configuration, validated by schemastery and documented in the config catalog. */
export interface FilePreviewConfig {
  /** Byte cap for a single `read`; larger files answer `too-large` without reading. */
  readonly maxReadBytes?: number
  /** Byte cap for reading HTML/HTM files — the sandboxed render channel can
   * handle far larger documents than the code view, so HTML gets its own,
   * wider cap (default 4 MiB) while every other text read keeps
   * `maxReadBytes`. */
  readonly htmlMaxReadBytes?: number
  /** Cap on the number of entries `list` returns. */
  readonly maxFiles?: number
  /** Whether the bash-write collector watches sessions for files bash wrote
   * (heredocs, `>` redirects, `tee`, `sed -i`) and adds them to `list`. On by
   * default; disable to keep the list log-derived only. */
  readonly captureBashWrites?: boolean
}

/** Outcome of a `filePreview.reveal` call (the "show in folder" gesture). */
export type FilePreviewReveal =
  | {
    /** The host file manager opened the file's folder with the file selected. */
    readonly revealed: true
  }
  | {
    /** The file could not be revealed; the caller opens the parent folder instead. */
    readonly revealed: false
    /** Why: `missing` = the recorded path does not resolve to an existing target; `select-failed` = the host could not select the file. */
    readonly reason: 'missing' | 'select-failed'
  }

/** One file's mutation facts within one turn — the turn card's vocabulary. */
export interface FilePreviewTurnFile {
  /** The display path (absolute for bash-captured writes; as-recorded otherwise). */
  readonly path: string
  /** Seq of the first mutation recorded for this path in this turn (stable ordering). */
  readonly seq: number
  readonly step: number
  /** Lines added across the turn's mutations of this path. */
  readonly added?: number
  /** Lines removed; 0 for a create; absent when an uncounted mutation (a write
   *  whose prior content was not diffable, a PTC dispatch) reported no
   *  total. */
  readonly removed?: number
}

/** One turn's file-mutation group for the turn-tail card. */
export interface FilePreviewTurnGroup {
  readonly turn: number
  readonly files: readonly FilePreviewTurnFile[]
}

/** Whole-response of `filePreview.turnFiles`: every turn's mutation groups. */
export interface FilePreviewTurnMap {
  /** Files mutated per turn, in event order within each turn. */
  readonly turns: readonly FilePreviewTurnGroup[]
  /** Seq of the last scanned session event (cache invalidation watermark). */
  readonly asOfSeq: number
}
