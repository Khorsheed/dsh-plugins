/**
 * The one conversation card (proposal 2026-10-30-agent-sidebar-navigation, U1):
 * every mode's write shows the same fixed shell — where it sits (under its tool
 * call, and again in the Turn tail once the turn folds its tool calls away), its
 * look, and its door, which always opens the answer's destination. A plugin
 * only hands data: the label, and optionally a status and the door's words
 * with the write (the destination line's `card`), later `updateCards` when the
 * person changes that state in the panel. It draws nothing; the richness is in
 * the panel the door opens. A plugin that stops calling simply has no card.
 *
 * Registration is structural, like every seat these plugins fill:
 * `tool.call.toolview` (keyed by tool name) and `conversation.chat.turnTail`
 * are declared by host packages the consumers do not depend on.
 *
 * @module @khorsheed/dsh-client-ui-agent-nav/client
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { readDestinations, stripDestinations, type ContentLike, type Destination, type DestinationCardData } from '../destination.ts'
import { cardStateOf, cardsVersion, subscribeCards, subscribeWrites } from './follow.ts'
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
  /** The Turn-tail summary's title when the Turn wrote several places (本轮写入). */
  readonly turnTitle?: string
}

/** The shell's props. */
export interface DestinationCardProps {
  readonly copy: CardCopy
  readonly model: ToolCardModel
  /** Open the destination (the owner's `go`); undefined: no door (the panel is not composed). */
  readonly go?: ((destination: Destination) => void) | undefined
}

/** The card data of one destination, live: re-renders when the follower or `updateCards` moves it. */
function useCardState(destination: Destination | undefined): { live: boolean; card: DestinationCardData } {
  useSyncExternalStore(subscribeCards, cardsVersion, cardsVersion)
  return destination === undefined ? { live: false, card: {} } : cardStateOf(destination)
}

/**
 * The one card: the mode, the label, a status while the write is live on this
 * page (a replayed card has none — what holds now is in the panel), and the
 * door. The plugin decides none of the look; it only handed the data.
 */
export function DestinationCard({ copy, model, go }: DestinationCardProps): ReactNode {
  const { destination } = model
  const { live, card } = useCardState(destination)
  const status = live ? card.status : undefined
  const awaiting = live && card.awaiting === true
  const said = model.state === 'running' ? copy.running
    : model.state === 'failed' ? (model.text.split('\n')[0]?.replace(/^失败：/, '') || copy.failed)
      : (destination?.label || model.text.split('\n')[0] || '')
  return (
    <div className={css.row} data-nav-card={destination?.kind} data-state={model.state} data-awaiting={awaiting || undefined}>
      <span className={css.kind}>{copy.kind}</span>
      <span className={model.state === 'failed' ? css.warn : model.state === 'running' ? css.note : css.label} title={model.text || said}>{said}</span>
      {status !== undefined && <span className={css.status} data-settled={card.awaiting !== true || undefined}>{status}</span>}
      {model.state === 'done' && destination !== undefined && go !== undefined && (
        <button type="button" className={css.door} data-primary={awaiting || undefined} onClick={() => { go(destination) }}>
          {(live ? card.door : undefined) ?? copy.open}
        </button>
      )}
    </div>
  )
}

/** One line of a summary card: what changed, and where it is. */
export interface SummaryRow {
  readonly label: string
  readonly destination?: Destination | undefined
}

/** A mode's summary of one Turn (the game's 本轮改动): a title and its lines. */
export interface TurnSummary {
  readonly title: string
  readonly rows: readonly SummaryRow[]
}

