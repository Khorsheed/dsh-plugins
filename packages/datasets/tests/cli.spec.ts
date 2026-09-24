/** CLI: parse, exit-code semantics, the read verbs, materialization, and the registry verbs. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, runCli, type CliIo } from '../src/cli.ts'
import { removeReadOnlyTree } from '../src/materialize.ts'
import { cleanup, git, makeFixtureRepo, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let scratch: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
  repo = undefined
  scratch = undefined
})

const scratchDir = (): string => scratch ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-cli-'))

/**
 * Capture one CLI run. A run that names no `--state-root` gets the scratch
 * one: without it the CLI would read the machine's real registry.
 */
async function run(argv: readonly string[], extra: readonly string[] = []): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const io: CliIo = { stdout: line => { out += line }, stderr: line => { err += line } }
  const all = [...argv, ...extra]
  const code = await runCli(all.includes('--state-root') ? all : [...all, '--state-root', join(scratchDir(), 'state')], io)
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
    const env = ['--repo', repo.dir]
    const list = await run(['list'], env)
    expect(list.code).toBe(0)
    expect(list.out).toContain('alpha')
    // Mixed fixture: the undeclared 'visible' layer warns on stderr (list/show/describe).
    expect(list.err).toContain('MODELFACING_UNDECLARED')
    expect(list.out).toContain('non-model-facing: hidden')

    const items = await run(['list', '--dataset', 'alpha'], env)
    expect(items.out).toContain('shared: visible/(1)')
    expect(items.out).toContain('i1')

    const show = await run(['show', '--dataset', 'alpha', '--item', 'i1'], env)
    expect(show.code).toBe(0)
    expect(show.err).toContain('MODELFACING_UNDECLARED')
    expect(show.out).toContain('visible/task.md')
    expect(show.out).toContain('hidden/notes.md')

    const describeResult = await run(['describe', '--dataset', 'alpha'], env)
    expect(describeResult.err).toContain('MODELFACING_UNDECLARED')
    expect(JSON.parse(describeResult.out)).toMatchObject({ id: 'alpha', extra: { passthrough: true } })

    const read = await run(['read', '--dataset', 'alpha', '--item', 'i1', '--layer', 'visible', '--path', 'task.md'], env)
    expect(read.code).toBe(0)
    expect(read.out).toBe('task one v1\n')

    const snapshot = await run(['snapshot', '--dataset', 'alpha'], env)
    expect(JSON.parse(snapshot.out)).toMatchObject({ commit: repo.commit, datasetId: 'alpha' })

    expect((await run(['show'], env)).code).toBe(2)
    expect((await run(['read', '--dataset', 'alpha'], env)).code).toBe(2)
    expect((await run(['nonsense'], env)).code).toBe(2)
    expect((await run(['list'])).code).toBe(1) // nothing registered, no --repo: fail loud
    // Registered once, --repo may be dropped: the only registration answers, by its id too.
    expect((await run(['register', '--repo', repo.dir, '--id', 'lib'])).code).toBe(0)
    expect((await run(['snapshot', '--dataset', 'alpha'])).out).toContain(repo.commit)
    expect((await run(['snapshot', '--dataset', 'alpha', '--repo', 'lib'])).out).toContain(repo.commit)
    expect((await run(['show', '--dataset', 'ghost'], env)).code).toBe(1)
  })
})

describe('worktree path (git archive materialization)', () => {
  it('prints a read-only, content-addressed directory; a repeat hits the cache', async () => {
    repo = makeFixtureRepo()
    const root = join(scratchDir(), 'materialized')
    const env = ['--repo', repo.dir]
    const first = await run(['worktree', 'path', '--dataset', 'alpha', '--layers', 'visible', '--materialized-root', root], env)
    expect(first.code).toBe(0)
    const path = first.out.trim()
    expect(path.endsWith(join(repo.commit, 'alpha', 'visible'))).toBe(true)
    expect(existsSync(join(path, 'datasets/alpha/items/i1/visible/task.md'))).toBe(true)
    expect(existsSync(join(path, 'datasets/alpha/items/i1/hidden'))).toBe(false)
    const again = await run(['worktree', 'path', '--dataset', 'alpha', '--layers', 'visible', '--materialized-root', root], env)
    expect(again.out.trim()).toBe(path)
    // Nothing was registered in the repository's shared .git.
    expect(git(repo.dir, ['worktree', 'list']).trim().split('\n')).toHaveLength(1)
    removeReadOnlyTree(root)
  })
})

describe('registry verbs (human-only writes)', () => {
  it('register → registry → update → unregister round-trips through the file', async () => {
    repo = makeFixtureRepo()
    const root = join(scratchDir(), 'state')
    const registered = await run(['register', '--repo', repo.dir, '--id', 'lib', '--set-layers', 'alpha=visible+hidden', '--state-root', root])
    expect(registered).toMatchObject({ code: 0, out: 'registered lib (tracking main)\n' })
    const listed = JSON.parse((await run(['registry', '--state-root', root])).out) as Array<Record<string, unknown>>
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: 'lib', trackedRef: 'main', sets: { alpha: { layers: ['hidden', 'visible'] } } })
    // A second registration of the same repository is refused.
    expect((await run(['register', '--repo', join(repo.dir, 'datasets'), '--state-root', root])).code).toBe(1)
    // A branch that does not exist is refused, not guessed.
    const missing = await run(['update', '--id', 'lib', '--tracked-ref', 'nope', '--state-root', root])
    expect(missing.code).toBe(1)
    expect(missing.err).toContain('does not exist')
    expect((await run(['unregister', '--id', 'lib', '--state-root', root])).code).toBe(0)
    expect((await run(['unregister', '--id', 'lib', '--state-root', root])).code).toBe(1)
    expect((await run(['register', '--state-root', root])).code).toBe(2)
  })

  it('bind is retired and points at register; the legacy binding/unbind verbs are gone', async () => {
    const root = join(scratchDir(), 'state')
    const bind = await run(['bind', '--session', 's1', '--repo', '/repo', '--state-root', root])
    expect(bind.code).toBe(2)
    expect(bind.err).toContain('dsh-datasets register')
    expect((await run(['binding', '--session', 's1', '--state-root', root])).code).toBe(2)
    expect((await run(['unbind', '--session', 's1', '--state-root', root])).code).toBe(2)
  })
})
