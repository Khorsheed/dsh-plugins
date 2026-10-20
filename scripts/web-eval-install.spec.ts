/**
 * The web-eval profile scripts' preflight: it must run BEFORE anything is
 * written.
 *
 * Both scripts replace things whole — the profile template; from I5·T34 until
 * T100 also the skill directories under `$DSH_HOME/skills`; until T82 also the agent
 * preset directory under `$DSH_HOME/.agent-presets` — and both used to reach
 * their first `dsh` call only after doing so (install.sh also after building
 * and packing every member). On a machine missing its preconditions that meant
 * minutes of work and a replaced preset before the failure. These fixtures run
 * each script against a temporary `$DSH_HOME` with a marker file in the
 * 0.1.5-era preset directory and assert the marker is still there — since T82
 * the scripts never write there at all, so the marker doubles as proof of it.
 * Since T82 the preflight also refuses a host below 0.2.0-rc.2.
 *
 * The last describe is not about preflight at all: it pins that the pack
 * ships NOTHING into the shared `$DSH_HOME/skills` root any more (T100 — the
 * eval-planning skill rides the eval package's tool row), and that a copy an
 * earlier install left there is retired.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(import.meta.dirname, '..')
const PROFILE = join(REPO, 'profiles/eval')

/** A `$DSH_HOME` with an installed-looking preset the scripts would replace. */
function stageHome(): { home: string; marker: string } {
  const home = mkdtempSync(join(tmpdir(), 'web-eval-preflight-'))
  const presetDir = join(home, '.agent-presets/eval')
  mkdirSync(presetDir, { recursive: true })
  const marker = join(presetDir, 'agent.cordis.yml')
  writeFileSync(marker, '# the operator\'s installed preset\n', 'utf8')
  return { home, marker }
}

/**
 * A copy of the profile whose patch pins a shared (host + unit) headless bundle
 * that does not exist. Since T91 the shipped patch pins only the in-unit path
 * (`unitHeadlessBundleDir`, no host requirement), so the stage swaps that line
 * for the shared `headlessBundleDir` form the preflight still guards.
 */
function stageProfileWithMissingPin(): string {
  const src = mkdtempSync(join(tmpdir(), 'web-eval-src-'))
  cpSync(PROFILE, src, { recursive: true })
  const patchPath = join(src, 'cordis.patch.yml')
  const patch = readFileSync(patchPath, 'utf8')
    .replace(/unitHeadlessBundleDir: .*/, 'headlessBundleDir: /nonexistent/dsh-headless/bundle')
  if (!patch.includes('headlessBundleDir: /nonexistent/dsh-headless/bundle')) throw new Error('stage: no headless pin to swap')
  writeFileSync(patchPath, patch, 'utf8')
  return src
}

