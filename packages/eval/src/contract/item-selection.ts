/**
 * 选题 (T90 · second segment): which of a set's items an experiment runs over.
 *
 * Three modes, and every one of them ends as an explicit, pinned
 * `dataset.items` list in the plan — the selection is a way of WRITING that
 * list, never a rule the run re-applies. A run reads the items and nothing
 * else, so a plan's rows cannot drift when the set gains items later.
 *
 * - `all` — every item of the pool;
 * - `random` — `count` items of the pool, chosen by `seed`;
 * - `pick` — the items a person ticked, as given.
 *
 * **Reproducibility.** The random draw is a pure function of three things:
 * the pool (the set's item ids at the pinned commit), the seed and the count.
 * Same set version + same seed + same count ⇒ the same items, in any browser,
 * on any host, in any later eval version that keeps {@link SELECTION_ALGORITHM}.
 * How:
 *
 * - every pool id gets a rank key `hash53(seed, id)` — a fixed, documented
 *   53-bit string hash (cyrb53) of the seed and the id, nothing else;
 * - the `count` ids with the smallest keys are drawn (a key tie, which takes a
 *   2^-53 accident, falls back to id order);
 * - the drawn ids are returned in POOL order (ids sorted by UTF-16 code unit),
 *   so the plan lists them the way the set does.
 *
 * Ranking by a per-id hash rather than shuffling the pool with a seeded PRNG
 * is deliberate: an item's key does not depend on which OTHER items exist, so
 * a later version that adds or removes items changes the draw only where it
 * must (a new item enters only if its key beats the current last one) — and
 * the pool's order cannot matter, because nothing reads it.
 *
 * The draw never consults `Math.random`, the clock or the locale. The dialog
 * mints a fresh seed for a person who did not choose one; that seed is then
 * shown, editable, and written into the plan beside the items it produced.
 *
 * This module is imported by BOTH faces: the 新建实验 dialog previews the draw
 * in the browser, and `eval_plan_draft` performs it against the pinned commit.
 * It therefore imports nothing.
 * @module @khorsheed/dsh-eval
 */

/** The rule's name and version, written into the plan beside the seed. */
export const SELECTION_ALGORITHM = 'hash-rank/1'

/** Seeds are non-negative safe integers; the dialog mints them below this. */
export const SEED_MINT_CEILING = 100_000

/** How the items were chosen — what the dialog sends and the draft resolves. */
export type ItemSelection =
  | { mode: 'all'; includePlaceholders?: boolean }
  | { mode: 'random'; count: number; seed: number; includePlaceholders?: boolean }
  | { mode: 'pick'; items: readonly string[] }

/** One pool entry: an item id and whether the set marks it a placeholder. */
export interface SelectionPoolItem {
  id: string
  placeholder: boolean
}

/**
 * The provenance block the draft writes as `dataset.selection` (v1-rev15):
 * enough to redo the draw by hand against the pinned commit.
 */
export type PlanSelection =
  | { mode: 'all'; pool: number; placeholders?: true }
  | { mode: 'random'; count: number; seed: number; pool: number; algorithm: string; placeholders?: true }
  | { mode: 'pick'; pool: number }

/** Why a selection cannot be resolved; the message says what to change. */
export class ItemSelectionRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItemSelectionRefused'
  }
}

/**
 * cyrb53: a 53-bit string hash (public domain, bryc). Chosen because it is
 * small, synchronous in every JavaScript runtime, and spreads short inputs
 * well; the exact arithmetic below IS the contract — change it and
 * {@link SELECTION_ALGORITHM} must change with it.
 * @param text - the input string (hashed by UTF-16 code unit).
 * @param seed - a 32-bit seed folded into both lanes.
 * @returns an integer in [0, 2^53).
 */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** UTF-16 code-unit order — locale-free, so every runtime sorts alike. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Whether a seed is one the rule accepts: a non-negative safe integer. */
export function isValidSeed(seed: unknown): seed is number {
  return typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0
}

/**
 * The pool a selection draws from: the set's ids, sorted, without the
 * placeholders unless asked for, each id once.
 * @param items - the set's items at the pinned commit (any order).
 * @param includePlaceholders - whether link-test fixtures are eligible.
 */
