/** The curated-list scoping behind the invite picker's model vocabulary. */
import { describe, expect, it } from 'vitest'
import type { LocalAgentModelDirectory } from '../src/types.ts'
import { scopeDirectoryToList } from '../src/client/model-directory-scope.ts'

const directory = (entries: LocalAgentModelDirectory['entries']): LocalAgentModelDirectory => ({
  entries, complete: true, customInput: true, status: 'ready', refreshing: false, revision: 1,
})

describe('scopeDirectoryToList', () => {
  const served = directory([
    { value: 'kimi-code/k3', label: 'K3', source: 'native' },
    { value: 'kimi-code/k2', label: 'K2', source: 'native', resolvedModel: 'k2-0711' },
    { value: 'legacy-from-config', label: 'legacy-from-config', source: 'configuration' },
  ])

  it('keeps the directory when the list is unsupported or empty', () => {
    expect(scopeDirectoryToList(served, null)).toBe(served)
    expect(scopeDirectoryToList(served, undefined)).toBe(served)
    expect(scopeDirectoryToList(served, [])).toBe(served)
  })

  it('orders candidates by the curated list and keeps unserved ones as bare rows', () => {
    const scoped = scopeDirectoryToList(served, ['k2-0711', 'gone-from-endpoint', 'kimi-code/k3'])
    // The list's order leads; resolvedModel aliases match their entry.
    expect(scoped.entries.map(entry => entry.value)).toEqual(['kimi-code/k2', 'gone-from-endpoint', 'kimi-code/k3'])
    expect(scoped.entries[1]).toMatchObject({ label: 'gone-from-endpoint', source: 'configuration' })
    expect(scoped.entries[0]).toMatchObject({ label: 'K2', source: 'native' })
  })
})
