/**
 * Synthetic Claude Code subagent records for the subagent-mirror specs
 * (member-cli-subagents M4). Generated at test time into a scratch
 * `CLAUDE_CONFIG_DIR`; no content is copied from any real CLI home.
 *
 * The SHAPES follow claude 2.1.x as read (fields only) from real
 * `projects/<slug>/<session>/subagents/` directories:
 * - `agent-<id>.meta.json`: `agentType`, `description`, `toolUseId`,
 *   `spawnDepth`, `requestShape`, `requestNonInteractive`, `isBuiltIn`,
 *   `launchedWithDefaults`, and `finished: true` once done (absent before,
 *   and on older builds);
 * - `agent-<id>.jsonl`: every line `isSidechain: true` with `agentId` and the
 *   member's `sessionId`; the prompt as the first `user` line (string
 *   content), an `isMeta` user line, `attachment` and `api-request` lines,
 *   one `assistant` line per content block (`apiBlockIndex`; the blocks of one
 *   API call share `message.id`/`requestId` and repeat its usage), and `user`
 *   tool_result lines carrying `toolUseResult`.
 * The text is placeholder content.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The member CLI session the fixtures live under. */
export const FIXTURE_CLI_SESSION = 'claude-session-1'
/** A cwd slug (the reader finds the session by name, never by computing the slug). */
const SLUG = '-home-user-work'
const BASE = Date.parse('2026-08-16T00:00:00.000Z')

/** The fixture's ISO timestamp `ms` after the base. */
export const at = (ms: number): string => new Date(BASE + ms).toISOString()

/** One API call's usage, as the transcript repeats it on each block line. */
export const usageOf = (input: number, output: number, cacheRead = 0): Record<string, unknown> => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
  service_tier: 'standard',
})

