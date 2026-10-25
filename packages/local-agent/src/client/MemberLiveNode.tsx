/** Generation-time text rendered through the public Markdown component. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { DisclosureRow, MarkdownText, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconThinkOutlineRegular } from './icons.tsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './live-node.ts'
import type { MemberLiveOutputs } from './live-output.ts'
import type { LivePaintDiagnostics, PaintOutcome, PaintSurface } from './live-paint.ts'
import { NS } from './locales.ts'
import css from './MemberLiveOutput.module.css'

export type MemberLiveNodeProps = PropsRuntime<'conversation.chat.node', 'local-agent-stream'>
  & PropsLocale<typeof NS> & { outputs: MemberLiveOutputs }

export function MemberLiveNode({ node, outputs, t }: MemberLiveNodeProps) {
  const data = node.data
  const store = outputs.get(data.sessionId)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const live = snapshot.items.get(data.id)
  const text = live?.text ?? data.text
  return <StreamText id={data.id} kind={live?.kind ?? data.kind} text={text} receivedAt={live?.receivedAt}
    sessionId={data.sessionId} turn={live?.turn ?? data.turn} revision={live?.revision} baseline={live?.baseline ?? true} surface="member" diagnostics={outputs.diagnostics}
    recovering={live === undefined || !snapshot.connected} t={t} />
}

/** Same subscription in Room: run boundary excludes retained output from earlier turns. */
export function MemberLiveOutputView({ sessionId, startedAt, outputs, t }: {
  sessionId: string
  startedAt: number
  outputs: MemberLiveOutputs
} & PropsLocale<typeof NS>) {
  const store = outputs.get(sessionId)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <div data-member-output={sessionId}>
    {[...snapshot.items.values()].filter(item => item.receivedAt >= startedAt).map(item => (
      <StreamText key={item.id} {...item} sessionId={sessionId} surface="room" diagnostics={outputs.diagnostics} recovering={!snapshot.connected} t={t} />
    ))}
  </div>
}

/** Local diagnostics only. Two animation frames bound a foreground paint from above.
 * The wall-clock subtraction is meaningful only when browser and host share a clock.
 * Keep independent callbacks across updates so slow paints cannot disappear from P95.
 */
/** The latest completed paragraph's first line — the host think row's running summary. */
function latestParagraphLine(text: string): string {
  let summary = ''
  let start = 0
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g
  while (true) {
    const next = separator.exec(text)
    const end = next === null ? text.length : next.index + next[0].indexOf('\n')
    const newline = text.indexOf('\n', start)
    if (newline !== -1 && newline <= end) {
      const candidate = text.slice(start, newline).trim()
      if (candidate !== '') summary = candidate
    }
    if (next === null) return summary
    start = next.index + next[0].length
  }
}

/**
 * A streaming think block drawn as the host's own think row: collapsed to one
 * line (icon, title, the latest paragraph's first line shimmering), the full
 * text on expand — the same row the settled message shows once it lands.
 */
function LiveReasoning({ text, labels, title }: { text: string; labels: Parameters<typeof MarkdownText>[0]['labels']; title: string }) {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => (latestParagraphLine(text) || text.split('\n', 1)[0] || '').replaceAll('**', ''), [text])
  return (
    <DisclosureRow
      rowClassName={css.thinkRow}
      leadingClassName={css.leading}
      titleClassName={css.title}
      icon={<IconThinkOutlineRegular size={14} />}
      title={title}
      running
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={open || summary === '' ? undefined : <>
        <span className={css.separator} aria-hidden />
        <span className={css.summary}><TextShimmer>{summary}</TextShimmer></span>
      </>}
    >
      {open ? <div className={css.thinkBody}><MarkdownText text={text} labels={labels} /></div> : undefined}
    </DisclosureRow>
  )
}

function StreamText({ id, kind, text, receivedAt, recovering, sessionId, turn, revision, baseline, surface, diagnostics, t }: {
  id: string; kind: 'think' | 'text'; text: string; receivedAt?: number | undefined; recovering: boolean
  sessionId: string; turn: number; revision?: number | undefined; baseline: boolean; surface: PaintSurface; diagnostics: LivePaintDiagnostics
} & PropsLocale<typeof NS>) {
  const element = useRef<HTMLElement>(null)
  const samples = useRef<number[]>([])
  const frames = useRef(new Set<number>())
  const unfinished = useRef(new Set<(outcome: Exclude<PaintOutcome, 'pending'>, now: number) => void>())
  useEffect(() => () => {
    for (const frame of frames.current) cancelAnimationFrame(frame)
    frames.current.clear()
    for (const complete of unfinished.current) complete('unmounted', Date.now())
    unfinished.current.clear()
  }, [])
  useLayoutEffect(() => {
    if (receivedAt === undefined || revision === undefined || baseline) return
    const complete = diagnostics.begin(sessionId, turn, revision, surface)
    if (complete === undefined) return
    if (document.visibilityState !== 'visible') { complete('hidden', Date.now()); return }
    unfinished.current.add(complete)
    const first = requestAnimationFrame(() => {
      frames.current.delete(first)
      const second = requestAnimationFrame(() => {
        frames.current.delete(second)
        unfinished.current.delete(complete)
        if (element.current === null) { complete('unmounted', Date.now()); return }
        if (document.visibilityState !== 'visible') { complete('hidden', Date.now()); return }
        complete('painted', Date.now())
        const elapsed = Date.now() - receivedAt
        if (elapsed < 0) return // Different clocks cannot establish a latency claim.
        samples.current.push(elapsed)
        if (samples.current.length > 256) samples.current.shift()
        element.current.dataset.livePaintSamples = JSON.stringify(samples.current)
      })
      frames.current.add(second)
    })
    frames.current.add(first)
  }, [receivedAt, revision, baseline, diagnostics, sessionId, turn, surface])
  const labels = { code: { copyLabel: t('stream.copy'), copiedLabel: t('stream.copied') }, footnotes: t('stream.footnotes') }
  return <section ref={element} className={css.item} data-member-live={id} data-live-received-at={receivedAt}>
    {kind === 'think'
      ? <LiveReasoning text={text} labels={labels} title={t('stream.thinking')} />
      : <div className={css.text}><MarkdownText text={text} labels={labels} /></div>}
    {recovering && <span className={css.recovering}>{t('stream.recovering')}</span>}
  </section>
}
