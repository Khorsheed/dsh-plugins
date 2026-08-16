/**
 * File-impact fold: which files a user message's turn created/modified.
 * Reads write/edit tool calls from the session log (the same data source
 * file-preview uses) to summarize the withdrawal impact.
 * @module @khorsheed/dsh-client-message-tools/files
 */

/** One touched file: its path and the operation. */
export interface TouchedFile {
  /** Display path recorded by the tool call. */
  path: string
  /** What happened: created (write) or modified (edit). */
  op: 'write' | 'edit'
  /** The tool call's seq. */
  seq: number
  /** The turn that touched it. */
  turn: number
}

/** Minimal tool/call event shape. */
export interface ToolCallEvent {
  seq: number
  type: 'tool/call'
  data: { name: string; turn: number; arguments: string }
}

/**
 * Fold the files touched in one turn (the turn that contains the user
 * message being withdrawn, plus subsequent turns up to the next user
 * message). Used to summarize withdrawal impact.
 * @param events - session events in ascending seq order.
 * @param fromTurn - the turn of the withdrawn message.
 * @param toTurn - exclusive end turn (the next user message's turn).
 * @returns the touched files in seq order.
 */
export function foldTurnFiles(events: readonly ToolCallEvent[], fromTurn: number, toTurn: number): TouchedFile[] {
  const FILE_TOOLS = new Set(['write', 'edit'])
  const out: TouchedFile[] = []
  for (const event of events) {
    if (event.data.turn < fromTurn || event.data.turn >= toTurn) continue
    if (!FILE_TOOLS.has(event.data.name)) continue
    let path: string | undefined
    try {
      const parsed = JSON.parse(event.data.arguments) as { file_path?: unknown }
      if (typeof parsed.file_path === 'string' && parsed.file_path.length > 0) path = parsed.file_path
    } catch {
      // malformed arguments contribute no path
    }
    if (path === undefined) continue
    out.push({ path, op: event.data.name as 'write' | 'edit', seq: event.seq, turn: event.data.turn })
  }
  return out
}

/** Summarize touched files as a human string for the confirm dialog. */
export function summarizeFiles(files: readonly TouchedFile[]): string {
  if (files.length === 0) return ''
  const lines = files.map((f) => `- ${f.path} (${f.op === 'write' ? '新建' : '修改'})`)
  return lines.join('\n')
}
