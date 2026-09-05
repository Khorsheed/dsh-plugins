/**
 * Codex session records adapter: scans the scoped home's `sessions/`
 * rollout files (one JSONL per session under `sessions/YYYY/MM/DD/`).
 * The LISTING reads only the head of each file — the first `session_meta`
 * line carries the id, cwd, and started-at timestamp it needs. The usage
 * recovery path ({@link codexRolloutUsage}) instead locates one run's file
 * (by thread id or a time window) and scans its TAIL for the last
 * `token_count` event, so an aborted/error exec round that never saw
 * `turn.completed` still books the tokens codex recorded on disk. Files are
 * treated as append-only with torn-tail tolerance, and contents are always
 * untrusted input.
 * @module @khorsheed/dsh-local-agent-codex/records
 */

import { open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

/** Rollout files live under this directory inside the scoped home. */
const SESSIONS_ROOT = 'sessions'

/** Bound on the head prefix read from one rollout file. */
const HEAD_BYTES = 64 * 1024

/** Bound on the tail read from one rollout file for the usage scan. */
const TAIL_BYTES = 64 * 1024

/** Bound on the full-file fallback read when the tail scan finds no token_count. */
const FULL_BYTES = 8 * 1024 * 1024

/**
 * How far back a candidate file's start may precede the run's start and
 * still count as "this run" (clock skew + pre-spawn session creation slack).
 */
const ROLLOUT_WINDOW_SLACK_MS = 5 * 60_000

/** Extra future slack for the window end (file timestamps may skew ahead). */
const ROLLOUT_WINDOW_FUTURE_MS = 60_000

/**
 * Whether the scoped home holds usable Codex credentials: the `auth.json`
 * file exists. Absent means the device-code flow has not completed.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns true when credentials are present.
 */
export async function codexAuthenticated(homeDir: string): Promise<boolean> {
  try {
    await readFile(join(homeDir, 'auth.json'))
    return true
  } catch (error) {
    // No auth file yet: not authenticated.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** The head of one rollout file: the `session_meta` payload's fields we list. */
interface SessionMeta {
  /**
   * Current codex schema (`payload.id`); older releases used `session_id`.
   * Both are accepted so the listing and the usage locator read real homes.
   */
  id?: unknown
  session_id?: unknown
  cwd?: unknown
  timestamp?: unknown
}

/**
 * Parse the first line of a rollout file for the listing fields. Unknown or
 * malformed values yield an undefined record rather than failing the list.
 * @param text - the raw rollout file content (only the head is read).
 * @returns the record, or undefined when the head is not a session_meta line.
 */
export function rolloutRecord(text: string): LocalAgentSessionRecord | undefined {
  const line = text.split('\n')[0]
  if (line === undefined) return undefined
  let event: { type?: unknown; payload?: unknown }
  try {
    event = JSON.parse(line) as { type?: unknown; payload?: unknown }
  } catch {
    return undefined
  }
  if (event.type !== 'session_meta' || typeof event.payload !== 'object' || event.payload === null) {
    return undefined
  }
  const meta = event.payload as SessionMeta
  const sessionId = typeof meta.id === 'string' && meta.id !== ''
    ? meta.id
    : typeof meta.session_id === 'string' && meta.session_id !== ''
      ? meta.session_id
      : undefined
  if (sessionId === undefined) return undefined
  if (typeof meta.cwd !== 'string') return undefined
  const record: LocalAgentSessionRecord = { id: sessionId, workDir: meta.cwd }
  const startedAt = typeof meta.timestamp === 'string' ? Date.parse(meta.timestamp) : undefined
  if (startedAt !== undefined && Number.isFinite(startedAt)) record.startedAt = startedAt
  return record
}

/**
 * Read the scoped home's rollout files. The listing walks
 * `sessions/YYYY/MM/DD/` and reads each `rollout-*.jsonl` head; a torn or
 * malformed file is skipped rather than failing the whole list.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the parsed records, empty when no sessions exist yet.
 */
export async function listCodexSessions(homeDir: string): Promise<readonly LocalAgentSessionRecord[]> {
  const records: LocalAgentSessionRecord[] = []
  let years: string[]
  try {
    years = await readdir(join(homeDir, SESSIONS_ROOT))
  } catch (error) {
    // No sessions root yet: nothing to list.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    let months: string[]
    try {
      months = await readdir(join(homeDir, SESSIONS_ROOT, year))
    } catch {
      continue
    }
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      let days: string[]
      try {
        days = await readdir(join(homeDir, SESSIONS_ROOT, year, month))
      } catch {
        continue
      }
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        let files: string[]
        try {
          files = await readdir(join(homeDir, SESSIONS_ROOT, year, month, day))
        } catch {
          continue
        }
        for (const name of files) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
          try {
            // Only the head matters; read a bounded prefix rather than the
            // whole (potentially long) event log.
            const handle = await open(join(homeDir, SESSIONS_ROOT, year, month, day, name), 'r')
            let text: string
            try {
              const buffer = Buffer.alloc(HEAD_BYTES)
              const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
              text = buffer.subarray(0, bytesRead).toString('utf8')
            } finally {
              await handle.close()
            }
            const record = rolloutRecord(text)
            if (record !== undefined) records.push(record)
          } catch {
            continue
          }
        }
      }
    }
  }
  return records
}

