import type { ReactNode } from 'react'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { evalLifecycleNoticeOf, type EvalLifecycleNotice } from '../lifecycle-record.ts'
import css from './LifecycleNotice.module.css'

export const EVAL_NOTICE_KIND = 'eval-lifecycle-notice'

export interface EvalNoticeData extends EvalLifecycleNotice {
  readonly seq: number
  readonly time: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'eval-lifecycle-notice': EvalNoticeData
  }
}

export const evalLifecycleDefinition: ConversationNodeDefinition<EvalNoticeData> = {
  kind: EVAL_NOTICE_KIND,
  target: 'chat',
  match: event => evalLifecycleNoticeOf(event) === undefined ? null : { id: evalLifecycleNoticeOf(event)!.dedupeKey, role: 'start' },
  start: (_context, match) => evalLifecycleNoticeOf(match.event)!,
  update: (context, match) => evalLifecycleNoticeOf(match.event) ?? context.state,
  buildViewNode: (context: ConversationNodeContext<EvalNoticeData>): ChatConversationViewNode | null => context.state === undefined
    ? null
    : {
        key: context.key,
        kind: EVAL_NOTICE_KIND,
        id: context.id,
        target: 'chat',
        anchorSeq: context.state.seq,
        location: context.start?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        groupTree: 'turn',
        data: context.state,
      },
}

export type EvalLifecycleNoticeProps = PropsRuntime<'conversation.chat.node', 'eval-lifecycle-notice'> & PropsLocale<typeof NS> & {
  readonly openExperiment: (experimentId: string) => void
}

export function EvalLifecycleNoticeRow({ node, openExperiment, t }: EvalLifecycleNoticeProps): ReactNode {
  const data = node.data
  const label = t(`lifecycle.${data.stage}`, { title: data.title })
  return <div className={css.notice} data-stage={data.stage}>
    <span className={css.text}>{label}</span>
    {data.experimentId !== null && <button type="button" className={css.open} onClick={() => { openExperiment(data.experimentId!) }}>
      {t('lifecycle.open')}
    </button>}
  </div>
}
