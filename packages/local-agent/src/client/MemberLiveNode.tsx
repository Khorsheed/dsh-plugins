/** Generation-time text rendered through the public Markdown component. */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './live-node.ts'
import type { MemberLiveOutputs } from './live-output.ts'
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
      <StreamText key={item.id} {...item} recovering={!snapshot.connected} t={t} />
    ))}
  </div>
}

/** Local diagnostics only. Two animation frames bound a foreground paint from above.
 * The wall-clock subtraction is meaningful only when browser and host share a clock.
 * Keep independent callbacks across updates so slow paints cannot disappear from P95.
 */
function StreamText({ id, kind, text, receivedAt, recovering, t }: {
  id: string; kind: 'think' | 'text'; text: string; receivedAt?: number | undefined; recovering: boolean
} & PropsLocale<typeof NS>) {
  const element = useRef<HTMLElement>(null)
  const samples = useRef<number[]>([])
  const frames = useRef(new Set<number>())
  useEffect(() => () => {
    for (const frame of frames.current) cancelAnimationFrame(frame)
    frames.current.clear()
  }, [])
  useLayoutEffect(() => {
    if (receivedAt === undefined || document.visibilityState !== 'visible') return
    const first = requestAnimationFrame(() => {
      frames.current.delete(first)
      const second = requestAnimationFrame(() => {
        frames.current.delete(second)
        if (element.current === null || document.visibilityState !== 'visible') return
        const elapsed = Date.now() - receivedAt
        if (elapsed < 0) return // Different clocks cannot establish a latency claim.
        samples.current.push(elapsed)
        if (samples.current.length > 256) samples.current.shift()
        element.current.dataset.livePaintSamples = JSON.stringify(samples.current)
      })
      frames.current.add(second)
    })
    frames.current.add(first)
  }, [receivedAt])
  return <section ref={element} data-member-live={id} data-live-received-at={receivedAt}>
    <small>{kind === 'think' ? t('stream.thinking') : t('stream.writing')}{recovering ? ` · ${t('stream.recovering')}` : ''}</small>
    <MarkdownText text={text} labels={{ code: { copyLabel: t('stream.copy'), copiedLabel: t('stream.copied') }, footnotes: t('stream.footnotes') }} />
  </section>
}
