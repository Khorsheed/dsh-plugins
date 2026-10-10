/**
 * The game's rows in the conversation (proposal option B): the messages the
 * plugin puts into a turn — check findings steered back to the agent, and
 * the panel changes attached to a send — are `dsh-game`-sourced user
 * messages, which the official chat view projects as hidden `context` nodes.
 * This Definition projects the same events into our own node kind and a
 * keyed `conversation.chat.node` renderer draws them as one collapsible row:
 * red 「检查未通过 1/2」 with the findings, grey 「已附上」 with the items.
 * The official node stays hidden, so nothing renders twice (the
 * message-tools restored-row precedent).
 */
import { useState, type ReactNode } from 'react'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
// Type-only: ui-chat's SlotMap merge ('conversation.chat.node').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from './locales.ts'
import css from './ChatRow.module.css'

/** The chat node kind (also the renderer's key). */
export const GAME_CHAT_KIND = 'dsh-game-message'

/** What the row needs from the persisted message. */
export interface GameChatData {
  readonly seq: number
  readonly time: number
  readonly op: 'check-failed' | 'attached' | 'other'
  readonly attempt: number
  readonly cap: number
  readonly failures: readonly { readonly where: string; readonly message: string }[]
  readonly items: readonly string[]
  readonly text: string
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'dsh-game-message': GameChatData
  }
}

/** Whether a message source is ours. */
function isGameSource(source: unknown): source is Record<string, unknown> {
  return (source as { kind?: unknown } | null)?.kind === 'dsh-game'
}

/** The source's structured part, defensively. */
function dataOf(seq: number, time: number, source: Record<string, unknown>, content: readonly unknown[]): GameChatData {
  const text = content.map(block => (block as { type?: string; text?: string }).type === 'text' ? (block as { text: string }).text : '').join('\n')
  const op = source.op === 'check-failed' || source.op === 'attached' ? source.op : 'other'
  const failures = Array.isArray(source.failures)
    ? source.failures.filter((f): f is { where: string; message: string } => typeof f?.where === 'string' && typeof f.message === 'string')
    : []
  const items = Array.isArray(source.items) ? source.items.filter((i): i is string => typeof i === 'string') : []
  return {
    seq, time, op, text, failures, items,
    attempt: typeof source.attempt === 'number' ? source.attempt : 0,
    cap: typeof source.cap === 'number' ? source.cap : 2,
  }
}

/** The projection: every appended `dsh-game` user message becomes one row. */
export const gameMessageDefinition: ConversationNodeDefinition<GameChatData> = {
  kind: GAME_CHAT_KIND,
  target: 'chat',
  match: (event) => {
    if (event.type !== 'user/message' || !isAppendSurfaceEvent(event) || !isGameSource(event.data.source)) return null
    return { id: String(event.seq), role: 'start' }
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'user/message' || !isGameSource(event.data.source)) throw new Error('dsh-game row requires a dsh-game message')
    return dataOf(event.seq, event.time, event.data.source, event.data.content)
  },
  update: context => context.state,
  buildViewNode: (context: ConversationNodeContext<GameChatData>): ChatConversationViewNode | null => context.state === undefined
    ? null
    : {
        key: context.key,
        kind: GAME_CHAT_KIND,
        id: context.id,
        target: 'chat',
        anchorSeq: context.state.seq,
        location: context.start?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        data: context.state,
      } as ChatConversationViewNode,
}

/** Props of the row renderer. */
export type GameChatRowProps = PropsRuntime<'conversation.chat.node', 'dsh-game-message'> & PropsLocale<'game'>

/** The collapsible row. */
export function GameChatRow({ node, t }: GameChatRowProps): ReactNode {
  const data = node.data
  const [open, setOpen] = useState(false)
  if (data.op === 'attached') {
    return <div className={css.wrap} data-tone="muted" data-align="end">
      <button type="button" className={css.head} aria-expanded={open} onClick={() => { setOpen(o => !o) }}>
        <span className={css.dot} aria-hidden="true" />
        <span className={css.title}>{t('chat.attached', { count: data.items.length })}</span>
        <span className={css.summary}>{data.items.slice(0, 2).join(' · ')}{data.items.length > 2 ? ' …' : ''}</span>
        <span className={css.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <ul className={css.list}>{data.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}
    </div>
  }
  if (data.op === 'check-failed') {
    const last = data.attempt >= data.cap
    return <div className={css.wrap} data-tone={last ? 'warn' : 'error'}>
      <button type="button" className={css.head} aria-expanded={open} onClick={() => { setOpen(o => !o) }}>
        <span className={css.dot} aria-hidden="true" />
        <span className={css.title}>{t('chat.checkFailed', { attempt: data.attempt, cap: data.cap })}</span>
        <span className={css.summary}>{data.failures[0] === undefined ? '' : `${data.failures[0].where}：${data.failures[0].message}`}</span>
        <span className={css.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className={css.body}>
        <ul className={css.list}>{data.failures.map((f, i) => <li key={i}><code>{f.where}</code><span>{f.message}</span></li>)}</ul>
        <p className={css.note}>{last ? t('chat.lastAttempt') : t('chat.fixing')}</p>
      </div>}
    </div>
  }
  return <div className={css.wrap} data-tone="muted">
    <button type="button" className={css.head} aria-expanded={open} onClick={() => { setOpen(o => !o) }}>
      <span className={css.dot} aria-hidden="true" />
      <span className={css.title}>{t('chat.other')}</span>
      <span className={css.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
    </button>
    {open && <pre className={css.pre}>{data.text}</pre>}
  </div>
}
