/**
 * Codex session records adapter: scans the scoped home's `sessions/`
 * rollout files (one JSONL per session under `sessions/YYYY/MM/DD/`).
 * The LISTING reads only the head of each file — the first `session_meta`
 * line carries the id, cwd, and started-at timestamp it needs. The READ-BACK
 * path ({@link codexRolloutRoundFacts}) instead locates one run's file (by
 * thread id, working directory, or a time window) and reads that round's
 * usage, model, and codex build out of it — the facts the exec `--json` wire
 * either omits entirely (the model) or drops on a non-completed round (the
 * usage). Files are treated as append-only with torn-tail tolerance, and
 * contents are always untrusted input.
 * @module @khorsheed/dsh-local-agent-codex/records
 */

import { open, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
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
  /** The head's `cwd` — the directory this session's CLI actually ran in. */
  readonly workDir: string | undefined
  /** The head's `cli_version` — the codex build that wrote the file. */
  readonly cliVersion: string | undefined
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
 * The codex build that wrote one rollout file, from its `session_meta` head
 * (`payload.cli_version`, present since codex 0.14x). This is the AUTHORITY
 * for the version a delegation round actually ran: it is codex's own record of
 * itself, written by the process that served the round, so it cannot drift
 * from the binary the way a later `--version` probe can.
 * @param text - the raw rollout head.
 * @returns the version, or undefined when the head names none.
 */
export function rolloutCliVersion(text: string): string | undefined {
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
  const version = (event.payload as { cli_version?: unknown }).cli_version
  return typeof version === 'string' && version !== '' ? version : undefined
}

/** Locator for one run's rollout file, resolved by thread id, cwd, and a time window. */
export interface CodexRolloutLocator {
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
  /**
   * The directory the run's CLI process was spawned in. Only the time-window
   * fallback uses it, and there it is decisive: concurrent delegations put
   * several runs' files inside one window, and the head's `cwd` is what tells
   * them apart (an orchestrator gives every cell its own directory).
   */
  readonly cwd?: string | undefined
}

/**
 * How far before the run's spawn moment a `turn_context` timestamp may sit and
 * still count as THIS run's turn (sub-second ordering between the host's
 * spawn clock and the CLI's own stamps).
 */
const ROLLOUT_CONTEXT_SLACK_MS = 2_000

/**
 * Locate ONE run's rollout file. Walks the scoped home's `sessions/YYYY/MM/DD/`
 * tree reading each file's head (the same bounded walk as
 * {@link listCodexSessions}), then prefers the file whose session id equals
 * `locator.threadId`; otherwise the file whose start falls in the window
 * around `locator.windowStart`, newest first.
 *
 * **Concurrency**: the window alone cannot separate two runs started seconds
 * apart, so when the locator names a `cwd` the window set is restricted to
 * files whose head records that same directory. A window that holds candidates
 * but none in the run's directory resolves to NOTHING rather than to a
 * neighbour's file — unless the window holds exactly one candidate, where
 * there is no other run to confuse it with and the mismatch is path skew (a
 * symlinked temp root) rather than ambiguity. A misattributed model is a
 * worse answer than an absent one: the evaluation fails a run loud on
 * declared ≠ observed.
 * @param homeDir - the `codex` harness's scoped home.
 * @param locator - the thread id, working directory, and/or start-time window.
 * @returns the located candidate, or undefined when nothing locates.
 */
async function locateCodexRollout(
  homeDir: string,
  locator: CodexRolloutLocator,
): Promise<RolloutCandidate | undefined> {
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
              workDir: record?.workDir,
              cliVersion: rolloutCliVersion(text),
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
  if (threadMatch !== undefined) return threadMatch
  if (locator.windowStart === undefined) return undefined
  const windowStart = locator.windowStart - ROLLOUT_WINDOW_SLACK_MS
  const windowEnd = Date.now() + ROLLOUT_WINDOW_FUTURE_MS
  const inWindow = candidates
    .filter(candidate => candidate.startedAt !== undefined
      && candidate.startedAt >= windowStart && candidate.startedAt <= windowEnd)
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))
  if (locator.cwd === undefined) return inWindow[0]
  const wanted = resolve(locator.cwd)
  const sameCwd = inWindow.filter(candidate => candidate.workDir !== undefined && resolve(candidate.workDir) === wanted)
  if (sameCwd.length > 0) return sameCwd[0]
  return inWindow.length === 1 ? inWindow[0] : undefined
}

