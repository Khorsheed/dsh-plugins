#!/usr/bin/env node
/**
 * Clearing-fit analyzer: reads dsh session logs and decides whether a
 * continuous tool-result clearing strategy (Anthropic `clear_tool_uses`-style:
 * replace old tool results with placeholders beyond a keep window) would pay
 * for itself on this deployment's historical workload.
 *
 * The economics: clearing frees F tokens from every subsequent request but
 * breaks the KV prefix cache once per clearing event (a full re-read of the
 * surviving prefix at the cache-miss price). With hit price `r` and miss
 * price `m` (per token), one event that leaves C' tokens behind and frees F
 * tokens breaks even after n* = C'(m - r) / (F·r) further calls. The analyzer
 * measures C, F, and the remaining-call count S from the logs and reports
 * per-session payback plus an aggregate enable/hold verdict.
 *
 * Usage:
 *   tsx scripts/analyze-clearing-fit.ts [sessionsRoot]
 *     [--window 1000000] [--trigger-ratio 0.4] [--keep 15]
 *     [--hit-price 0.007] [--miss-price 0.22]
 *
 * sessionsRoot defaults to $DSH_HOME/sessions, then ~/.dsh/sessions.
 * Prices are USD per 1M tokens; the deepseek-v4-flash off-peak defaults are
 * the post-2026-08-17 official prices. Peak prices share the same miss/hit
 * ratio, so the verdict is peak/off-peak invariant.
 * @module scripts/analyze-clearing-fit
 */

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decompress } from 'fzstd'

export interface PriceBook {
  /** USD per 1M cached-input (hit) tokens. */
  hit: number
  /** USD per 1M uncached-input (miss) tokens. */
  miss: number
}

export interface AnalyzeOptions {
  /** Routed model's context window in tokens. */
  windowTokens: number
  /** Candidate clearing trigger as a fraction of the window. */
  triggerRatio: number
  /** Recent tool results a clearing pass would leave untouched. */
  keep: number
  /** Heuristic chars-per-token for surface-size estimates. */
  charsPerToken: number
  prices: PriceBook
  /** Minimum measured calls after the trigger crossing for eligibility. */
  minRemainingCalls: number
}

export const DEFAULTS: AnalyzeOptions = {
  windowTokens: 1_000_000,
  triggerRatio: 0.4,
  keep: 15,
  charsPerToken: 4,
  prices: { hit: 0.007, miss: 0.22 },
  minRemainingCalls: 100,
}

export interface SessionStats {
  id: string
  calls: number
  freshTokens: number
  cacheReadTokens: number
  outputTokens: number
  /** Estimated surface size at its largest point, in tokens. */
  maxContextTokens: number
  /** tool_result share of surface characters at that point. */
  toolShareAtMax: number
  toolResultsAtMax: number
  /** Estimated tokens a clearing pass could free at that point. */
  clearableTokens: number
  /** Measured model calls after the surface first crossed the trigger. */
  callsAfterTrigger: number
  pruneEvents: number
  summaryEvents: number
}

export interface SessionVerdict extends SessionStats {
  /** One clearing event's cache-invalidation cost in USD. */
  eventCostUsd: number
  /** Per-call saving in USD after the event. */
  savingPerCallUsd: number
  /** Calls needed to recoup one event. */
  paybackCalls: number
  /** Net USD over the measured remaining calls, single-event model. */
  netUsd: number
  eligible: boolean
  netPositive: boolean
}

export interface Report {
  options: AnalyzeOptions
  sessions: number
  totalCalls: number
  totalCacheRead: number
  totalFresh: number
  hitRatio: number
  topSessions: SessionVerdict[]
  /** Cache-read share carried by the eligible, net-positive sessions. */
  eligibleCacheShare: number
  /** Suggested clearAtLeast floor in tokens (S = minRemainingCalls). */
  suggestedClearAtLeast: number
  enable: boolean
  reasons: string[]
}

type SurfaceKind = 'user' | 'assistant' | 'tool'

interface SurfaceEntry {
  kind: SurfaceKind
  chars: number
}

const MESSAGE_EVENT_KINDS: Record<string, SurfaceKind> = {
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
}

