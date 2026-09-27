import { describe, expect, it } from 'vitest'
import { GLOBAL_PATHS, isGlobalPath, packageFilter, porcelainPaths, resolveScope, trimTrailingNewlines, type Outcome, type Runner } from './gate.mts'

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

describe('trimTrailingNewlines', () => {
  it('keeps the leading space that marks an unstaged change — `.trim()` ate it, and only on the first line', () => {
    expect(trimTrailingNewlines(' M scripts/gate.mts\n?? note.md\n')).toBe(' M scripts/gate.mts\n?? note.md')
  })

  it('still drops the trailing blank tail every other caller used .trim() for', () => {
    expect(trimTrailingNewlines('v0.1.5\n\n')).toBe('v0.1.5')
    expect(trimTrailingNewlines('')).toBe('')
  })
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

  it('takes the path from after the two status columns, whichever of them is a space', () => {
    // A fixed slice(3) reads these identically; it is a line that has LOST a
    // column that tells the two apart, and that line must not yield a path.
    expect(porcelainPaths(' M scripts/gate.mts')).toEqual(['scripts/gate.mts'])
    expect(porcelainPaths('MM scripts/gate.mts')).toEqual(['scripts/gate.mts'])
    expect(porcelainPaths('M scripts/gate.mts')).toEqual([])
  })

  it('reads both ends of a rename detected in the WORKTREE column too', () => {
    expect(porcelainPaths(' R packages/x/a.ts -> scripts/a.ts'))
      .toEqual(['packages/x/a.ts', 'scripts/a.ts'])
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

  it("refuses to scope when a profile's scripts change — they build and pack every member", () => {
    for (const path of ['profiles/web-eval/scripts/install.sh', 'profiles/basic/scripts/update.sh']) {
      const scope = resolveScope(stub({ 'git diff --name-only': ok(path), 'git status --porcelain': ok('') }), base)
      expect(scope.filter, `${path} must force a whole-repo run`).toBeUndefined()
      expect(scope.why).toContain(path)
    }
    // The rest of a profile is that profile's own business and still scopes.
    expect(isGlobalPath('profiles/web-eval/cordis.patch.yml')).toBe(false)
    expect(isGlobalPath('profiles/web-eval/docs/README.md')).toBe(false)
    // And the pattern is anchored: a package path that merely mentions the
    // segments is not a profile script.
    expect(isGlobalPath('packages/eval/profiles/x/scripts/a.sh')).toBe(false)
  })

  it('refuses to scope when the FIRST porcelain line is an UNSTAGED shared-layer file', () => {
    // The bytes git prints for an unstaged change begin with a space, and this
    // is the whole path they travel: runner trim, then parse. `.trim()` ate the
    // space, `slice(3)` dropped a character, the path matched no shared layer
    // and the gate reported scope NONE — skipping build, test and pack on a
    // change to the scripts every package runs (T51).
    for (const path of ['scripts/gate.mts', 'profiles/web-eval/scripts/update.sh']) {
      const scope = resolveScope(stub({
        'git diff --name-only': ok(''),
        'git status --porcelain': ok(trimTrailingNewlines(` M ${path}\n`)),
      }), base)
      expect(scope.filter, `${path} must force a whole-repo run`).toBeUndefined()
      expect(scope.why).toContain(path)
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