/** Run one profile script with a PATH and DSH_HOME of our choosing. */
function runScript(script: string, options: { home: string; path: string; src?: string }): {
  status: number
  stderr: string
} {
  const dir = options.src ?? PROFILE
  try {
    execFileSync('sh', [join(dir, 'scripts', script)], {
      env: { PATH: options.path, DSH_HOME: options.home, HOME: options.home },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stderr?: string }
    return { status: failure.status ?? -1, stderr: failure.stderr ?? '' }
  }
}

/** A directory holding a `dsh` whose --version prints `version`. */
function fakeDsh(version: string): string {
  const binDir = mkdtempSync(join(tmpdir(), 'web-eval-bin-'))
  writeFileSync(join(binDir, 'dsh'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
  return binDir
}

/** A PATH with the ordinary tools but no `dsh`. */
const NO_DSH_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * A PATH with a fake `dsh` plus `node` — the host-line comparison runs in node,
 * which any machine with a real `dsh` (a node CLI) already has.
 */
const withDsh = (binDir: string): string => `${binDir}:${dirname(process.execPath)}:${NO_DSH_PATH}`

describe('web-eval install.sh preflight', () => {
  it('exits before writing anything when dsh is not on PATH', () => {
    const { home, marker } = stageHome()
    const result = runScript('install.sh', { home, path: NO_DSH_PATH })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('preflight failed — nothing has been written')
    expect(result.stderr).toContain('missing: `dsh` on PATH')
    // The two things the script replaces whole are untouched.
    expect(readFileSync(marker, 'utf8')).toContain("the operator's installed preset")
    expect(existsSync(join(home, 'profiles/web-eval'))).toBe(false)
  })

  it('exits before writing anything when the pinned headless bundle is absent', () => {
    const { home, marker } = stageHome()
    const src = stageProfileWithMissingPin()
    // A `dsh` that answers --version with a supported host, so the failure is the pin and nothing else.
    const binDir = fakeDsh('0.2.0-rc.2')
    const result = runScript('install.sh', { home, path: withDsh(binDir), src })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('/nonexistent/dsh-headless/bundle')
    expect(result.stderr).toContain('preflight failed — nothing has been written')
    expect(readFileSync(marker, 'utf8')).toContain("the operator's installed preset")
    expect(existsSync(join(home, 'profiles/web-eval'))).toBe(false)
  })

  it('exits before writing anything on a host below 0.2.0-rc.2 (T82)', () => {
    const { home, marker } = stageHome()
    const result = runScript('install.sh', { home, path: withDsh(fakeDsh('0.1.5-rc.1')) })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('supports host 0.2.0-rc.2 and later only')
    expect(result.stderr).toContain('rc-0.2.0-rc.2')
    expect(readFileSync(marker, 'utf8')).toContain("the operator's installed preset")
    expect(existsSync(join(home, 'profiles/web-eval'))).toBe(false)
  })
})

describe('web-eval update.sh preflight', () => {
  it('exits before writing anything when dsh is not on PATH — even with a profile installed', () => {
    const { home, marker } = stageHome()
    // An installed-looking profile: without the preflight, update.sh would
    // have replaced its pinned files and the preset before failing.
    const dest = join(home, 'profiles/web-eval')
    mkdirSync(dest, { recursive: true })
    const pinned = join(dest, 'cordis.patch.yml')
    writeFileSync(pinned, '# the installed patch layer\n', 'utf8')
    const result = runScript('update.sh', { home, path: NO_DSH_PATH })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('preflight failed — nothing has been written')
    expect(readFileSync(marker, 'utf8')).toContain("the operator's installed preset")
    expect(readFileSync(pinned, 'utf8')).toBe('# the installed patch layer\n')
  })
})

describe('what the web-eval pack ships outside the profile directory', () => {
  // T100: nothing. The eval-planning skill ships inside @khorsheed/dsh-eval and
  // is registered by its `./tool` row (pinned in packages/eval/tests/tool-row.spec.ts),
  // so only sessions whose preset names that row list it. The scripts used to
  // copy it into `$DSH_HOME/skills` — the root dsh-skill-filesystem scans for
  // EVERY preset composing it, dev and writing included.

  it('neither script copies a skill into the shared skills root, and the pack holds no skills/ directory', () => {
    expect(existsSync(join(PROFILE, 'skills'))).toBe(false)
    for (const script of ['install.sh', 'update.sh']) {
      const text = readFileSync(join(PROFILE, 'scripts', script), 'utf8')
      expect(text, script).not.toMatch(/^SKILL_IDS=/m)
      expect(text, script).not.toMatch(/cp -R[^\n]*skills/)
      // The retirement runs only after the run succeeded (after `trap - 0`).
      const body = text.slice(text.indexOf('trap - 0'))
      expect(body, script).toMatch(/^retire_legacy_skill$/m)
    }
  })

  /** Run a script's `retire_legacy_skill` against a home holding `skills/eval-planning/SKILL.md`. */
  function retire(script: string, skillBody: string): { kept: boolean; out: string } {
    const text = readFileSync(join(PROFILE, 'scripts', script), 'utf8')
    const start = text.indexOf('LEGACY_SKILL_DIR=')
    const end = text.indexOf('\n}\n', start) + 3
    const home = mkdtempSync(join(tmpdir(), 'web-eval-legacy-skill-'))
    const dir = join(home, 'skills', 'eval-planning')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), skillBody, 'utf8')
    const out = execFileSync('sh', ['-c', `${text.slice(start, end)}\nretire_legacy_skill`], {
      env: { ...process.env, DSH_HOME: home },
      encoding: 'utf8',
    })
    return { kept: existsSync(join(dir, 'SKILL.md')), out }
  }

  const PACK_COPY = '---\nname: eval-planning\ndescription: Draft an evaluation experiment.\nmetadata:\n  version: 1.0.0\n  iteration: I5\n---\n\n# Drafting an evaluation\n'
  const OWN_COPY = '---\nname: eval-planning\ndescription: my own notes\n---\n\nmine\n'

  for (const script of ['install.sh', 'update.sh']) {
    it(`${script} removes a copy carrying the pack's signature, and leaves anyone else's alone`, () => {
      const pack = retire(script, PACK_COPY)
      expect(pack.kept).toBe(false)
      expect(pack.out).toContain('removed the old pack copy')
      const own = retire(script, OWN_COPY)
      expect(own.kept).toBe(true)
      expect(own.out).toContain('is not the pack\'s copy, so it was left alone')
    })
  }
})
