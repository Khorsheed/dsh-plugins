/**
 * The invite dialog's name dice: a small game-flavored pool of addressing
 * names. Rolling skips names already on the roster (a duplicate would fail
 * the host's uniqueness check anyway) and the currently displayed name (a
 * roll that changes nothing feels broken). The avatar color follows the new
 * name automatically — it is a name hash (member-color.ts).
 */

/** Game-flavored addressing names, one per letter for variety. */
export const NAME_POOL = [
  'ada', 'bill', 'cathy', 'dex', 'echo', 'faye', 'gray', 'iris',
  'jude', 'kai', 'luna', 'milo', 'nova', 'odin', 'piper', 'quinn',
  'ray', 'sage', 'tess', 'uma', 'vale', 'wren', 'xavi', 'yara', 'zoe',
] as const

/**
 * Roll a random name from the pool.
 * @param taken - names already on the roster (never rolled).
 * @param current - the currently displayed name (never re-rolled).
 * @returns a fresh name, or undefined when the pool is exhausted.
 */
export function rollName(taken: readonly string[], current: string): string | undefined {
  const candidates = NAME_POOL.filter(name => !taken.includes(name) && name !== current)
  if (candidates.length === 0) return undefined
  return candidates[Math.floor(Math.random() * candidates.length)]
}