/**
 * Map codex's token-count payload onto the shared usage contract — the
 * SINGLE caliber for both the exec `turn.completed` usage and the rollout
 * `token_count` recovery, so the two sources can never drift. Codex's
 * `input_tokens` is the TOTAL input including cache hits (OpenAI-style
 * accounting, confirmed against `total_tokens` in the rollout token_count),
 * and `cached_input_tokens` is the cache-read subset — so the uncached
 * bucket subtracts the cached portion to avoid double counting. There is no
 * cache-write concept, so that bucket is omitted (the shared four-bucket
 * contract: uncached input, output, cache read, cache write — codex fills
 * the first three).
 * @param usage - the raw codex usage object (`turn.completed`'s `usage` or a
 *   rollout `token_count` `info.last_token_usage`/`total_token_usage`).
 * @returns the shared usage record.
 */
export function usageFromCodex(usage: unknown): TokenUsage {
  const raw = usage as { input_tokens?: unknown; cached_input_tokens?: unknown; output_tokens?: unknown }
  const input = Number(raw.input_tokens)
  const cached = Number(raw.cached_input_tokens)
  const output = Number(raw.output_tokens)
  const uncached = Number.isFinite(input) && Number.isFinite(cached)
    ? Math.max(0, input - cached)
    : Number.isFinite(input)
      ? input
      : 0
  const usageRecord: TokenUsage = {
    inputTokens: uncached,
    outputTokens: Number.isFinite(output) ? output : 0,
  }
  if (Number.isFinite(cached) && cached > 0) usageRecord.cacheReadTokens = cached
  return usageRecord
}

/**
 * Scan rollout-file text for the LAST `token_count` event and map its usage
 * onto the shared contract. A token_count entry rides an
 * `{"type":"event_msg","payload":{"type":"token_count","info":{…}}}` line
 * (verified against codex-cli 0.144.0 rollout files); the per-turn
 * `info.last_token_usage` is the same caliber as `turn.completed`'s usage,
 * with the session-wide `total_token_usage` as fallback. Torn or malformed
 * lines are skipped; an absent event yields undefined.
 * @param text - raw rollout file content (the tail scan reads a bounded suffix).
 * @returns the mapped usage of the last token_count event, or undefined.
 */
export function codexRolloutTokenUsage(text: string): TokenUsage | undefined {
  let info: unknown
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let event: { type?: unknown; payload?: unknown }
    try {
      event = JSON.parse(line) as { type?: unknown; payload?: unknown }
    } catch {
      continue
    }
    if (event.type !== 'event_msg' || typeof event.payload !== 'object' || event.payload === null) continue
    const payload = event.payload as { type?: unknown; info?: unknown }
    if (payload.type !== 'token_count') continue
    if (typeof payload.info === 'object' && payload.info !== null) info = payload.info
  }
  if (info === undefined) return undefined
  const entry = info as { last_token_usage?: unknown; total_token_usage?: unknown }
  const usage = entry.last_token_usage ?? entry.total_token_usage
  return usage === undefined ? undefined : usageFromCodex(usage)
}

