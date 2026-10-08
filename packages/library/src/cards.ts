/**
 * Knowledge-card identity: when two inputs are the SAME card, and when they
 * only look alike. The write path decides here, so the coach never has to read
 * every card before writing one:
 *
 * - an exact match on the normalized key (case, width, whitespace, surrounding
 *   punctuation, a light English plural fold) — against the term AND every
 *   alias — merges automatically;
 * - a near match (one key contains the other, or the two share most of their
 *   words / characters) is held back with up to three candidates, and the
 *   coach resends with `mergeInto` or `asNew`;
 * - anything else is a new card.
 *
 * Pure functions only — the service owns the lock and the ledger.
 *
 * @module @khorsheed/dsh-library/cards
 */
import type { LibraryCard } from './types.ts'

/** Fold one English word's regular plural (instalments → instalment, theories → theory). */
function foldPlural(word: string): string {
  if (!/^[a-z]+$/.test(word) || word.length <= 3) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (/(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) return word.slice(0, -1)
  return word
}

/**
 * A term's comparison key: NFKC (full-width → half-width), lower case, inner
 * whitespace collapsed, surrounding punctuation and brackets dropped, each
 * English word's plural folded.
 */
export function cardKey(term: string): string {
  const base = term
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
  return base.split(' ').map(foldPlural).join(' ')
}

/** Every key a card answers to: its term and its aliases. */
export function cardKeys(card: Pick<LibraryCard, 'term' | 'aliases'>): string[] {
  return [...new Set([card.term, ...card.aliases].map(cardKey).filter(key => key !== ''))]
}

/** The comparison units of a key: English words, or single CJK characters. */
function units(key: string): Set<string> {
  const out = new Set<string>()
  for (const token of key.split(/[\s/／、,，·・-]+/)) {
    if (token === '') continue
    if (/[\p{Script=Han}]/u.test(token)) {
      for (const char of token) if (/[\p{Script=Han}\p{L}\p{N}]/u.test(char)) out.add(char)
    } else {
      out.add(token)
    }
  }
  return out
}

/** How alike two keys look, 0..1 (1 = one contains the other). */
export function keySimilarity(a: string, b: string): number {
  if (a === '' || b === '') return 0
  if (a === b) return 1
  const shorter = a.length <= b.length ? a : b
  const longer = shorter === a ? b : a
  // Containment only counts when the shorter key is substantial: 「期」 inside
  // 「不应期」 is noise, 「不应期」 inside 「绝对/相对不应期」 is the same idea.
  const minimum = /[\p{Script=Han}]/u.test(shorter) ? 2 : 4
  if (shorter.length >= minimum && longer.includes(shorter)) return 1
  const left = units(a)
  const right = units(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const unit of left) if (right.has(unit)) shared += 1
  return shared / Math.max(left.size, right.size)
}

/** The threshold above which two keys are a near-duplicate worth asking about. */
export const NEAR_DUPLICATE = 0.6

/** The live card an input key matches exactly, when one does. */
export function exactMatch(cards: readonly LibraryCard[], keys: readonly string[]): LibraryCard | undefined {
  const wanted = new Set(keys)
  return cards.find(card => card.status !== 'deleted' && cardKeys(card).some(key => wanted.has(key)))
}

/** Up to `limit` live cards that look like the input, most alike first. */
export function nearMatches(cards: readonly LibraryCard[], keys: readonly string[], limit = 3): LibraryCard[] {
  const scored: { card: LibraryCard; score: number }[] = []
  for (const card of cards) {
    if (card.status === 'deleted') continue
    let best = 0
    for (const own of cardKeys(card)) {
      for (const key of keys) best = Math.max(best, keySimilarity(own, key))
    }
    if (best >= NEAR_DUPLICATE) scored.push({ card, score: best })
  }
  scored.sort((x, y) => y.score - x.score)
  return scored.slice(0, limit).map(entry => entry.card)
}

/**
 * Whether a card answers a free-text query: any key or the gloss / user gloss
 * / a context sentence contains the query's key (the sidebar's ⌕ and the
 * coach's `library_read · cards` share this).
 */
export function cardMatchesQuery(card: LibraryCard, query: string): boolean {
  const needle = cardKey(query)
  if (needle === '') return true
  if (cardKeys(card).some(key => key.includes(needle))) return true
  const haystack = [card.gloss, card.userGloss ?? '', ...card.contexts.map(context => context.sentence)]
    .join('\n')
    .normalize('NFKC')
    .toLowerCase()
  return haystack.includes(query.normalize('NFKC').toLowerCase().trim())
}
