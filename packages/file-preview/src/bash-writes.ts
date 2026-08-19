/**
 * Bash-write capture: the "B channel + A collection" seam (upstream-seam
 * registry S2). The official bash tool writes files (heredocs, redirects,
 * `tee`, `sed -i`) with no log structure a products view can fold — the
 * file-preview fold only knows `read`/`write`/`edit` tool calls. This module
 * watches each session's event stream, extracts high-precision write targets
 * from bash command strings, verifies each with `fs.stat` after the call
 * settles (prefer a miss over a false positive), and keeps a per-session
 * registry the `filePreview.list` fold merges into its entries. It never
 * touches the session log — the official `Session.append` cannot mark an
 * event `ignorable: true`, and the persistence read path refuses unknown
 * event types that lack the marker (a plugin-appended event would poison the
 * log on reload), which is exactly why this seam is a side registry instead.
 * The registry is rebuilt on `session/created` by replaying the session's own
 * history, so a restarted host regains its captures.
 * @module @khorsheed/dsh-file-preview
 */

import { homedir } from 'node:os'
import { resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { FileSystem } from '@deepseek-ai/dsh-fs'

/** Cap on write candidates extracted from one command (bounds stat load). */
const MAX_CANDIDATES_PER_COMMAND = 8

/** One pending bash write: the call's location and its unverified targets. */
interface PendingWrite {
  readonly turn: number
  readonly step: number
  readonly seq: number
  /** Expanded absolute candidate paths, not yet stat-verified. */
  readonly candidates: readonly string[]
}

/** One verified captured write, merged into the fold as a `write` entry. */
export interface CapturedWrite {
  readonly turn: number
  readonly step: number
  /** Seq of the issuing `tool/call`, for latest-first ordering. */
  readonly seq: number
}

/** A write-target token stripped of its surrounding quotes. */
function stripQuotes(token: string): string {
  let t = token
  while (
    t.length >= 2
    && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))
  ) {
    t = t.slice(1, -1)
  }
  return t
}

/** Whether a character ends a shell token (outside quotes). */
function isTokenBoundary(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
    || ch === ';' || ch === '|' || ch === '&' || ch === '<' || ch === '>'
}

/**
 * Read the next shell token starting at `from` (after any whitespace), with
 * quote awareness so `'a b'` stays one token. Stops at a boundary character
 * outside quotes.
 * @param command - the command text.
 * @param from - scan start index.
 * @returns the raw token and the index just past it, or null at end / boundary.
 */
function nextToken(command: string, from: number): { token: string; end: number } | null {
  const n = command.length
  let i = from
  while (i < n && (command[i] === ' ' || command[i] === '\t')) i++
  if (i >= n || isTokenBoundary(command[i] ?? '')) return null
  let token = ''
  let quote: "'" | '"' | undefined
  while (i < n) {
    const ch = command[i] ?? ''
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      token += ch
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      token += ch
      i++
      continue
    }
    if (isTokenBoundary(ch)) break
    token += ch
    i++
  }
  return token.length === 0 ? null : { token, end: i }
}

/**
 * Extract write-target tokens from one bash command string. High-precision
 * forms only (the "minimal set"): a single `>` redirect (`cat > path`, any
 * `cmd > path`), `tee path` (append forms skipped), and `sed -i ... path`
 * (the first non-option token after the inline script). `>>`, fd redirects
 * (`2>`), `>&`, `<>`, and any write form inside a heredoc body are ignored;
 * `cp`/`mv`/`python open()` are deliberately deferred. Quoted targets keep
 * their quotes here — expansion strips them.
 * @param command - the bash tool's command string.
 * @returns raw target tokens, capped per command.
 */