/** One candidate rollout file collected during the locator walk. */
interface RolloutCandidate {
  readonly path: string
  /** The session id from the head (`payload.id`/`session_id`), when parseable. */
  readonly id: string | undefined
  /** Epoch-ms session start (head timestamp, falling back to the filename). */
  readonly startedAt: number | undefined
}

/** Parse the ISO timestamp embedded in a `rollout-<ISO>-<uuid>.jsonl` name. */
function rolloutFilenameTimestamp(name: string): number | undefined {
  // `rollout-2026-07-04T19-58-19-019f2cfe….jsonl`: the time part uses dashes
  // instead of colons; normalize before Date.parse.
  const match = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})/.exec(name)
  if (match === null) return undefined
  const parsed = Date.parse(`${match[1]}:${match[2]}:${match[3]}`)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Read a bounded suffix of a rollout file and scan it for the last
 * `token_count`; a tail that holds no token_count (a single giant trailing
 * event can push it out of the window) falls back to a bounded full read.
 * @param path - the rollout file path.
 * @returns the mapped usage, or undefined when the file holds none.
 */
async function rolloutFileTokenUsage(path: string): Promise<TokenUsage | undefined> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    let scanned = ''
    if (size > 0) {
      const tailLength = Math.min(TAIL_BYTES, size)
      const buffer = Buffer.alloc(tailLength)
      const { bytesRead } = await handle.read(buffer, 0, tailLength, size - tailLength)
      scanned = buffer.subarray(0, bytesRead).toString('utf8')
    }
    let usage = codexRolloutTokenUsage(scanned)
    if (usage === undefined && size > TAIL_BYTES) {
      const buffer = Buffer.alloc(Math.min(FULL_BYTES, size))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      usage = codexRolloutTokenUsage(buffer.subarray(0, bytesRead).toString('utf8'))
    }
    return usage
  } finally {
    await handle.close()
  }
}

/** Locator for one run's rollout file, resolved by thread id or a time window. */
export interface CodexRolloutUsageLocator {
  /**
   * The thread id observed from the run's NDJSON stream (`thread.started`);
   * the primary locator — matches the session_meta head id.
   */
  readonly threadId?: string | undefined
  /**
   * Epoch-ms run start (the spawn moment); the time-window fallback centers
   * on it when no thread id matched (e.g. a kill truncated the stream before
   * `thread.started`).
   */
  readonly windowStart?: number | undefined
}

/**
 * Locate ONE run's rollout file. Walks the scoped home's `sessions/YYYY/MM/DD/`
 * tree reading each file's head (the same bounded walk as
 * {@link listCodexSessions}), then prefers the file whose session id equals
 * `locator.threadId`; otherwise — or when the id matched nothing — the file
 * whose start falls in the window around `locator.windowStart`, newest first.
 * Shared by the usage recovery ({@link codexRolloutUsage}) and the model
 * observation ({@link codexRolloutTurnModel}).
 * @param homeDir - the `codex` harness's scoped home.
 * @param locator - the thread id and/or the run's start-time window.
 * @returns the located file path, or undefined when nothing locates.
 */
async function locateCodexRolloutFile(
  homeDir: string,
  locator: CodexRolloutUsageLocator,
): Promise<string | undefined> {
  const candidates: RolloutCandidate[] = []
  let years: string[]
  try {
    years = await readdir(join(homeDir, SESSIONS_ROOT))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    let months: string[]
    try {
      months = await readdir(join(homeDir, SESSIONS_ROOT, year))
    } catch {
      continue
    }
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      let days: string[]
      try {
        days = await readdir(join(homeDir, SESSIONS_ROOT, year, month))
      } catch {
        continue
      }
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        let files: string[]
        try {
          files = await readdir(join(homeDir, SESSIONS_ROOT, year, month, day))
        } catch {
          continue
        }
        for (const name of files) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
          const path = join(homeDir, SESSIONS_ROOT, year, month, day, name)
          try {
            const handle = await open(path, 'r')
            let text: string
            try {
              const buffer = Buffer.alloc(HEAD_BYTES)
              const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
              text = buffer.subarray(0, bytesRead).toString('utf8')
            } finally {
              await handle.close()
            }
            const record = rolloutRecord(text)
            candidates.push({
              path,
              id: record?.id,
              startedAt: record?.startedAt ?? rolloutFilenameTimestamp(name),
            })
          } catch {
            continue
          }
        }
      }
    }
  }
  if (candidates.length === 0) return undefined
  const threadMatch = locator.threadId === undefined
    ? undefined
    : candidates.find(candidate => candidate.id === locator.threadId)
  let chosen = threadMatch
  if (chosen === undefined && locator.windowStart !== undefined) {
    const windowStart = locator.windowStart - ROLLOUT_WINDOW_SLACK_MS
    const windowEnd = Date.now() + ROLLOUT_WINDOW_FUTURE_MS
    const inWindow = candidates
      .filter(candidate => candidate.startedAt !== undefined
        && candidate.startedAt >= windowStart && candidate.startedAt <= windowEnd)
      .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))
    chosen = inWindow[0]
  }
  return chosen?.path
}