/** Decode one session log file (plain JSONL or zstd-compressed frames). */
export function decodeSessionFile(path: string): string {
  const raw = readFileSync(path)
  if (path.endsWith('.zstd')) return new TextDecoder().decode(decompress(new Uint8Array(raw)))
  return raw.toString('utf8')
}

function textChars(blocks: unknown): number {
  if (!Array.isArray(blocks)) return 0
  let chars = 0
  for (const block of blocks) {
    if (block == null || typeof block !== 'object') continue
    const b = block as { type?: string; text?: string; name?: string; arguments?: string }
    if (b.type === 'text' || b.type === 'reasoning') chars += b.text?.length ?? 0
    else if (b.type === 'tool-call') chars += (b.name?.length ?? 0) + (b.arguments?.length ?? 0)
  }
  return chars
}

function eventChars(type: string, data: unknown): number {
  const message = (data as { message?: { content?: unknown[] } })?.message
  const content = message?.content
  if (!Array.isArray(content)) return 0
  if (type === 'tool/result') {
    const first = content[0] as { content?: unknown[] } | undefined
    return textChars(first?.content)
  }
  return textChars(content)
}

/** Analyze one decoded session log (JSONL text). */
export function analyzeSession(id: string, text: string, options: AnalyzeOptions): SessionStats {
  const triggerTokens = options.windowTokens * options.triggerRatio
  const surface = new Map<number, SurfaceEntry>()
  const order: number[] = []
  const kindChars: Record<SurfaceKind, number> = { user: 0, assistant: 0, tool: 0 }
  let surfaceChars = 0
  let toolCount = 0
  let maxChars = 0
  let maxSnapshot: { kindChars: Record<SurfaceKind, number>; toolCount: number } | null = null
  let triggerSeq: number | null = null

  let calls = 0
  let freshTokens = 0
  let cacheReadTokens = 0
  let outputTokens = 0
  let callsAfterTrigger = 0
  let pruneEvents = 0
  let summaryEvents = 0

  for (const line of text.split('\n')) {
    if (!line || line[0] !== '{') continue
    let ev: {
      type?: string
      seq?: number
      surfaceOp?: unknown
      data?: unknown
    }
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const type = ev.type
    if (typeof type !== 'string') continue

    if (type === 'compaction/prune') pruneEvents += 1
    else if (type === 'compaction/summary') summaryEvents += 1

    if (type === 'assistant/chunk') {
      const chunk = (ev.data as { chunk?: { type?: string; usage?: Record<string, number> } })?.chunk
      if (chunk?.type === 'usage' && chunk.usage) {
        calls += 1
        freshTokens += chunk.usage.inputTokens ?? 0
        cacheReadTokens += chunk.usage.cacheReadTokens ?? 0
        outputTokens += chunk.usage.outputTokens ?? 0
        if (triggerSeq !== null && typeof ev.seq === 'number' && ev.seq > triggerSeq) {
          callsAfterTrigger += 1
        }
      }
      continue
    }

    const kind = MESSAGE_EVENT_KINDS[type]
    if (kind === undefined || typeof ev.seq !== 'number') continue
    const chars = eventChars(type, ev.data)
    const op = ev.surfaceOp
    if (op != null && typeof op === 'object' && (op as { op?: string }).op === 'replace') {
      const { start, end } = op as { start: number; end: number }
      const startIdx = order.indexOf(start)
      const endIdx = order.indexOf(end)
      if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
        for (let i = startIdx; i <= endIdx; i += 1) {
          const old = surface.get(order[i])
          if (old) {
            kindChars[old.kind] -= old.chars
            surfaceChars -= old.chars
            if (old.kind === 'tool') toolCount -= 1
            surface.delete(order[i])
          }
        }
        order.splice(startIdx, endIdx - startIdx + 1, ev.seq)
      }
    } else {
      order.push(ev.seq)
    }
    surface.set(ev.seq, { kind, chars })
    kindChars[kind] += chars
    surfaceChars += chars
    if (kind === 'tool') toolCount += 1

    if (surfaceChars > maxChars) {
      maxChars = surfaceChars
      maxSnapshot = { kindChars: { ...kindChars }, toolCount }
    }
    if (triggerSeq === null && surfaceChars / options.charsPerToken >= triggerTokens) {
      triggerSeq = ev.seq
    }
  }

  const maxContextTokens = Math.round(maxChars / options.charsPerToken)
  const toolCharsAtMax = maxSnapshot?.kindChars.tool ?? 0
  const toolResultsAtMax = maxSnapshot?.toolCount ?? 0
  const toolShareAtMax = maxChars > 0 ? toolCharsAtMax / maxChars : 0
  const clearableRatio = toolResultsAtMax > 0
    ? Math.max(0, (toolResultsAtMax - options.keep) / toolResultsAtMax)
    : 0
  const clearableTokens = Math.round((toolCharsAtMax / options.charsPerToken) * clearableRatio)

  return {
    id,
    calls,
    freshTokens,
    cacheReadTokens,
    outputTokens,
    maxContextTokens,
    toolShareAtMax,
    toolResultsAtMax,
    clearableTokens,
    callsAfterTrigger,
    pruneEvents,
    summaryEvents,
  }
}