/** The summary card: the same shell, one line per change, each with its door. */
export function SummaryCard({ copy, summary, go }: { readonly copy: CardCopy; readonly summary: TurnSummary; readonly go?: ((destination: Destination) => void) | undefined }): ReactNode {
  return (
    <div className={css.multi} data-nav-card="summary">
      <div className={css.head}>
        <span className={css.kind}>{copy.kind}</span>
        <span className={css.label}>{summary.title}</span>
      </div>
      {summary.rows.map((row, index) => (
        <div key={`${index}:${row.label}`} className={css.line}>
          <span className={css.text} title={row.label}>{row.label}</span>
          {row.destination !== undefined && go !== undefined && (
            <button type="button" className={css.door} onClick={() => { go(row.destination!) }}>{copy.open}</button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------- the tool row seat */

/** What an owner hands the shell: its copy and its `go`. Nothing it draws. */
export interface CardFace {
  readonly copy: () => CardCopy
  readonly go: () => ((destination: Destination) => void) | undefined
}

/** The props the keyed `tool.call.toolview` seat composes. */
export type DestinationToolRowProps = CardFace & { readonly block?: ToolBlockLike | null; readonly phase?: string }

/** The row that replaces a write tool's generic row. */
export function DestinationToolRow({ block, phase, copy, go }: DestinationToolRowProps): ReactNode {
  return <DestinationCard copy={copy()} model={toolCardModel(block, phase)} go={go()} />
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

/** The Turn tail: every place the Turn wrote — one card, or one summary card when it wrote several. Never opens anything itself. */
export function DestinationTurnTail(props: DestinationTurnTailProps): ReactNode {
  const items = turnCardItems(props, props.turnKey)
  if (items.length === 0) return null
  const copy = props.copy()
  if (items.length === 1) return <DestinationCard copy={copy} model={items[0]!.model} go={props.go()} />
  return (
    <SummaryCard
      copy={copy}
      go={props.go()}
      summary={{ title: copy.turnTitle ?? copy.kind, rows: items.map(item => ({ label: item.model.destination?.label ?? item.model.text, destination: item.model.destination })) }}
    />
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
  options: {
    readonly owner: string
    readonly tools: readonly string[]
    readonly locale?: string
    readonly face: () => CardFace
    readonly order?: number
    /**
     * False: seat the tool rows only. For a mode whose own Turn summary already
     * names every place the Turn wrote (the game's turn card, itself a body in
     * this shell), so the same write never shows twice under one reply.
     */
    readonly turnTail?: boolean
  },
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
  if (options.turnTail === false) return
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

/* ------------------------------------------------------- a mode's Turn summary */

interface TurnEndState { readonly turn: number; readonly ended: boolean }

/** A Conversation Definition that only records each Turn's number and whether it ended. */
export function turnEndDefinition(key: string) {
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
      if (event.type === 'turn/end') return { id: String(turn), role: 'update' }
      return null
    },
    start(_context: unknown, match: { readonly event: EventLike }): TurnEndState {
      return { turn: turnOf(match.event) ?? -1, ended: false }
    },
    update(context: { readonly state: TurnEndState }, match: { readonly event: EventLike }): TurnEndState {
      return match.event.type === 'turn/end' ? { ...context.state, ended: true } : context.state
    },
    buildLocationData(
      context: { readonly state: TurnEndState | undefined },
      scope: string,
      previous: { kind: 'turn'; turn: number; key: string; value: TurnEndState } | null | undefined,
    ) {
      if (scope !== 'turn' || context.state === undefined) return null
      if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.value.ended === context.state.ended) return previous
      return { kind: 'turn' as const, turn: context.state.turn, key, value: context.state }
    },
  }
}

/** How a mode hands one Turn's summary: data only, read when the Turn ended (null: nothing to show). */
export type TurnSummaryLoader = (turn: { readonly sessionId: string; readonly turn: number }) => Promise<TurnSummary | null>

/** The props of a summary Turn-tail entry. */
export type TurnSummaryTailProps = CardFace & TurnOwnerLike & {
  readonly sessionId?: string
  readonly turnKey: string
  readonly kind: string
  readonly load: TurnSummaryLoader
}

/** The Turn tail of a mode that summarizes its own Turns: the summary card, read when the Turn ends and again on a write. */
export function TurnSummaryTail(props: TurnSummaryTailProps): ReactNode {
  const state = record(props.turn.data.get(props.turnKey)) as TurnEndState | null
  const sessionId = props.sessionId
  const turn = state?.turn
  const ended = state?.ended === true
  const { load, kind } = props
  const [summary, setSummary] = useState<TurnSummary | null>(null)
  useEffect(() => {
    if (!ended || sessionId === undefined || turn === undefined) return
    let alive = true
    const read = (): void => { void load({ sessionId, turn }).then(value => { if (alive) setSummary(value) }, () => {}) }
    read()
    // The report can settle a moment after the Turn's end event.
    const again = setTimeout(read, 1500)
    const stop = subscribeWrites(kind, read)
    return () => { alive = false; clearTimeout(again); stop() }
  }, [ended, sessionId, turn, load, kind])
  if (summary === null || summary.rows.length === 0) return null
  return <SummaryCard copy={props.copy()} summary={summary} go={props.go()} />
}

/**
 * Seat a mode's own Turn summary in the Turn tail: the shell draws it, the mode
 * only loads the data.
 * @param effect - the context's `ctx.effect`.
 * @param slots - the slot registry.
 * @param conversation - reads `uiConversation` once the tail seat exists.
 * @param options - the owner, its tab kind, locale, face and loader.
 */
export function registerTurnSummary(
  effect: (body: () => () => void, label: string) => void,
  slots: SlotsLike,
  conversation: () => ConversationLike | undefined,
  options: { readonly owner: string; readonly kind: string; readonly locale?: string; readonly face: () => CardFace; readonly load: TurnSummaryLoader; readonly order?: number },
): void {
  const turnKey = `${options.owner}/summary`
  effect(() => slots.inject('conversation.chat.turnTail', () => {
    const events = conversation()?.events
    if (events?.register === undefined) return () => undefined
    const disposeDefinition = events.register.call(events, turnEndDefinition(turnKey))
    const disposeEntry = slots.register({
      name: 'conversation.chat.turnTail',
      id: turnKey,
      order: options.order ?? 40,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      inject: () => ({ ...options.face(), turnKey, kind: options.kind, load: options.load }),
    }, TurnSummaryTail)
    return () => { disposeEntry(); disposeDefinition() }
  }), `${options.owner}: turn summary`)
}
