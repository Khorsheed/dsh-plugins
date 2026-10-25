/**
 * Member speech node ('room-speech' keyed renderer): a conversation entry —
 * the member's color avatar beside a light card that blocks off one member's
 * turn (several agents take turns in a room, so each turn reads as its own
 * block): a header (name, public role, provider, time), the markdown body —
 * the official MarkdownText, typographically identical to main-agent speech —
 * and a quiet footer row. A
 * body past {@link COLLAPSE_CHARS} may fold to ~10 lines under a bg-base fade
 * with an expand/collapse toggle (the fade expands too). The newest reply to
 * the room starts unfolded — it is what the human is reading — and folds once
 * a newer reply lands; reports to another member and older replies start
 * folded. The human's own expand/collapse wins and is remembered per speech
 * (see {@link foldChoices}). The action row replicates the
 * official MessageIconActions chrome: copy, child-session jump (when the
 * speech carries its handle), honest duration, and a hover-revealed clock.
 * Deliberately absent: branch (forking the room session has undefined
 * roster/blackboard semantics) and TPS/TTFT (a CLI run has no token stream).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { MarkdownText, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconCopyOutlineMedium, IconLinkOutlineMedium, IconRequestDetailOutlineMedium } from './icons.tsx'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { memberColor } from './member-color.ts'
import { formatClock, formatDurationMs } from './format.ts'
import { formatTokens } from './RoomStatsLine.tsx'
import type { RoomSpeechViewProps } from './slots.ts'
import type { RoomExecution } from '../types.ts'
import css from './RoomSpeechView.module.css'

/**
 * Speeches longer than this start collapsed. Chars, not rendered lines: a
 * stable threshold that needs no layout measurement — roughly ten rendered
 * lines of prose.
 */
const COLLAPSE_CHARS = 600

/** Browser storage key of one room's remembered expand/collapse choices. */
const FOLD_KEY_PREFIX = 'dsh-room:speech-fold:'
/** Choices kept per room (newest speeches win): bounds the stored map. */
const FOLD_KEEP = 200

/**
 * The human's expand/collapse choices for one room's speeches, by speech seq.
 * A per-viewer convenience in browser storage: unreadable storage (private
 * window, blocked site data) only means the default folding applies.
 */
export const foldChoices = {
  read(sessionId: string): Record<string, boolean> {
    try {
      const raw = globalThis.localStorage?.getItem(FOLD_KEY_PREFIX + sessionId)
      const parsed: unknown = raw == null ? undefined : JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, boolean> : {}
    } catch { return {} }
  },
  write(sessionId: string, seq: number, expanded: boolean): void {
    try {
      const choices = { ...foldChoices.read(sessionId), [String(seq)]: expanded }
      const kept = Object.keys(choices).map(Number).sort((a, b) => b - a).slice(0, FOLD_KEEP)
      globalThis.localStorage?.setItem(FOLD_KEY_PREFIX + sessionId, JSON.stringify(Object.fromEntries(kept.map(key => [key, choices[key]]))))
    } catch { /* a convenience: never fail the view */ }
  },
}

