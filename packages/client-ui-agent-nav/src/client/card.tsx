/**
 * The one conversation card (proposal 2026-10-30-agent-sidebar-navigation, U1):
 * every mode's write shows the same shell — where it sits (under its tool call,
 * and again in the Turn tail once the turn folds its tool calls away), its
 * frame, and its door, which always opens the answer's destination. A mode
 * only says what the card shows inside (`body`): the novel's plan and its
 * 等你确认, the game's changes. A tool with no body shows one compact line.
 *
 * Registration is structural, like every seat these plugins fill:
 * `tool.call.toolview` (keyed by tool name) and `conversation.chat.turnTail`
 * are declared by host packages the consumers do not depend on.
 *
 * @module @khorsheed/dsh-client-ui-agent-nav/client
 */
import type { ReactNode } from 'react'
import { readDestinations, stripDestinations, type ContentLike, type Destination } from '../destination.ts'
import css from './card.module.css'

/* ------------------------------------------------------------- the model */

/** A tool block as `tool.call.toolview` hands it (structural; the settled form carries content). */
export interface ToolBlockLike {
  readonly kind?: string
  readonly content?: ReadonlyArray<ContentLike>
  readonly isError?: boolean
}

/** One tool call, as a card reads it. */
export interface ToolCardModel {
  readonly state: 'running' | 'failed' | 'done'
  /** The answer without its destination lines. */
  readonly text: string
  /** Where it landed (the last destination it names), if anywhere. */
  readonly destination: Destination | undefined
}

/**
 * Read one tool block.
 * @param block - the slot's `block`.
 * @param phase - the slot's `phase` (0.1.7+ lines).
 */
