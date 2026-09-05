/**
 * Matrix expansion and execution ordering. The matrix is the plan's
 * (item × condition × rep) cross product — one cell = one mission = one
 * independent sample (frozen decision 1). The order is a seeded shuffle over
 * the matrix; with `interleave` the shuffle then greedily prefers a next cell
 * whose condition differs from the previous one (frozen decision 11: the seed
 * is recorded with the run, so the order is reproducible from the plan).
 * @module @khorsheed/dsh-eval
 */

/** One expanded cell: one mission of the run. */
export interface EvalCell {
  /** Mission id: `<item>-<condition>-rep<n>`, lowercased. */
  missionId: string
  /** Human title: `<item> × <condition> × rep<n>`. */
  title: string
  labels: { task: string; condition: string; rep: string }
}

/** The plan subset expandMatrix consumes (dataseek.plan/1 fields). */
export interface PlanMatrixInput {
  dataset: { items: readonly string[] }
  conditions: readonly string[]
  reps: number
}

/** Mission-id-safe lowercasing: the id must satisfy mission's id pattern. */
function sanitizeIdPart(part: string): string {
  const cleaned = part.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return cleaned === '' ? 'x' : cleaned
}

/** The mission id of one cell: `<item>-<condition>-rep<n>`, lowercased. */
export function missionIdFor(task: string, condition: string, rep: number): string {
  return `${sanitizeIdPart(task)}-${sanitizeIdPart(condition)}-rep${rep}`
}

/**
 * Expand the plan's matrix into cells, in (item, condition, rep) order.
 * Duplicated item or condition entries in the plan produce duplicated cells
 * and are the validator's business (CONDITIONS_DUPLICATED), not expanded away.
 */
export function expandMatrix(plan: PlanMatrixInput): EvalCell[] {
  const cells: EvalCell[] = []
  for (const task of plan.dataset.items) {
    for (const condition of plan.conditions) {
      for (let rep = 1; rep <= plan.reps; rep++) {
        cells.push({
          missionId: missionIdFor(task, condition, rep),
          title: `${task} × ${condition} × rep${rep}`,
          labels: { task, condition, rep: String(rep) },
        })
      }
    }
  }
  return cells
}

/** mulberry32 — a tiny seeded PRNG, adequate for ordering (not cryptography). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const pool = [...items]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = pool[i] as T
    const b = pool[j] as T
    pool[i] = b
    pool[j] = a
  }
  return pool
}

/**
 * Order cells by the plan's seed: a seeded shuffle; when `interleave` is set,
 * a greedy second pass prefers a next cell whose condition differs from the
 * previous cell's (only forced back to the shuffled head when nothing else
 * remains). Deterministic for a given (cells, seed, interleave) triple.
 */
export function orderCells(cells: readonly EvalCell[], seed: number, interleave: boolean): EvalCell[] {
  const rng = mulberry32(seed)
  const pool = shuffled(cells, rng)
  if (!interleave || pool.length <= 1) return pool
  const ordered: EvalCell[] = []
  while (pool.length > 0) {
    const previous = ordered[ordered.length - 1]
    const candidates = previous === undefined
      ? pool
      : pool.filter(cell => cell.labels.condition !== previous.labels.condition)
    const index = candidates.length > 0
      ? Math.floor(rng() * candidates.length)
      : 0
    const picked = candidates.length > 0 ? candidates[index] as EvalCell : pool[0] as EvalCell
    ordered.push(picked)
    pool.splice(pool.indexOf(picked), 1)
  }
  return ordered
}