/** The `subagents/` directory for the fixture session under a scratch home. */
export function subagentsDir(homeDir: string): string {
  const dir = join(homeDir, 'projects', SLUG, FIXTURE_CLI_SESSION, 'subagents')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Write (or rewrite) one subagent's meta file. */
export function writeMeta(homeDir: string, agentId: string, meta: { toolUseId: string; agentType?: string; description?: string; finished?: boolean }): void {
  writeFileSync(join(subagentsDir(homeDir), `agent-${agentId}.meta.json`), JSON.stringify({
    agentType: meta.agentType ?? 'general-purpose',
    description: meta.description ?? '占位任务',
    toolUseId: meta.toolUseId,
    spawnDepth: 1,
    requestShape: 'background',
    requestNonInteractive: true,
    isBuiltIn: true,
    launchedWithDefaults: true,
    ...meta.finished === undefined ? {} : { finished: meta.finished },
  }))
}

/** The common fields every transcript line carries. */
function common(agentId: string, uuid: string, ms: number): Record<string, unknown> {
  return {
    parentUuid: null,
    isSidechain: true,
    agentId,
    sessionId: FIXTURE_CLI_SESSION,
    cwd: '/home/user/work',
    userType: 'external',
    entrypoint: 'sdk-cli',
    version: '2.1.318',
    gitBranch: 'main',
    uuid,
    timestamp: at(ms),
  }
}

/** The head of a transcript: the prompt, a meta injection, an attachment, an api-request. */
export function headLines(agentId: string, prompt: string, ms = 0): Record<string, unknown>[] {
  return [
    { ...common(agentId, `${agentId}-u0`, ms), type: 'user', message: { role: 'user', content: prompt } },
    { ...common(agentId, `${agentId}-u1`, ms), type: 'user', isMeta: true, message: { role: 'user', content: '<system-reminder>占位</system-reminder>' } },
    { ...common(agentId, `${agentId}-a0`, ms), type: 'attachment', attachment: { type: 'placeholder' } },
    { ...common(agentId, `${agentId}-r0`, ms + 5), type: 'api-request', request: { model: 'claude-sonnet-fixture' } },
  ]
}

/**
 * One API call: one assistant line per block, sharing the message id and the
 * call's usage (the output count grows on the later lines, as the CLI writes
 * each block when it completes).
 */
export function callLines(agentId: string, messageId: string, ms: number, blocks: Record<string, unknown>[], usage: Record<string, unknown>, stop: 'tool_use' | 'end_turn'): Record<string, unknown>[] {
  return blocks.map((block, index) => ({
    ...common(agentId, `${messageId}-${index}`, ms + index * 10),
    type: 'assistant',
    requestId: `req-${messageId}`,
    apiBlockIndex: index,
    message: {
      model: 'claude-sonnet-fixture',
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [block],
      stop_reason: index === blocks.length - 1 ? stop : null,
      stop_sequence: null,
      usage,
    },
  }))
}

/** A user tool_result line for a subagent's own tool call. */
export function resultLine(agentId: string, toolUseId: string, ms: number, text: string): Record<string, unknown> {
  return {
    ...common(agentId, `${toolUseId}-res`, ms),
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
    toolUseResult: { stdout: text, stderr: '', interrupted: false },
    sourceToolAssistantUUID: `${toolUseId}-src`,
  }
}

/** Append lines to one subagent's transcript. */
export function appendTranscript(homeDir: string, agentId: string, lines: readonly Record<string, unknown>[]): void {
  appendFileSync(join(subagentsDir(homeDir), `agent-${agentId}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n') + '\n')
}

/**
 * A whole two-call subagent: think + Read (resulted), then a final text.
 * `split` returns the two halves so a live test can write them in turn.
 */
export function twoCallTranscript(agentId: string, prompt: string, answer: string, ms = 0): { first: Record<string, unknown>[]; second: Record<string, unknown>[] } {
  const readId = `${agentId}-read`
  return {
    first: [
      ...headLines(agentId, prompt, ms),
      ...callLines(agentId, `${agentId}-m1`, ms + 100, [
        { type: 'thinking', thinking: '先读一下文件', signature: 'sig' },
        { type: 'tool_use', id: readId, name: 'Read', input: { file_path: '/home/user/work/a.txt' } },
      ], usageOf(10, 30, 200), 'tool_use'),
      resultLine(agentId, readId, ms + 200, '文件内容占位'),
    ],
    second: [
      { ...common(agentId, `${agentId}-r1`, ms + 250), type: 'api-request', request: { model: 'claude-sonnet-fixture' } },
      ...callLines(agentId, `${agentId}-m2`, ms + 300, [{ type: 'text', text: answer }], usageOf(12, 8, 230), 'end_turn'),
    ],
  }
}

/** The member's stream-json `assistant` event for its `Agent` call(s). */
export function memberAgentCall(calls: Array<{ id: string; description: string; type?: string; background?: boolean }>, messageId = 'member-m1'): Record<string, unknown> {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: FIXTURE_CLI_SESSION,
    message: {
      id: messageId,
      role: 'assistant',
      model: 'claude-opus-fixture',
      content: calls.map(call => ({
        type: 'tool_use',
        id: call.id,
        name: 'Agent',
        input: {
          description: call.description,
          prompt: '占位任务正文',
          ...call.type === undefined ? {} : { subagent_type: call.type },
          ...call.background === true ? { run_in_background: true } : {},
        },
      })),
      usage: usageOf(50, 20),
    },
  }
}

/**
 * The member's stream-json `user` event carrying an `Agent` call's tool_result.
 * The background shape (`async_launched`, its launch notice) is the verified
 * one; the foreground `{ status: 'completed', agentId }` is inferred (no
 * foreground sample was available), and the mirror does not rely on it.
 */
export function memberAgentResult(callId: string, agentId: string, text: string, background = false): Record<string, unknown> {
  return {
    type: 'user',
    parent_tool_use_id: null,
    session_id: FIXTURE_CLI_SESSION,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text }] }] },
    tool_use_result: background
      ? { isAsync: true, status: 'async_launched', agentId, description: '占位', prompt: '占位', outputFile: '/home/user/out.txt', canReadOutputFile: true }
      : { status: 'completed', agentId, content: [{ type: 'text', text }] },
  }
}

/** A subagent's own event on the member's stream (the liveness signal). */
export function subagentSignal(callId: string): Record<string, unknown> {
  return { type: 'assistant', parent_tool_use_id: callId, message: { id: 'sub-signal', role: 'assistant', content: [{ type: 'text', text: '子智能体流里的片段' }] } }
}
