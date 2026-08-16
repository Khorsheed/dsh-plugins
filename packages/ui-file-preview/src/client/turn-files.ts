/**
 * Turn-scoped mutated-file Definition for the file-preview turn card. The
 * vocabulary is the write/edit tools' `file_path` argument plus the diff call
 * view's per-file line deltas — the same sources the host fold and the
 * official deliverables row use — so a turn's card lists every file the agent
 * created or modified that turn, whether or not the closing prose named it.
 * Client-only and model-free.
 */
import type {
  ConversationNodeDefinition, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-deliverables' ConversationTurnDataMap merge (the
// 'deliverables' key selectTurnFiles reads). A value import would trip the
// client bundle purity gate — cross-plugin value imports are forbidden.
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'

/** Tool names whose calls mutate a file (reads leave no card entry). */
const MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set(['write', 'edit'])

/** The argument key carrying the mutated path (shared by the file tools). */
const FILE_PATH_ARGUMENT = 'file_path'

/** One mutated path, where it happened, and its turn-summed line deltas. */
export interface TurnFilePath {
  readonly seq: number
  readonly path: string
  /** Lines added across the turn's mutations of this path (always known from the diff's newText). */
  readonly added: number | undefined
  /** Lines removed; unknown when any mutation reported no prior content (create/overwrite). */
  readonly removed: number | undefined
}

/** Immutable mutated-file facts published against one Turn. */
export interface TurnFilesData {
  readonly files: readonly TurnFilePath[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** File paths the write/edit tools mutated in this Turn, with line deltas. */
    filePreviewMutations: TurnFilesData
  }
}

interface TurnFilesState extends TurnFilesData {
  readonly turn: number
}

/**
 * Extract the mutated path from one tool call's raw arguments JSON.
 * @param name - the tool name.
 * @param argumentsJson - the raw arguments payload.
 * @returns the mutated display path, or undefined when the call is not a mutation tool.
 */
export function pathFromToolCall(name: string, argumentsJson: string): string | undefined {
  if (!MUTATION_TOOL_NAMES.has(name)) return undefined
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (parsed !== null && typeof parsed === 'object') {
      const candidate = (parsed as Record<string, unknown>)[FILE_PATH_ARGUMENT]
      if (typeof candidate === 'string' && candidate.length > 0) return candidate
    }
  } catch {
    // Model arguments are expected JSON; a malformed payload contributes nothing.
  }
  return undefined
}

/** Lines in one diff text: a trailing newline terminates the last line rather than adding one. */
function lineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n').length
  return text.endsWith('\n') ? lines - 1 : lines
}

/** Sum two optional counts; unknown wins (a turn with any uncounted mutation reports no total). */
function sumKnown(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined || b === undefined ? undefined : a + b
}

/**
 * Per-call line deltas for one path from its diff call view. `added` is
 * always derivable from newText; `removed` needs oldText, which a create or
 * overwrite does not carry.
 * @param view - the tool/call presentation view (any card kind).
 * @param path - the call's mutated path.
 * @returns the call's line deltas for the path; both undefined without a diff card.
 */
function diffDeltas(
  view: ToolResultNode['callView'],
  path: string,
): { added: number | undefined; removed: number | undefined } {
  if (view?.card !== 'diff') return { added: undefined, removed: undefined }
  const diffs = view.diffs.filter(diff => diff.path === path)
  if (diffs.length === 0) return { added: undefined, removed: undefined }
  let added = 0
  let removed: number | undefined = 0
  for (const diff of diffs) {
    added += lineCount(diff.newText)
    removed = removed === undefined || diff.oldText === null ? undefined : removed + lineCount(diff.oldText)
  }
  return { added, removed }
}

/**
 * Files mutated by one Turn data value, filtered to the closing seq.
 * @param data - engine-published TurnFiles data.
 * @param seq - closing Assistant seq; later tool settlements are excluded.
 * @returns mutated entries in first-seen order; empty when the turn mutated none.
 */
export function mutationsForClosing(
  data: Readonly<TurnFilesData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly TurnFilePath[] {
  return (data?.files ?? []).filter(file => file.seq <= seq)
}

/**
 * Paths from the official deliverables accumulator, first-seen and deduplicated.
 * @param entries - recorded entries, or undefined when the fold never published.
 * @param seq - closing Assistant seq; later entries are excluded.
 * @returns entry paths in first-seen order; empty when the accumulator is absent or empty.
 */
function producedPathsForClosing(
  entries: readonly { readonly seq: number; readonly path: string }[] | undefined,
  seq: number,
): readonly string[] {
  if (entries === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.seq > seq || seen.has(entry.path)) continue
    seen.add(entry.path)
    paths.push(entry.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain when the closing turn mutated files. The produced
 * half unions in the official deliverables vocabulary (read structurally
 * through the type-only merge — the bundle purity gate forbids the value
 * import): combined with this entry's negative chain priority, the card
 * claims every turn either vocabulary covers, so the official ProducedFiles
 * entry — whose chips open the host OS — never mounts while this plugin is
 * composed.
 * TODO(official-opener-seam): drop the produced union and the priority
 * preemption once ui-conversation exposes a file-opener override (an
 * optional opener service the chat view's openFile consults). On each
 * official upgrade re-check: chain election stays first-match by ascending
 * priority, and the 'deliverables' Turn-data key keeps its { seq, path }[]
 * shape.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns mutated entries (own fold first, then produced extras), or null to decline before mount.
 */
export function selectTurnFiles(owner: TurnTailOwnerProps): readonly TurnFilePath[] | null {
  const files = [...mutationsForClosing(owner.turn.data.get('filePreviewMutations'), owner.seq)]
  for (const path of producedPathsForClosing(owner.turn.data.get('deliverables')?.produced, owner.seq)) {
    if (!files.some(file => file.path === path)) files.push({ seq: owner.seq, path, added: undefined, removed: undefined })
  }
  return files.length === 0 ? null : files
}

/** Turn-local mutated-file accumulator; it publishes no view Node. */
export const turnFilesDefinition: ConversationNodeDefinition<TurnFilesState> = {
  kind: 'filePreviewMutations',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    // The engine only starts a Context on its start match (turn/start); the
    // guard keeps the state's shape honest for direct callers.
    /* v8 ignore next -- engine guarantees a start match here */
    if (match.event.type !== 'turn/start') throw new Error('filePreviewMutations start requires turn/start')
    return { turn: match.event.data.turn, files: [] }
  },
  update: (context, match) => {
    // The engine only updates a Context on its update match (tool/call); the
    // guard keeps the fold's shape honest for direct callers.
    /* v8 ignore next -- engine guarantees an update match here */
    if (match.event.type !== 'tool/call') return context.state
    const path = pathFromToolCall(match.event.data.name, match.event.data.arguments)
    if (path === undefined) return context.state
    const deltas = diffDeltas(
      match.view?.for === 'call' ? match.view.view : null,
      path,
    )
    const existing = context.state.files.find(file => file.path === path)
    if (existing === undefined) {
      return {
        ...context.state,
        files: [...context.state.files, { seq: match.event.seq, path, ...deltas }],
      }
    }
    // A file mutated twice in one turn keeps its first-seen slot and sums the
    // deltas it knows.
    const merged: TurnFilePath = {
      ...existing,
      added: sumKnown(existing.added, deltas.added),
      removed: sumKnown(existing.removed, deltas.removed),
    }
    return {
      ...context.state,
      files: context.state.files.map(file => (file === existing ? merged : file)),
    }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'filePreviewMutations',
      value: { files: context.state.files },
    },
}

/** Re-export for the row component's basename display. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
