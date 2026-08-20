/** CLI: parse, exit-code semantics, the read verbs, bind, and worktree prune. */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, runCli, type CliIo } from '../src/cli.ts'
import { cleanup, makeFixtureRepo, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let scratch: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
  repo = undefined
  scratch = undefined
})

const scratchDir = (): string => scratch ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-cli-'))

/** Capture one CLI run. */
async function run(argv: readonly string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const io: CliIo = { stdout: line => { out += line }, stderr: line => { err += line } }
  const code = await runCli(argv, io, env)
  return { code, out, err }
}

describe('parse', () => {
  it('splits command positionals from flags', () => {
    const parsed = parse(['worktree', 'path', '--dataset', 'alpha', '--layers', 'a,b'])
    expect(parsed).toEqual({ command: ['worktree', 'path'], flags: { dataset: 'alpha', layers: 'a,b' } })
  })

  it('reports usage on empty argv, unknown flags are rejected downstream', () => {
    expect('error' in parse([])).toBe(true)
    expect('error' in parse(['list', '--repo'])).toBe(true)
  })
})

describe('read verbs', () => {
  it('list/show/describe/read/snapshot exit 0 with content; usage errors exit 2; failures exit 1', async () => {
    repo = makeFixtureRepo()
    const env = { DSH_DATASETS_REPO: repo.dir }
    const list = await run(['list'], env)
    expect(list.code).toBe(0)
    expect(list.out).toContain('alpha')
    expect(list.out).toContain('non-model-facing: hidden')

    const items = await run(['list', '--dataset', 'alpha'], env)
    expect(items.out).toContain('i1')

    const show = await run(['show', '--dataset', 'alpha', '--item', 'i1'], env)
    expect(show.code).toBe(0)
    expect(show.out).toContain('visible/task.md')
    expect(show.out).toContain('hidden/notes.md')

    const describeResult = await run(['describe', '--dataset', 'alpha'], env)
    expect(JSON.parse(describeResult.out)).toMatchObject({ id: 'alpha', extra: { passthrough: true } })

    const read = await run(['read', '--dataset', 'alpha', '--item', 'i1', '--layer', 'visible', '--path', 'task.md'], env)
    expect(read.code).toBe(0)
    expect(read.out).toBe('task one v1\n')

    const snapshot = await run(['snapshot', '--dataset', 'alpha'], env)
    expect(JSON.parse(snapshot.out)).toMatchObject({ commit: repo.commit, datasetId: 'alpha' })

    expect((await run(['show'], env)).code).toBe(2)
    expect((await run(['read', '--dataset', 'alpha'], env)).code).toBe(2)
    expect((await run(['nonsense'], env)).code).toBe(2)
    expect((await run(['list'], {})).code).toBe(1) // no repo source: fail loud
    expect((await run(['show', '--dataset', 'ghost'], env)).code).toBe(1)
  })
})

describe('worktree verbs', () => {
  it('worktree path prints the managed path; prune removes it', async () => {
    repo = makeFixtureRepo()
    const wtRoot = join(scratchDir(), 'wt')
    const env = { DSH_DATASETS_REPO: repo.dir }
    const pathResult = await run(['worktree', 'path', '--dataset', 'alpha', '--layers', 'visible', '--worktree-root', wtRoot], env)
    expect(pathResult.code).toBe(0)
    const wtPath = pathResult.out.trim()
    // The managed path is realpath-canonicalized (macOS /var → /private/var).
    expect(wtPath.startsWith(realpathSync(wtRoot))).toBe(true)

    const prune = await run(['worktree', 'prune', '--worktree-root', wtRoot], env)
    expect(prune.code).toBe(0)
    expect(prune.out).toContain('removed 1 managed worktree')
    const again = await run(['worktree', 'prune', '--worktree-root', wtRoot], env)
    expect(again.out).toContain('no managed worktrees')

    expect((await run(['worktree', 'prune'], {})).code).toBe(2)
  })
})

describe('bind verbs (plugin-owned binding store)', () => {
  it('bind then binding then unbind round-trips through the store', async () => {
    const root = join(scratchDir(), 'state')

    const bind = await run(['bind', '--session', 's1', '--repo', '/repo', '--layers', 'visible', '--state-root', root])
    expect(bind.code).toBe(0)
    const binding = await run(['binding', '--session', 's1', '--state-root', root])
    expect(JSON.parse(binding.out)).toEqual({ repoPath: '/repo', layers: ['visible'] })
    const unbind = await run(['unbind', '--session', 's1', '--state-root', root])
    expect(unbind.code).toBe(0)
    expect((await run(['binding', '--session', 's1', '--state-root', root])).out.trim()).toBe('null')
    expect((await run(['bind', '--session', 's1', '--state-root', root])).code).toBe(2)
    // Binding a session id the CLI cannot verify just files the record (the
    // store keys on the id alone); an invalid binding still fails loud.
    expect((await run(['bind', '--session', 'ghost', '--repo', '/r', '--state-root', root])).code).toBe(0)
  })
})
