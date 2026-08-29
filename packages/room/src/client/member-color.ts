/**
 * Fixed per-member colors: the one new visual vocabulary the room adds (the
 * identity dot on member rows, speech headers, and @-candidates). Assignment
 * is a stable name hash — the same member keeps its color across views and
 * reloads without any roster bookkeeping.
 */

/** Eight hues chosen to stay legible on both light and dark surfaces. */
const PALETTE = [
  '#5b8ff9', '#61ddaa', '#f6bd16', '#7262fd',
  '#f6903d', '#008685', '#e86452', '#f08bb4',
] as const

/**
 * Map a member name to its fixed palette color.
 * @param name - the member's addressing name.
 * @returns a hex color.
 */
export function memberColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}