/**
 * Recover the last `token_count` usage of ONE run's rollout file. The file is
 * located by {@link locateCodexRolloutFile}; only its tail is read.
 * @param homeDir - the `codex` harness's scoped home.
 * @param locator - the thread id and/or the run's start-time window.
 * @returns the mapped last token_count usage, or undefined when nothing
 *   locates or the file holds no token_count (hard-killed before any turn
 *   boundary writes one).
 */
export async function codexRolloutUsage(
  homeDir: string,
  locator: CodexRolloutUsageLocator,
): Promise<TokenUsage | undefined> {
  const path = await locateCodexRolloutFile(homeDir, locator)
  if (path === undefined) return undefined
  try {
    return await rolloutFileTokenUsage(path)
  } catch {
    return undefined
  }
}

/**
 * How far before the run's spawn moment a `turn_context` timestamp may sit and
 * still count as THIS run's turn (sub-second ordering between the host's
 * spawn clock and the CLI's own stamps).
 */
const ROLLOUT_CONTEXT_SLACK_MS = 2_000

/**
 * Read ONE run's model identifier from its rollout file: the LAST
 * `turn_context` line whose top-level `timestamp` falls inside the run's
 * window (`windowStart` onward) — the turn codex actually started for this
 * round, so a resumed thread's earlier rounds' models are never misread, and
 * a round killed mid-turn still observes the model it started with. A tail
 * scan suffices (later turns append later lines); a torn final line is
 * skipped. Absent when nothing locates, the window holds no turn_context
 * (the round never started a turn), or the payload names no model — absence
 * is recorded, never guessed.
 * @param homeDir - the `codex` harness's scoped home.
 * @param locator - the thread id and/or the run's start-time window.
 * @returns the observed model identifier, or undefined.
 */
export async function codexRolloutTurnModel(
  homeDir: string,
  locator: CodexRolloutUsageLocator,
): Promise<string | undefined> {
  const path = await locateCodexRolloutFile(homeDir, locator)
  if (path === undefined) return undefined
  const windowStart = locator.windowStart === undefined
    ? undefined
    : locator.windowStart - ROLLOUT_CONTEXT_SLACK_MS
  try {
    const handle = await open(path, 'r')
    try {
      const { size } = await handle.stat()
      if (size === 0) return undefined
      const tailLength = Math.min(TAIL_BYTES, size)
      const buffer = Buffer.alloc(tailLength)
      const { bytesRead } = await handle.read(buffer, 0, tailLength, size - tailLength)
      let model: string | undefined
      for (const raw of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        const line = raw.trim()
        if (line === '') continue
        let event: { type?: unknown; timestamp?: unknown; payload?: unknown }
        try {
          event = JSON.parse(line) as typeof event
        } catch {
          continue
        }
        if (event.type !== 'turn_context' || typeof event.payload !== 'object' || event.payload === null) continue
        if (windowStart !== undefined) {
          const stamped = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : undefined
          if (stamped === undefined || !Number.isFinite(stamped) || stamped < windowStart) continue
        }
        const candidate = (event.payload as { model?: unknown }).model
        if (typeof candidate === 'string' && candidate !== '') model = candidate
      }
      return model
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}
