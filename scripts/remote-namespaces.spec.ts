import { describe, expect, it } from 'vitest'
import { extract, scan } from './remote-namespaces.ts'

describe('extract', () => {
  it('reads the single-argument form, where both names coincide', () => {
    expect(extract("super(ctx, 'filePreview')", 'file-preview')).toEqual([
      { pkg: 'file-preview', wire: 'filePreview', serviceKey: 'filePreview', split: false },
    ])
  })

  it('reads the split form — the one a hand-copied table gets wrong', () => {
    expect(extract("super(ctx, 'localFilesRemote', { namespace: 'localFiles' })", 'local-files')).toEqual([
      { pkg: 'local-files', wire: 'localFiles', serviceKey: 'localFilesRemote', split: true },
    ])
  })

  it('reads an options object spread over lines', () => {
    const source = "super(ctx, 'worktreesRemote', {\n  namespace: 'worktrees',\n  immediate: true,\n})"
    expect(extract(source, 'worktrees')[0]).toMatchObject({ wire: 'worktrees', serviceKey: 'worktreesRemote', split: true })
  })

  it('ignores an options object that carries no namespace', () => {
    expect(extract("super(ctx, 'room', { immediate: true })", 'room')[0]).toMatchObject({ wire: 'room', split: false })
  })
})

describe('scan (real tree)', () => {
  it('finds every Remote and names the split ones', () => {
    const rows = scan()
    const byPkg = new Map(rows.map((r) => [r.pkg, r]))
    // The two that broke the hand-built tables on 2026-09-01.
    expect(byPkg.get('local-files')).toMatchObject({ wire: 'localFiles', serviceKey: 'localFilesRemote' })
    expect(byPkg.get('worktrees')).toMatchObject({ wire: 'worktrees', serviceKey: 'worktreesRemote' })
    // The two neither survey covered — they are not dev members.
    expect(byPkg.get('datasets')?.split).toBe(true)
    expect(byPkg.get('mission')?.split).toBe(true)
    // The coincident ones still resolve to a wire name.
    expect(byPkg.get('file-preview')).toMatchObject({ wire: 'filePreview', split: false })
    expect(byPkg.get('local-agent')).toMatchObject({ wire: 'localAgentGateway', split: false })
  })

  it('every package exporting ./remote appears', () => {
    const pkgs = new Set(scan().map((r) => r.pkg))
    for (const expected of ['capability-catalog', 'datasets', 'file-preview', 'local-agent', 'local-files', 'message-tools', 'mission', 'room', 'worktrees']) {
      expect(pkgs, `${expected} has a ./remote export but no extracted namespace`).toContain(expected)
    }
  })
})
