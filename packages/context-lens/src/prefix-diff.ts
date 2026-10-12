import type { PrefixTextChange } from './types.ts'

/** Linear comparison on full text; never infer a change from already-truncated previews. */
export function prefixTextChange(before: string, after: string): PrefixTextChange {
  const a = Array.from(before), b = Array.from(after)
  let start = 0, end = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++
  return {
    offset: start,
    leading: a.slice(Math.max(0, start - 48), start).join(''),
    trailing: end ? a.slice(a.length - end, a.length - end + 48).join('') : '',
    leadingOmitted: start > 48,
    trailingOmitted: end > 48,
    removed: a.slice(start, Math.min(a.length - end, start + 160)).join(''),
    added: b.slice(start, Math.min(b.length - end, start + 160)).join(''),
    removedChars: a.length - start - end,
    addedChars: b.length - start - end,
  }
}