/** Score sessions against the clearing break-even model and form a verdict. */
export function summarize(sessions: SessionStats[], options: AnalyzeOptions): Report {
  const { hit, miss } = options.prices
  const triggerTokens = options.windowTokens * options.triggerRatio
  const totalCalls = sessions.reduce((n, s) => n + s.calls, 0)
  const totalCacheRead = sessions.reduce((n, s) => n + s.cacheReadTokens, 0)
  const totalFresh = sessions.reduce((n, s) => n + s.freshTokens, 0)
  const hitRatio = totalCacheRead + totalFresh > 0
    ? totalCacheRead / (totalCacheRead + totalFresh)
    : 0

  const verdicts: SessionVerdict[] = sessions.map((s) => {
    const surviving = Math.max(0, s.maxContextTokens - s.clearableTokens)
    const eventCostUsd = (surviving * (miss - hit)) / 1e6
    const savingPerCallUsd = (s.clearableTokens * hit) / 1e6
    const paybackCalls = savingPerCallUsd > 0 ? eventCostUsd / savingPerCallUsd : Infinity
    const netUsd = s.callsAfterTrigger * savingPerCallUsd - eventCostUsd
    const eligible = s.maxContextTokens >= triggerTokens
      && s.callsAfterTrigger >= options.minRemainingCalls
      && s.clearableTokens > 0
    return {
      ...s,
      eventCostUsd,
      savingPerCallUsd,
      paybackCalls,
      netUsd,
      eligible,
      netPositive: eligible && netUsd > 0 && s.callsAfterTrigger >= 2 * paybackCalls,
    }
  }).sort((a, b) => b.cacheReadTokens - a.cacheReadTokens)

  const eligibleCache = verdicts.filter((v) => v.netPositive)
    .reduce((n, v) => n + v.cacheReadTokens, 0)
  const eligibleCacheShare = totalCacheRead > 0 ? eligibleCache / totalCacheRead : 0

  const eligibleContexts = verdicts.filter((v) => v.eligible).map((v) => v.maxContextTokens)
  const medianC = eligibleContexts.length > 0
    ? eligibleContexts.sort((a, b) => a - b)[Math.floor(eligibleContexts.length / 2)]
    : 0
  const ratio = miss / hit - 1
  const suggestedClearAtLeast = medianC > 0
    ? Math.max(50_000, Math.round((ratio * medianC) / (options.minRemainingCalls + ratio)))
    : 0

  const reasons: string[] = []
  const enable = eligibleCacheShare >= 0.3 && verdicts.some((v) => v.netPositive)
  if (verdicts.length === 0) reasons.push('no sessions with usage records found')
  if (eligibleContexts.length === 0) {
    reasons.push(`no session ever crossed the ${options.triggerRatio} trigger with enough remaining calls`)
  }
  if (eligibleCacheShare < 0.3) {
    reasons.push(`clearable net-positive sessions carry only ${(eligibleCacheShare * 100).toFixed(1)}% of cache-read spend (< 30%)`)
  } else {
    reasons.push(`net-positive sessions carry ${(eligibleCacheShare * 100).toFixed(1)}% of cache-read spend`)
  }

  return {
    options,
    sessions: sessions.length,
    totalCalls,
    totalCacheRead,
    totalFresh,
    hitRatio,
    topSessions: verdicts.slice(0, 10),
    eligibleCacheShare,
    suggestedClearAtLeast,
    enable,
    reasons,
  }
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export function render(report: Report): string {
  const { options } = report
  const lines: string[] = []
  lines.push(`clearing-fit analysis — ${report.sessions} sessions, ${report.totalCalls} calls`)
  lines.push(`  cache-read ${fmtTokens(report.totalCacheRead)} / fresh ${fmtTokens(report.totalFresh)}`
    + ` (hit ratio ${(report.hitRatio * 100).toFixed(1)}%)`)
  lines.push(`  window ${fmtTokens(options.windowTokens)}, trigger ${options.triggerRatio}`
    + ` (${fmtTokens(options.windowTokens * options.triggerRatio)}), keep ${options.keep},`
    + ` prices hit/miss $${options.prices.hit}/$${options.prices.miss} per 1M`)
  lines.push('')
  lines.push('top sessions by cache-read:')
  for (const s of report.topSessions) {
    lines.push(`  ${s.id}`)
    lines.push(`    calls ${s.calls}, cache-read ${fmtTokens(s.cacheReadTokens)},`
      + ` max ctx ~${fmtTokens(s.maxContextTokens)}, tool share ${(s.toolShareAtMax * 100).toFixed(0)}%`
      + ` (${s.toolResultsAtMax} results), clearable ~${fmtTokens(s.clearableTokens)}`)
    lines.push(`    calls after trigger ${s.callsAfterTrigger},`
      + ` event cost $${s.eventCostUsd.toFixed(3)}, saving $${s.savingPerCallUsd.toFixed(5)}/call,`
      + ` payback ${Number.isFinite(s.paybackCalls) ? Math.ceil(s.paybackCalls) : '∞'} calls,`
      + ` net $${s.netUsd.toFixed(2)} ${s.netPositive ? '✓ net-positive' : '(skip)'}`)
  }
  lines.push('')
  lines.push(`verdict: ${report.enable ? 'ENABLE' : 'HOLD'} — ${report.reasons.join('; ')}`)
  if (report.suggestedClearAtLeast > 0) {
    lines.push(`suggested clearAtLeast: ~${fmtTokens(report.suggestedClearAtLeast)} tokens`
      + ` (break-even floor at S=${options.minRemainingCalls} remaining calls)`)
  }
  return lines.join('\n')
}

/** Recursively collect session log files under a root directory. */
export function collectSessionFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === 'session.jsonl' || entry.name === 'session.jsonl.zstd') out.push(path)
    }
  }
  walk(root)
  return out.sort()
}

