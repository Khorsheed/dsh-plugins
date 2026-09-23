/** Generation-time text rendered through the public Markdown component. */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './live-node.ts'
import type { MemberLiveOutputs } from './live-output.ts'
import type { LivePaintDiagnostics, PaintOutcome, PaintSurface } from './live-paint.ts'
import { NS } from './locales.ts'

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
  return <section ref={element} data-member-live={id} data-live-received-at={receivedAt}>
    <small>{kind === 'think' ? t('stream.thinking') : t('stream.writing')}{recovering ? ` · ${t('stream.recovering')}` : ''}</small>
    <MarkdownText text={text} labels={{ code: { copyLabel: t('stream.copy'), copiedLabel: t('stream.copied') }, footnotes: t('stream.footnotes') }} />
  </section>
}
