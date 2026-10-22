/**
 * Game reference chips: what a pick in the play area (or an element card)
 * puts into the composer. The chip shows a short label; the model receives
 * the full reference text — element name and id, instance, position, region
 * and state — so it knows exactly which thing the user means.
 * @module @khorsheed/dsh-game/client
 */
import type { PickRef } from '../vfs.ts'

/** The trigger-source name the chip codec registers under. */
export const GAME_REF_SOURCE = 'dsh-game-ref'

/** Encode a chip payload. */
export function encodeGameRef(ref: { readonly label: string; readonly text: string }): string {
  return JSON.stringify({ v: 1, label: ref.label, text: ref.text })
}

/** Decode a chip payload; undefined on corruption. */
export function decodeGameRef(raw: string): { label: string; text: string } | undefined {
  try {
    const parsed = JSON.parse(raw) as { label?: unknown; text?: unknown }
    return typeof parsed.text === 'string' && typeof parsed.label === 'string' ? { label: parsed.label, text: parsed.text } : undefined
  } catch {
    return undefined
  }
}

/** The codec: the model receives the full text; a corrupt chip refuses the send (the host restores the draft). */
export const gameRefCodec = {
  clipboardText: (raw: string): string => decodeGameRef(raw)?.text ?? raw,
  serialize: async (raw: string): Promise<string> => {
    const text = decodeGameRef(raw)?.text
    if (text === undefined) throw new Error('@khorsheed/dsh-game: corrupt game reference chip')
    return text
  },
}

const num = (n: number): string => String(Math.round(n * 10) / 10)

/**
 * A pick as a chip: the label the user sees, the text the model gets.
 * @param ref - what the game's `pick` answered (a bare id becomes `{ id }`).
 * @param name - the element's name, when the id names one.
 * @param groundLabel - the localized word for the ground.
 */
export function pickChip(ref: PickRef, name: string | undefined, groundLabel: string): { label: string; text: string } {
  const where = ref.point === undefined ? '' : `(${num(ref.point.x)}, ${num(ref.point.z)})`
  if (ref.ground === true || ref.id === null) {
    const label = [groundLabel, ref.region ?? where].filter(Boolean).join(' · ')
    return { label, text: `〔${[groundLabel, ref.region, where].filter(Boolean).join(' · ')}〕` }
  }
  const title = name ?? ref.name ?? ref.id
  const label = [title, ref.state].filter(Boolean).join(' · ')
  const idPart = ref.inst !== undefined && ref.inst !== null && ref.inst !== ref.id ? `${ref.id} #${ref.inst}` : ref.id
  return { label, text: `〔${[`${title}（${idPart}）`, [ref.region, where].filter(Boolean).join(' '), ref.state].filter(Boolean).join(' · ')}〕` }
}