/** Localized Markdown chrome (code-fence copy buttons, footnotes) over the room namespace. */
function markdownLabels(t: RoomSpeechViewProps['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('action.copy'), copiedLabel: t('action.copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/** The member speech row. */
export function RoomSpeechView({ node, sessionId, roomStore, openSession, openDetail, t }: RoomSpeechViewProps): ReactNode {
  const data = node.data
  const [copied, setCopied] = useState(false)
  // The human's own choice for this speech (remembered), else the default.
  const [chosen, setChosen] = useState<boolean | undefined>(() => foldChoices.read(sessionId)[String(node.data.seq)])
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const member = state?.members.find(entry => entry.name === data.member)
  const provider = member === undefined
    ? undefined
    : member.kind === 'main-agent' ? t('member.kind.main') : member.provider
  const child = data.childSessionId
  // The run's billed tokens, as the host's 用量 chip shows them (recorded
  // when the run settles; absent for runs the producer reported none for).
  const execution = data.runId === undefined ? undefined : state?.executions?.find(entry => entry.id === data.runId)
  const tokens = execution?.tokens
  // The newest speech keeps its action row shown; older rows reveal on hover
  // (the host's turn-tail rule). A speech newer than the cached state's is the newest.
  const newestSpeech = data.seq >= (state?.latestSpeechSeq ?? data.seq)
  const collapsible = data.text.length > COLLAPSE_CHARS
  // The newest reply to the room reads unfolded. A reply newer than the
  // cached state's (the refresh is debounced) is the newest already.
  const newestReply = data.reportedTo === undefined && data.seq >= (state?.latestReplySeq ?? data.seq)
  const expanded = chosen ?? newestReply
  const clamped = collapsible && !expanded
  const toggle = (next: boolean): void => {
    setChosen(next)
    foldChoices.write(sessionId, data.seq, next)
  }
  const labels = useMemo(() => markdownLabels(t), [t])

  const copy = (): void => {
    void writeClipboard(data.text).then((ok) => {
      if (!ok) return
      setCopied(true)
      copyTimer.current = setTimeout(() => { setCopied(false) }, 1000)
    })
  }

  const color = memberColor(data.member)
  return (
    <div className={css.speech} data-time-hover-root="" data-actions-reveal={newestSpeech ? 'always' : 'hover'} style={{ '--member-color': color } as CSSProperties}>
      <span className={css.avatar} aria-hidden>{data.member.slice(0, 1).toUpperCase()}</span>
      <div className={css.stack}>
      <div className={css.card}>
      <div className={css.identity}>
        <span className={css.name}>{data.member}</span>
        {member?.role !== undefined && <span className={css.role}>{member.role}</span>}
        {provider !== undefined && provider !== '' && <span className={css.provider}>{provider}</span>}
        {data.interrupted !== undefined && <span className={css.interrupted}>{t(data.interrupted === 'cancelled' ? 'speech.stopped' : 'speech.failed')}</span>}
      </div>
      <div className={clamped ? `${css.body} ${css.clamped}` : css.body}>
        <MarkdownText text={data.text} labels={labels} />
        {clamped && <div className={css.fade} aria-hidden onClick={() => { toggle(true) }} />}
        {/* message-tools' fold control, shared look: a small chevron seated in
            the body's bottom-right corner (over the fade while folded). */}
        {collapsible && (
          <div className={css.foldBar}>
            <Tooltip label={expanded ? t('speech.collapse') : t('speech.expand')} side="bottom">
              <button
                type="button"
                className={css.foldToggle}
                aria-label={expanded ? t('speech.collapse') : t('speech.expand')}
                aria-expanded={expanded}
                onClick={() => { toggle(!expanded) }}
              >
                <IconChevronDownOutlineMedium />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {data.reportedTo !== undefined && (
        <span className={css.reported}>{t('speech.reportedTo', { member: data.reportedTo })}</span>
      )}
      </div>
      {/* The host's message action row, outside the card: copy, the member's
          session, its request details, usage (hover for the breakdown), time. */}
      <div className={css.actions}>
        <Tooltip label={copied ? t('action.copied') : t('action.copy')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={copied ? t('action.copied') : t('action.copy')}
            onClick={copy}
          >
            {copied ? <IconCheckOutlineMedium /> : <IconCopyOutlineMedium />}
          </button>
        </Tooltip>
        {child !== undefined && (
          <Tooltip label={t('speech.jump')} side="bottom">
            <button
              type="button"
              className={css.action}
              aria-label={t('speech.jump')}
              onClick={() => { openSession(child) }}
            >
              <IconLinkOutlineMedium />
            </button>
          </Tooltip>
        )}
        {child !== undefined && data.messageId !== undefined && openDetail !== undefined && (
          <Tooltip label={t('speech.detail')} side="bottom">
            <button
              type="button"
              className={css.action}
              aria-label={t('speech.detail')}
              onClick={() => { openDetail(child, data.messageId!, data.member) }}
            >
              <IconRequestDetailOutlineMedium />
            </button>
          </Tooltip>
        )}
        {tokens !== undefined && tokens > 0
          ? <UsageChip tokens={tokens} execution={execution} provider={member?.kind === 'cli' ? member.provider : undefined} durationMs={data.durationMs} t={t} />
          : data.durationMs !== undefined && <span className={css.meta}>{formatDurationMs(data.durationMs)}</span>}
        <span className={css.meta}>{formatClock(data.time)}</span>
      </div>
      </div>
    </div>
  )
}

/**
 * 用量 with its breakdown on hover or focus — the host's turn usage panel:
 * total, provider / model, cache hit, the disjoint input buckets, output, and
 * this round's run time. Rows the harness did not report are left out.
 */
function UsageChip({ tokens, execution, provider, durationMs, t }: {
  readonly tokens: number
  readonly execution: RoomExecution | undefined
  readonly provider: string | undefined
  readonly durationMs: number | undefined
  readonly t: RoomSpeechViewProps['t']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const usage = execution?.usage
  const billed = usage === undefined ? 0 : usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  const exact = (n: number): string => n.toLocaleString('en-US')
  const route = [provider, execution?.model].filter(Boolean).join('/')
  const rows: [string, string][] = [
    ...route === '' ? [] : [[t('usage.route'), route] as [string, string]],
    ...usage !== undefined && billed > 0 ? [[t('usage.cacheHit'), `${Math.round((usage.cacheReadTokens ?? 0) / billed * 1000) / 10}%`] as [string, string]] : [],
    ...usage === undefined ? [] : [
      [t('usage.uncached'), `${exact(usage.inputTokens)} tok`],
      ...usage.cacheReadTokens === undefined ? [] : [[t('usage.cacheRead'), `${exact(usage.cacheReadTokens)} tok`]],
      ...usage.cacheWriteTokens === undefined ? [] : [[t('usage.cacheWrite'), `${exact(usage.cacheWriteTokens)} tok`]],
      [t('usage.output'), `${exact(usage.outputTokens)} tok`],
    ] as [string, string][],
    ...durationMs === undefined ? [] : [[t('usage.duration'), formatDurationMs(durationMs)] as [string, string]],
  ]
  return (
    <span className={css.usage} onMouseEnter={() => { setOpen(true) }} onMouseLeave={() => { setOpen(false) }}>
      <button type="button" className={css.usageChip} aria-expanded={open} onFocus={() => { setOpen(true) }} onBlur={() => { setOpen(false) }}>
        {t('speech.usage', { tokens: formatTokens(tokens) })}
      </button>
      {open && (
        <span className={css.usagePanel} role="tooltip">
          <span className={css.usageHead}><span>{t('usage.title')}</span><span>{exact(tokens)} tok</span></span>
          {rows.map(([label, value]) => <span key={label} className={css.usageRow}><span>{label}</span><span>{value}</span></span>)}
        </span>
      )}
    </span>
  )
}