export function toolCardModel(block: ToolBlockLike | null | undefined, phase?: string): ToolCardModel {
  const settled = block?.kind === 'tool-result' || (phase === 'result' && block !== null && block !== undefined)
  if (!settled) return { state: 'running', text: '', destination: undefined }
  const raw = (block?.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n')
  const text = stripDestinations(raw).trim()
  if (block?.isError === true || text.startsWith('失败：')) return { state: 'failed', text, destination: undefined }
  return { state: 'done', text, destination: readDestinations(raw).at(-1) }
}

/* ------------------------------------------------------------- the shell */

/** The words the shell needs, in the owner's language. */
export interface CardCopy {
  /** The mode's name on every card (画布, 剪辑, 图书馆…). */
  readonly kind: string
  readonly running: string
  readonly failed: string
  /** The door (查看 →). */
  readonly open: string
}

/** What a mode adds inside its card. */
export interface CardBody {
  /** The card's title line (default: the destination's label). */
  readonly title?: ReactNode
  /** A status pill at the head's end (等你确认 / 已确认). */
  readonly status?: { readonly text: string; readonly settled?: boolean } | undefined
  /** Whatever the mode shows between the head and the door. */
  readonly children?: ReactNode
  /** The card asks the person for something: the frame and the door stand out. */
  readonly awaiting?: boolean
  /** The door's words when they differ (查看并确认计划 →). */
  readonly open?: string
}

/** The shell's props. */
export interface DestinationCardProps {
  readonly copy: CardCopy
  readonly model: ToolCardModel
  /** The mode's body; undefined: the compact line. */
  readonly body?: CardBody | undefined
  /** Open the destination (the owner's `go`); undefined: no door (the panel is not composed). */
  readonly go?: ((destination: Destination) => void) | undefined
}

/** One card: the compact line, or the card with the mode's body. */
export function DestinationCard({ copy, model, body, go }: DestinationCardProps): ReactNode {
  const { destination } = model
  const door = destination !== undefined && go !== undefined
    ? (
        <button type="button" className={css.door} data-primary={body?.awaiting === true || undefined} onClick={() => { go(destination) }}>
          {body?.open ?? copy.open}
        </button>
      )
    : null
  if (model.state !== 'done' || body === undefined) {
    const said = model.state === 'running' ? copy.running
      : model.state === 'failed' ? (model.text.split('\n')[0]?.replace(/^失败：/, '') || copy.failed)
        : (destination?.label || model.text.split('\n')[0] || '')
    return (
      <div className={css.row} data-nav-card={destination?.kind} data-state={model.state}>
        <span className={css.kind}>{copy.kind}</span>
        <span className={model.state === 'failed' ? css.warn : model.state === 'running' ? css.note : css.label} title={model.text || said}>{said}</span>
        {model.state === 'done' && door}
      </div>
    )
  }
  return (
    <div className={css.card} data-nav-card={destination?.kind} data-tone={body.awaiting === true ? 'awaiting' : 'plain'}>
      <div className={css.head}>
        <span className={css.kind}>{copy.kind}</span>
        {body.status !== undefined && <span className={css.status} data-settled={body.status.settled === true || undefined}>{body.status.text}</span>}
      </div>
      <div className={css.title}>{body.title ?? destination?.label}</div>
      {body.children}
      {door}
    </div>
  )
}

/* ------------------------------------------------------- the tool row seat */

/** What an owner hands the shell: its copy, its `go`, and optionally its body. */
export interface CardFace {
  readonly copy: () => CardCopy
  readonly go: () => ((destination: Destination) => void) | undefined
  /**
   * The mode's body for one card — a hook-free function of the model is not
   * required: it renders as a component, so it may read live state. Return
   * undefined for the compact line.
   */
  readonly Body?: ((props: { readonly model: ToolCardModel; readonly destination: Destination }) => ReactNode) | undefined
}

/** The props the keyed `tool.call.toolview` seat composes. */
export type DestinationToolRowProps = CardFace & { readonly block?: ToolBlockLike | null; readonly phase?: string }

/** The row that replaces a write tool's generic row. */
export function DestinationToolRow({ block, phase, copy, go, Body }: DestinationToolRowProps): ReactNode {
  const model = toolCardModel(block, phase)
  if (Body !== undefined && model.state === 'done' && model.destination !== undefined) {
    return <Body model={model} destination={model.destination} />
  }
  return <DestinationCard copy={copy()} model={model} go={go()} />
}

/* ------------------------------------------------------- the Turn tail */

/** One write the Turn made, as the tail shows it. */
export interface TurnCardItem {
  readonly key: string
  readonly seq: number
  readonly model: ToolCardModel
}

interface EventLike { readonly type: string; readonly seq?: number; readonly surfaceOp?: unknown; readonly data?: unknown }
interface TurnState { readonly turn: number; readonly calls: ReadonlySet<string>; readonly items: readonly TurnCardItem[] }

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null

/**
 * The Conversation Definition that folds one owner's write answers into Turn
 * data (a finished Turn folds its tool rows, card and all, so the tail shows
 * them again beneath the closing prose). Read from the persisted results: a
 * replayed session shows the same cards. A place written twice shows once, as
 * its latest answer.
 * @param key - the Turn-data key (one per owner).
 * @param tools - the tool names whose answers it keeps.
 */
export function destinationTurnDefinition(key: string, tools: readonly string[]) {
  const names = new Set(tools)
  const turnOf = (event: EventLike): number | null => {
    const turn = record(event.data)?.['turn']
    return typeof turn === 'number' ? turn : null
  }
  return {
    kind: key,
    match(event: EventLike): { id: string; role: 'start' | 'update' } | null {
      const turn = turnOf(event)
      if (turn === null) return null
      if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
      if (event.type === 'tool/call') return { id: String(turn), role: 'update' }
      if (event.type === 'tool/result' && event.surfaceOp === 'append') return { id: String(turn), role: 'update' }
      return null
    },
    start(_context: unknown, match: { readonly event: EventLike }): TurnState {
      return { turn: turnOf(match.event) ?? -1, calls: new Set(), items: [] }
    },
    update(context: { readonly state: TurnState }, match: { readonly event: EventLike }): TurnState {
      const { event } = match
      const data = record(event.data)
      if (data === null) return context.state
      if (event.type === 'tool/call') {
        if (!names.has(String(data['name']))) return context.state
        return { ...context.state, calls: new Set([...context.state.calls, String(data['callId'])]) }
      }
      const message = record(data['message'])
      if (message === null || !context.state.calls.has(String(record(message['source'])?.['callId']))) return context.state
      const model = toolCardModel({
        kind: 'tool-result',
        content: Array.isArray(message['content']) ? message['content'] as ContentLike[] : [],
        isError: message['isError'] === true,
      })
      if (model.state !== 'done' || model.destination === undefined) return context.state
      const itemKey = `${model.destination.kind}:${JSON.stringify(model.destination.params)}`
      const item: TurnCardItem = { key: itemKey, seq: typeof event.seq === 'number' ? event.seq : 0, model }
      return { ...context.state, items: [...context.state.items.filter(row => row.key !== itemKey), item] }
    },
    buildLocationData(
      context: { readonly state: TurnState | undefined },
      scope: string,
      previous: { kind: 'turn'; turn: number; key: string; value: { items: readonly TurnCardItem[] } } | null | undefined,
    ) {
      if (scope !== 'turn' || context.state === undefined) return null
      if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === key
        && previous.value.items === context.state.items) return previous
      return { kind: 'turn' as const, turn: context.state.turn, key, value: { items: context.state.items } }
    },
  }
}