export function extractWriteTargets(command: string): string[] {
  const targets: string[] = []
  const n = command.length
  let i = 0
  let quote: "'" | '"' | undefined
  let heredoc: string | undefined
  while (i < n) {
    const ch = command[i] ?? ''
    // Inside a heredoc body: skip whole lines until the delimiter line, so
    // content like HTML `>` never reads as a redirect.
    if (heredoc !== undefined) {
      const nl = command.indexOf('\n', i)
      const line = command.slice(i, nl === -1 ? n : nl)
      if (line.trim() === heredoc) heredoc = undefined
      i = nl === -1 ? n : nl + 1
      continue
    }
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      i++
      continue
    }
    // Heredoc start: `<<` / `<<-` followed by a delimiter word.
    if (ch === '<' && command[i + 1] === '<') {
      let j = i + 2
      if (command[j] === '-') j++
      const q = command[j]
      let delim = ''
      if (q === "'" || q === '"') {
        const end = command.indexOf(q, j + 1)
        delim = end === -1 ? '' : command.slice(j + 1, end)
        j = end === -1 ? n : end + 1
      } else {
        const start = j
        while (j < n && !/\s/.test(command[j] ?? '')) j++
        delim = command.slice(start, j)
      }
      if (delim.length > 0) heredoc = delim
      i = j
      continue
    }
    // `tee path` (append forms skipped entirely).
    if (ch === 't' && command.startsWith('tee', i) && (i === 0 || isTokenBoundary(command[i - 1] ?? ''))) {
      const after = command.slice(i + 3)
      if (/^\s*(?:-a\b|--append\b)/.test(after)) {
        i += 3
        continue
      }
      const consumed = /^\s*(?:-i\b|--ignore-interrupts\s+)*/.exec(after)?.[0].length ?? 0
      const tok = nextToken(command, i + 3 + consumed)
      if (tok !== null) {
        targets.push(tok.token)
        i = tok.end
        continue
      }
      i += 3
      continue
    }
    // `sed -i ... path` — the first non-option token after the inline script.
    if (ch === 's' && command.startsWith('sed', i) && (i === 0 || isTokenBoundary(command[i - 1] ?? ''))) {
      const im = /^\s*-i([A-Za-z0-9.]*)/.exec(command.slice(i + 3))
      if (im === null) {
        i++
        continue
      }
      let j = i + 3 + im[0].length
      const opt = nextToken(command, j)
      if (opt !== null && (opt.token === '-e' || opt.token === '--expression')) {
        const script = nextToken(command, opt.end)
        j = script === null ? opt.end : script.end
      } else if (opt !== null) {
        j = opt.end
      }
      const file = nextToken(command, j)
      if (file !== null && !file.token.startsWith('-')) {
        targets.push(file.token)
        i = file.end
        continue
      }
      i = j
      continue
    }
    // Single `>` redirect target (`>>`, `2>`, `>&`, `<>`, `&>` skipped).
    if (ch === '>') {
      const prev = command[i - 1] ?? ''
      const next = command[i + 1] ?? ''
      const skipped = next === '>' || next === '&' || prev === '>' || prev === '<' || prev === '&' || /[0-9]/.test(prev)
      if (skipped) {
        i++
        continue
      }
      const tok = nextToken(command, i + 1)
      if (tok !== null) {
        targets.push(tok.token)
        i = tok.end
        continue
      }
      i++
      continue
    }
    i++
  }
  return targets.slice(0, MAX_CANDIDATES_PER_COMMAND)
}

/**
 * Expand one raw target token into an absolute host path. Strips quotes,
 * expands a leading `~` and `$VAR`/`${VAR}` from the given environment, and
 * resolves a relative target against the session cwd. Rejects anything that
 * cannot be a literal path: glob metacharacters, command substitution, an
 * unset variable (rather than guessing a truncated path), or a relative
 * target with no cwd to anchor it.
 * @param token - a raw target from {@link extractWriteTargets}.
 * @param env - the host environment (the collector runs in the host process,
 *   so `$DSH_HOME`-style variables resolve here, not in the fold).
 * @param home - the host home directory for `~`.
 * @param cwd - the owning session's cwd for relative targets, or undefined.
 * @returns the absolute path, or null when the token is not statable literally.
 */
export function expandShellPath(
  token: string,
  env: NodeJS.ProcessEnv,
  home: string,
  cwd: string | undefined,
): string | null {
  let t = stripQuotes(token)
  if (t.length === 0) return null
  // Reject glob metacharacters, but not `${VAR}` braces — check after the
  // variable references are removed so `${DSH_HOME}/x` passes.
  if (/[*?[\]{}]/.test(t.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''))) return null
  if (t.includes('$(') || t.includes('`')) return null
  if (t.startsWith('~')) t = home + t.slice(1)
  // Reject any variable reference the environment cannot satisfy.
  const varPattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g
  let match: RegExpExecArray | null
  while ((match = varPattern.exec(t)) !== null) {
    const name = match[1] ?? match[2]
    if (name === undefined || env[name] === undefined) return null
  }
  t = t.replace(varPattern, (_, braced: string | undefined, bare: string | undefined) => env[braced ?? bare ?? ''] ?? '')
  if (t.length === 0) return null
  if (t.startsWith('/')) return t
  if (cwd === undefined || cwd.length === 0) return null
  return resolvePath(cwd, t)
}

