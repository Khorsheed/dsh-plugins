import { describe, expect, it } from 'vitest'
import { GLOBAL_PATHS, packageFilter, porcelainPaths, resolveScope, type Outcome, type Runner } from './gate.mts'

/** A runner driven by a table, so every branch — including the ones that only
 * happen when a command fails — is reachable without a git repository. */
function stub(table: Record<string, Outcome>, fallback: Outcome = { ok: true, out: '' }): Runner {
  return (command) => {
    for (const [pattern, outcome] of Object.entries(table)) {
      if (command.includes(pattern)) return outcome
    }
    return fallback
  }
}

const ok = (out: string): Outcome => ({ ok: true, out })
const failed: Outcome = { ok: false, out: '' }

it('excludes the recursive root orchestrator for both scoped and full execution', () => {
  expect(packageFilter('...[main]')).toBe('--filter "...[main]" --filter \'!.\'')
  expect(packageFilter(undefined)).toBe('-r --filter \'!.\'')
  const seen: string[] = []
  resolveScope(command => { seen.push(command); return ok('') }, { all: false })
  expect(seen.find(command => command.startsWith('pnpm '))).toContain("--filter '!.'")
})

describe('porcelainPaths', () => {
  it('reads both ends of a rename — the old path alone would miss a move INTO a shared layer', () => {
    expect(porcelainPaths('R  packages/x/a.ts -> scripts/a.ts'))
      .toEqual(['packages/x/a.ts', 'scripts/a.ts'])
  })

  it('reads ordinary, staged and untracked entries', () => {
    expect(porcelainPaths(' M packages/x/a.ts\nA  packages/y/b.ts\n?? packages/z/c.ts'))
      .toEqual(['packages/x/a.ts', 'packages/y/b.ts', 'packages/z/c.ts'])
  })

  it('unquotes paths git quoted for spaces', () => {
    expect(porcelainPaths('?? "packages/x/a b.ts"')).toEqual(['packages/x/a b.ts'])
  })

  it('ignores blank and truncated lines', () => {
    expect(porcelainPaths('\n M\n')).toEqual([])
  })
})

describe('resolveScope', () => {
  const base = { all: false }

  it('falls back to the whole repo when the package filter FAILS — never to "nothing changed"', () => {
    const scope = resolveScope(stub({
      'git diff --name-only': ok('packages/whalesong/src/index.ts'),
      'git status --porcelain': ok(''),
      'pnpm --filter': failed,
    }), base)
    expect(scope.filter).toBeUndefined()
    expect(scope.why).toContain('package filter failed')
  })

  it('reports NONE only when the filter SUCCEEDS and selects nothing', () => {
    const scope = resolveScope(stub({
      'git diff --name-only': ok('README.md'),
      'git status --porcelain': ok(''),
      'pnpm --filter': ok(''),
    }), base)
    expect(scope.filter).toBe('NONE')
  })

  it('falls back to the whole repo when the diff or status cannot be read', () => {
    expect(resolveScope(stub({ 'git diff --name-only': failed }), base).why).toContain('could not read changes')
    expect(resolveScope(stub({ 'git status --porcelain': failed }), base).why).toContain('could not read changes')
  })

  it('refuses to scope when a committed change touches a shared layer', () => {
    for (const path of GLOBAL_PATHS) {
      const scope = resolveScope(stub({ 'git diff --name-only': ok(`${path}probe`), 'git status --porcelain': ok('') }), base)
      expect(scope.filter, `${path} must force a whole-repo run`).toBeUndefined()
    }
  })

  it('refuses to scope when a file is RENAMED into a shared layer', () => {
    const scope = resolveScope(stub({
      'git diff --name-only': ok(''),
      'git status --porcelain': ok('R  packages/x/helper.ts -> scripts/helper.ts'),
    }), base)
    expect(scope.filter).toBeUndefined()
    expect(scope.why).toContain('scripts/helper.ts')
  })

  it('scopes to the selected packages when nothing shared was touched', () => {
    const scope = resolveScope(stub({
      'git diff --name-only': ok('packages/whalesong/src/index.ts'),
      'git status --porcelain': ok(''),
      'pnpm --filter': ok('/repo/packages/whalesong\n/repo/packages/room'),
    }), base)
    expect(scope.dirs).toEqual(['room', 'whalesong'])
    expect(scope.filter).toBe('...[main]')
  })

  it('prefers local main over origin/main — origin is far behind when pushes are batched', () => {
    const seen: string[] = []
    const run: Runner = (command) => {
      seen.push(command)
      if (command.includes('rev-parse --verify')) return command.includes(' main') && !command.includes('origin/main') ? ok('sha') : failed
      if (command.includes('git diff --name-only')) return ok('')
      return ok('')
    }
    expect(resolveScope(run, base).why).toContain('main')
    expect(seen.some((c) => c.includes('git diff --name-only main...HEAD'))).toBe(true)
  })

  it('honours --since, and ignores one that does not resolve', () => {
    const run = stub({
      'rev-parse --verify --quiet nope': failed,
      'git diff --name-only': ok(''),
      'git status --porcelain': ok(''),
    }, ok('sha'))
    expect(resolveScope(run, { all: false, since: 'nope' }).why).toContain('main')
    expect(resolveScope(run, { all: false, since: 'origin/main' }).why).toContain('origin/main')
  })

  it('--all short-circuits before any command runs', () => {
    let called = 0
    const scope = resolveScope(() => { called += 1; return ok('') }, { all: true })
    expect(scope.filter).toBeUndefined()
    expect(called).toBe(0)
  })
})