/** The Turn-tail owner props this entry reads (ui-chat's `TurnTailOwnerProps`, structurally). */
export interface TurnOwnerLike {
  readonly turn: { readonly data: { get: (key: string) => unknown }; readonly end?: { readonly seq: number } | null }
  readonly seq?: number
}

/**
 * The items one Turn holds under `key`, bounded by the Turn's own end.
 * @param owner - the Turn-tail owner props.
 * @param key - the Turn-data key.
 */
export function turnCardItems(owner: TurnOwnerLike | null | undefined, key: string): readonly TurnCardItem[] {
  try {
    const items = record(owner?.turn.data.get(key))?.['items']
    if (!Array.isArray(items)) return []
    const bound = owner?.turn.end?.seq ?? owner?.seq ?? Number.POSITIVE_INFINITY
    return (items as TurnCardItem[]).filter(item => item.seq <= bound)
  } catch {
    return []
  }
}

/** The props of an owner's Turn-tail entry: ui-chat's owner props plus the face and the key. */
export type DestinationTurnTailProps = CardFace & TurnOwnerLike & { readonly turnKey: string }

/** The Turn tail: every place the Turn wrote, as its cards, beneath the closing prose. Never opens anything itself. */
export function DestinationTurnTail(props: DestinationTurnTailProps): ReactNode {
  const items = turnCardItems(props, props.turnKey)
  if (items.length === 0) return null
  const { Body } = props
  return (
    <div className={css.tail}>
      {items.map(item => Body !== undefined && item.model.destination !== undefined
        ? <Body key={item.key} model={item.model} destination={item.model.destination} />
        : <DestinationCard key={item.key} copy={props.copy()} model={item.model} go={props.go()} />)}
    </div>
  )
}

/* ------------------------------------------------------- registration */

/** The slot registry, structurally (the seats are declared by host packages the consumers do not depend on). */
export interface SlotsLike {
  inject: (key: string, callback: () => () => void) => () => void
  register: (options: Record<string, unknown>, component: unknown) => () => void
}

/** Conversation events, structurally (`uiConversation.events`). */
export interface ConversationLike { readonly events?: { register?: (definition: unknown) => () => void } }

/**
 * Seat one owner's cards: a row under each of its write tools, and its Turn
 * tail. Each registration rides `slots.inject`, so a composition without the
 * seat simply has none.
 * @param effect - the context's `ctx.effect` (owns the registrations' lifetime).
 * @param slots - the slot registry.
 * @param conversation - reads `uiConversation` once the tail seat exists.
 * @param options - the owner's id, tool names, locale namespace and face.
 */
export function registerDestinationCards(
  effect: (body: () => () => void, label: string) => void,
  slots: SlotsLike,
  conversation: () => ConversationLike | undefined,
  options: { readonly owner: string; readonly tools: readonly string[]; readonly locale?: string; readonly face: () => CardFace; readonly order?: number },
): void {
  const { owner, tools, locale, face } = options
  for (const tool of tools) {
    effect(() => slots.inject('tool.call.toolview', () => slots.register({
      name: 'tool.call.toolview',
      key: tool,
      ...(locale === undefined ? {} : { locale }),
      inject: face,
    }, DestinationToolRow)), `${owner}: ${tool} card`)
  }
  const turnKey = `${owner}/cards`
  effect(() => slots.inject('conversation.chat.turnTail', () => {
    const events = conversation()?.events
    if (events?.register === undefined) return () => undefined
    const disposeDefinition = events.register.call(events, destinationTurnDefinition(turnKey, tools))
    const disposeEntry = slots.register({
      name: 'conversation.chat.turnTail',
      id: turnKey,
      order: options.order ?? 40,
      ...(locale === undefined ? {} : { locale }),
      inject: () => ({ ...face(), turnKey }),
    }, DestinationTurnTail)
    return () => { disposeEntry(); disposeDefinition() }
  }), `${owner}: turn-tail cards`)
}