/** Parse a tool-call arguments JSON payload into a plain object ({} on failure). */
function parseArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(argumentsJson)
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Options for {@link BashWriteCollector}. */
export interface BashWriteCollectorOptions {
  fs: FileSystem
  env?: NodeJS.ProcessEnv
  home?: string
  /** Cap on captured writes per session (mirrors the fold's maxFiles). */
  maxFiles?: number
}

/**
 * Per-session registry of bash-written files. Subscribes to the session event
 * firehose: `tool/call` (bash) records the command's write candidates keyed by
 * callId; the matching `tool/result` stat-verifies them (files must exist and
 * be files — prefer a miss over a false positive) and stores the survivors.
 * `session/created` replays the session's own history so a restarted host
 * regains captures without any durable state of its own.
 */
export class BashWriteCollector {
  readonly #fs: FileSystem
  readonly #env: NodeJS.ProcessEnv
  readonly #home: string
  readonly #maxFiles: number
  /** sessionId → callId → pending bash write candidates. */
  readonly #pending = new Map<string, Map<string, PendingWrite>>()
  /** sessionId → path → verified capture. */
  readonly #captured = new Map<string, Map<string, CapturedWrite>>()

  constructor(options: BashWriteCollectorOptions) {
    this.#fs = options.fs
    this.#env = options.env ?? process.env
    this.#home = options.home ?? homedir()
    this.#maxFiles = options.maxFiles ?? 500
  }

  /**
   * Subscribe to the session feed; the returned disposer removes both
   * listeners (fiber disposal also cleans them up — this is belt and braces).
   * @param ctx - the owning composition context.
   * @returns a disposer removing the listeners.
   */
  attach(ctx: Context): () => void {
    const offs = [
      ctx.on('session/event', (session: Session, event: SessionEvent) => {
        void this.#onEvent(session, event)
      }),
      ctx.on('session/created', (session: Session) => {
        this.#replay(session)
      }),
    ]
    return () => {
      for (const off of offs) {
        if (typeof off === 'function') off()
      }
    }
  }

  /** Verified captures for one session (the fold-merge source), or undefined. */
  captured(sessionId: string): ReadonlyMap<string, CapturedWrite> | undefined {
    return this.#captured.get(sessionId)
  }

  /** Rebuild one session's registry from its own history (host restart). */
  #replay(session: Session): void {
    this.#pending.set(session.id, new Map())
    this.#captured.set(session.id, new Map())
    for (const event of session.events) this.#onEvent(session, event)
  }

  #onEvent(session: Session, event: SessionEvent): Promise<void> | void {
    if (event.type === 'tool/call') {
      if (event.data.name !== 'bash') return
      const command = parseArguments(event.data.arguments).command
      if (typeof command !== 'string' || command.length === 0) return
      const candidates = extractWriteTargets(command)
        .map(token => expandShellPath(token, this.#env, this.#home, session.header.cwd))
        .filter((path): path is string => path !== null)
      if (candidates.length === 0) return
      const calls = this.#pending.get(session.id) ?? new Map<string, PendingWrite>()
      calls.set(String(event.data.callId), {
        turn: event.data.turn,
        step: event.data.step,
        seq: event.seq,
        candidates,
      })
      this.#pending.set(session.id, calls)
      return
    }
    if (event.type === 'tool/result') {
      const calls = this.#pending.get(session.id)
      if (calls === undefined) return
      const callId = String(event.data.message?.source?.callId ?? '')
      const pending = calls.get(callId)
      if (pending === undefined) return
      calls.delete(callId)
      return this.#verify(session, pending)
    }
  }

  /** stat-verify the pending candidates and store the survivors. */
  async #verify(session: Session, pending: PendingWrite): Promise<void> {
    const captured = this.#captured.get(session.id) ?? new Map<string, CapturedWrite>()
    for (const candidate of pending.candidates) {
      if (captured.size >= this.#maxFiles || captured.has(candidate)) continue
      let ok = false
      try {
        const target = await this.#fs.resolve(candidate)
        const info = await this.#fs.stat(target)
        ok = info?.type === 'file'
      } catch {
        ok = false
      }
      if (ok) {
        captured.set(candidate, { turn: pending.turn, step: pending.step, seq: pending.seq })
      }
    }
    if (captured.size > 0) this.#captured.set(session.id, captured)
  }
}
