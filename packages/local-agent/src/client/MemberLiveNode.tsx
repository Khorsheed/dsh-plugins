/** Generation-time text rendered through the public Markdown component. */
import { useSyncExternalStore } from 'react'
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
  return <section data-member-live={data.id} data-live-received-at={live?.receivedAt}>
    <small>{data.kind === 'think' ? t('stream.thinking') : t('stream.writing')}{live === undefined || !snapshot.connected ? ` · ${t('stream.recovering')}` : ''}</small>
    <MarkdownText text={text} labels={{ code: { copyLabel: t('stream.copy'), copiedLabel: t('stream.copied') }, footnotes: t('stream.footnotes') }} />
  </section>
}