export function selectionPool(items: readonly SelectionPoolItem[], includePlaceholders = false): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    if (includePlaceholders || !item.placeholder) ids.add(item.id)
  }
  return [...ids].sort(byCodeUnit)
}

/**
 * Draw `count` ids of `pool` by `seed` — the reproducible half of 选题.
 * @param pool - the eligible ids (order is irrelevant; duplicates collapse).
 * @param count - how many to draw; 1 ≤ count ≤ pool size.
 * @param seed - a non-negative safe integer.
 * @returns the drawn ids in pool order.
 * @throws {@link ItemSelectionRefused} for a count or seed out of range.
 */
export function drawItems(pool: readonly string[], count: number, seed: number): string[] {
  const ids = [...new Set(pool)].sort(byCodeUnit)
  if (!isValidSeed(seed)) throw new ItemSelectionRefused(`seed must be a non-negative integer, got ${JSON.stringify(seed)}`)
  if (!Number.isInteger(count) || count < 1) throw new ItemSelectionRefused(`count must be a positive integer, got ${JSON.stringify(count)}`)
  if (count > ids.length) {
    throw new ItemSelectionRefused(`cannot draw ${count} items from a pool of ${ids.length} — pick a count up to ${ids.length}, or take all`)
  }
  // The seed is folded into the HASHED TEXT, not only the hash's own seed
  // lane: cyrb53's seed parameter is 32-bit, and a seed above 2^32 must not
  // collide with its low word.
  const prefix = `${seed}\u0000`
  const ranked = ids
    .map(id => ({ id, key: hash53(prefix + id) }))
    .sort((a, b) => a.key - b.key || byCodeUnit(a.id, b.id))
  const drawn = new Set(ranked.slice(0, count).map(entry => entry.id))
  return ids.filter(id => drawn.has(id))
}

/**
 * Resolve a selection against a set's items: the explicit list the plan pins,
 * and the provenance block written beside it.
 * @param items - the set's items at the pinned commit, with placeholder marks.
 * @param selection - how to choose.
 * @returns `items` in pool order (pick keeps the person's order) and `record`.
 * @throws {@link ItemSelectionRefused} when the selection cannot be honoured.
 */
export function resolveSelection(
  items: readonly SelectionPoolItem[],
  selection: ItemSelection,
): { items: string[]; record: PlanSelection } {
  const known = new Set(items.map(item => item.id))
  if (selection.mode === 'pick') {
    const picked = [...new Set(selection.items.map(id => id.trim()).filter(id => id !== ''))]
    if (picked.length === 0) throw new ItemSelectionRefused('no items picked — tick at least one, or take all')
    const unknown = picked.filter(id => !known.has(id))
    if (unknown.length > 0) {
      throw new ItemSelectionRefused(`the set declares no item(s) ${unknown.map(id => JSON.stringify(id)).join(', ')}`)
    }
    return { items: picked, record: { mode: 'pick', pool: known.size } }
  }
  const placeholders = selection.includePlaceholders === true
  const pool = selectionPool(items, placeholders)
  if (pool.length === 0) {
    throw new ItemSelectionRefused(
      placeholders
        ? 'the set holds no items'
        : 'the set holds only placeholder items — include placeholders, or pick items by hand',
    )
  }
  const extra = placeholders ? { placeholders: true as const } : {}
  if (selection.mode === 'all') return { items: pool, record: { mode: 'all', pool: pool.length, ...extra } }
  const drawn = drawItems(pool, selection.count, selection.seed)
  return {
    items: drawn,
    record: {
      mode: 'random',
      count: selection.count,
      seed: selection.seed,
      pool: pool.length,
      algorithm: SELECTION_ALGORITHM,
      ...extra,
    },
  }
}

/**
 * Mint a seed for a person who did not choose one. The only nondeterministic
 * call in this module, and it never reaches the draw: the minted seed is
 * shown and pinned like a chosen one.
 * @param random - the source; `Math.random` unless a test pins it.
 */
export function mintSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * (SEED_MINT_CEILING - 1))
}