export function defaultSessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
}

function parseArgs(argv: string[]): { root: string; options: AnalyzeOptions } {
  const options = { ...DEFAULTS, prices: { ...DEFAULTS.prices } }
  let root: string | null = null
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = (): string => {
      i += 1
      if (i >= argv.length) throw new Error(`${arg} requires a value`)
      return argv[i]
    }
    if (arg === '--window') options.windowTokens = Number(next())
    else if (arg === '--trigger-ratio') options.triggerRatio = Number(next())
    else if (arg === '--keep') options.keep = Number(next())
    else if (arg === '--hit-price') options.prices.hit = Number(next())
    else if (arg === '--miss-price') options.prices.miss = Number(next())
    else if (arg === '--min-remaining-calls') options.minRemainingCalls = Number(next())
    else if (!arg.startsWith('--') && root === null) root = arg
    else throw new Error(`unknown argument: ${arg}`)
  }
  return { root: root ?? defaultSessionsRoot(), options }
}

export function main(argv: string[] = process.argv.slice(2)): string {
  const { root, options } = parseArgs(argv)
  const files = collectSessionFiles(root)
  const sessions: SessionStats[] = []
  for (const file of files) {
    const id = file.split('/').slice(-2).join('/')
    try {
      sessions.push(analyzeSession(id, decodeSessionFile(file), options))
    } catch (error) {
      console.error(`skip ${file}: ${String(error)}`)
    }
  }
  const report = render(summarize(sessions, options))
  console.log(report)
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
