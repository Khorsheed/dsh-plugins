/** Counts calls by exact tool name, retaining first-occurrence order. */
export function countToolCalls(names: readonly string[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count }))
}
