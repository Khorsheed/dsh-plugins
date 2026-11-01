/**
 * The destination contract (proposal 2026-10-30-agent-sidebar-navigation):
 * a write tool says where its result lives, as ONE marked line at the end of
 * its answer, and the browser follows or offers that place.
 *
 * Why a line in the answer: a tool result is content blocks only — there is no
 * side channel that reaches the browser without reaching the model — and a
 * custom session event type breaks every history it lands in once its
 * registering package is gone. A line is harmless everywhere: the model reads
 * a short JSON tail, an uninstalled follower reads nothing.
 *
 * The line is `⟦dsh-nav⟧{json}`. Host halves write it through the documented
 * no-import path (an inline `destinationLine` copy — host faces are not
 * bundled, so they cannot import this source-plane library at runtime); every
 * browser half reads it through `readDestinations` here. The format is the
 * contract; this module is its reference implementation.
 *
 * @module @khorsheed/dsh-client-ui-agent-nav
 */

/** The marker that opens a destination line. */
export const NAV_MARK = '⟦dsh-nav⟧'

/** One place a write landed: which panel kind owns it, and where inside it. */
export interface Destination {
  /**
   * Stable per landing: `<kind>:<thing>:<version>`. The follower follows one id
   * once, and the `[nav]` log lines are keyed by it.
   */
  readonly id: string
  /** The right-Sidebar tab kind that owns the place (`canvas`, `library`, …). */
  readonly kind: string
  /** The owner's address inside its panel (the tab kind's navigation params). */
  readonly params: Readonly<Record<string, unknown>>
  /** What the person reads on the card: `第 3 章《雨夜》计划`. */
  readonly label: string
  /**
   * What the card says besides the label, handed over by the plugin with the
   * write (proposal 2026-10-30-agent-sidebar-navigation: the shell is fixed,
   * the plugin only hands data). Shown while the write is live on this page;
   * a replayed card keeps only the label and the door.
   */
  readonly card?: DestinationCardData
}

/** The card data a plugin hands with a destination (or later, through `updateCards`). */
export interface DestinationCardData {
  /** A short pill: what the person is asked to do (等你确认), or what came of it (已确认). */
  readonly status?: string
  /** The card asks the person for something: its door stands out. */
  readonly awaiting?: boolean
  /** The door's words when they say more than 查看 → (查看并确认计划 →). */
  readonly door?: string
}

/**
 * The marked line for one destination.
 * @param destination - where the write landed.
 * @returns the line, without a trailing newline.
 */
export function destinationLine(destination: Destination): string {
  return `${NAV_MARK}${JSON.stringify(destination)}`
}

/**
 * An answer with its destination line appended.
 * @param text - the tool's answer.
 * @param destination - where the write landed.
 * @returns the answer, then the line on its own.
 */
export function withDestination(text: string, destination: Destination): string {
  return `${text}\n${destinationLine(destination)}`
}

/** A content block as tool results carry them (structural). */
export interface ContentLike {
  readonly type: string
  readonly text?: string
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/**
 * One parsed destination, or undefined for a malformed line.
 * @param json - the text after the marker.
 */
function parse(json: string): Destination | undefined {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return undefined
  }
  const row = record(value)
  if (row === null) return undefined
  const { id, kind, label } = row
  const params = record(row['params'])
  if (typeof id !== 'string' || id === '' || typeof kind !== 'string' || kind === '' || params === null) return undefined
  const card = cardOf(row['card'])
  return { id, kind, params, label: typeof label === 'string' ? label : '', ...(card === undefined ? {} : { card }) }
}

/** A destination's card data, keeping only well-formed fields. */
function cardOf(value: unknown): DestinationCardData | undefined {
  const raw = record(value)
  if (raw === null) return undefined
  const card: { status?: string; awaiting?: boolean; door?: string } = {}
  if (typeof raw['status'] === 'string' && raw['status'] !== '') card.status = raw['status']
  if (raw['awaiting'] === true) card.awaiting = true
  if (typeof raw['door'] === 'string' && raw['door'] !== '') card.door = raw['door']
  return Object.keys(card).length === 0 ? undefined : card
}

/**
 * Every destination an answer names, in order.
 * @param content - the answer text, or its content blocks.
 * @returns the destinations; empty when it names none (or only malformed ones).
 */
export function readDestinations(content: string | readonly ContentLike[]): Destination[] {
  const text = typeof content === 'string'
    ? content
    : content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
  const out: Destination[] = []
  for (const line of text.split('\n')) {
    const at = line.indexOf(NAV_MARK)
    if (at !== 0) continue
    const destination = parse(line.slice(NAV_MARK.length).trim())
    if (destination !== undefined) out.push(destination)
  }
  return out
}

/**
 * An answer without its destination lines (what a card shows as the answer).
 * @param text - the answer text.
 * @returns the text, marked lines dropped, trailing whitespace trimmed.
 */
export function stripDestinations(text: string): string {
  return text.split('\n').filter(line => !line.startsWith(NAV_MARK)).join('\n').trimEnd()
}