/** What one scan of a rollout file's text yielded. */
interface RolloutScan {
  usage?: TokenUsage
  model?: string
}

/**
 * Scan rollout text for this run's two read-back facts: the LAST `token_count`
 * usage, and the model of the LAST `turn_context` whose top-level `timestamp`
 * falls inside the run's window (`windowStart` onward) — the turn codex
 * actually started for this round, so a resumed thread's earlier rounds are
 * never misread and a round killed mid-turn still observes the model it
 * started with. A torn line is skipped.
 */
function scanRolloutText(text: string, windowStart: number | undefined): RolloutScan {
  const usage = codexRolloutTokenUsage(text)
  const scan: RolloutScan = usage === undefined ? {} : { usage }
  for (const raw of text.split('\n')) {
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
    if (typeof candidate === 'string' && candidate !== '') scan.model = candidate
  }
  return scan
}

/**
 * Read one located rollout file for the round's usage and model.
 *
 * The tail is read first because it is where `token_count` lives (codex writes
 * one per turn boundary, so the last is at the end). `turn_context` is the
 * opposite: codex writes it when the turn STARTS, so a round that then
 * produces more than {@link TAIL_BYTES} of events pushes it out of the tail
 * entirely — which is exactly how a real evaluation run reported a null model
 * against rollout files that named it plainly, while a short smoke round (a
 * whole file smaller than the tail window) read back fine. So whenever the
 * tail leaves either fact missing, a bounded full read from offset 0 fills it
 * in.
 */
async function readRolloutFacts(path: string, windowStart: number | undefined): Promise<RolloutScan> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (size === 0) return {}
    const tailLength = Math.min(TAIL_BYTES, size)
    const tail = Buffer.alloc(tailLength)
    const tailRead = await handle.read(tail, 0, tailLength, size - tailLength)
    const scan = scanRolloutText(tail.subarray(0, tailRead.bytesRead).toString('utf8'), windowStart)
    if ((scan.usage !== undefined && scan.model !== undefined) || size <= TAIL_BYTES) return scan
    const full = Buffer.alloc(Math.min(FULL_BYTES, size))
    const fullRead = await handle.read(full, 0, full.length, 0)
    const wide = scanRolloutText(full.subarray(0, fullRead.bytesRead).toString('utf8'), windowStart)
    // The tail's answers are the file's LAST ones; the full read only fills
    // what the tail did not carry (its own "last" stops at FULL_BYTES).
    const usage = scan.usage ?? wide.usage
    const model = scan.model ?? wide.model
    return {
      ...usage === undefined ? {} : { usage },
      ...model === undefined ? {} : { model },
    }
  } finally {
    await handle.close()
  }
}

/** One delegation round's facts, read back from the run's own rollout file. */
export interface CodexRoundFacts {
  /** The round's last `token_count` usage, in the shared caliber. */
  readonly usage?: TokenUsage
  /** The model the round's turn ran with (`turn_context.model`). */
  readonly model?: string
  /** The codex build that served the round (`session_meta.cli_version`). */
  readonly cliVersion?: string
}

/**
 * Read ONE run's facts back from its rollout file: the token usage a
 * non-completed round never streamed, the model the exec `--json` wire does
 * not carry at all (codex 0.144.0), and the codex build that served it. One
 * locate and one file open serve all three.
 *
 * Every field is absent on a miss — no rollout file, an unreadable home, a
 * hard kill before any turn boundary, a window with no turn_context. Absence
 * is recorded, never guessed.
 * @param homeDir - the `codex` harness's scoped home.
 * @param locator - the thread id, working directory, and/or start-time window.
 * @returns the round's read-back facts.
 */
export async function codexRolloutRoundFacts(
  homeDir: string,
  locator: CodexRolloutLocator,
): Promise<CodexRoundFacts> {
  let located: RolloutCandidate | undefined
  try {
    located = await locateCodexRollout(homeDir, locator)
  } catch {
    return {}
  }
  if (located === undefined) return {}
  const windowStart = locator.windowStart === undefined
    ? undefined
    : locator.windowStart - ROLLOUT_CONTEXT_SLACK_MS
  let scan: RolloutScan = {}
  try {
    scan = await readRolloutFacts(located.path, windowStart)
  } catch {
    // An unreadable file still yields the head fact the locator already read.
  }
  return {
    ...scan.usage === undefined ? {} : { usage: scan.usage },
    ...scan.model === undefined ? {} : { model: scan.model },
    ...located.cliVersion === undefined ? {} : { cliVersion: located.cliVersion },
  }
}
