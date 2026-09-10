/**
 * The web-eval profile scripts' preflight: it must run BEFORE anything is
 * written.
 *
 * Both scripts replace two things whole — the profile template and the agent
 * preset directory under `$DSH_HOME/.agent-presets` — and both used to reach
 * their first `dsh` call only after doing so (install.sh also after building
 * and packing every member). On a machine missing its preconditions that
 * meant minutes of work and a replaced preset before the failure. These
 * fixtures run each script against a temporary `$DSH_HOME` with a marker file
 * in the preset directory and assert the marker is still there.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(import.meta.dirname, '..')
const PROFILE = join(REPO, 'profiles/web-eval')

/** A `$DSH_HOME` with an installed-looking preset the scripts would replace. */
function stageHome(): { home: string; marker: string } {
  const home = mkdtempSync(join(tmpdir(), 'web-eval-preflight-'))
  const presetDir = join(home, '.agent-presets/eval')
  mkdirSync(presetDir, { recursive: true })
  const marker = join(presetDir, 'agent.cordis.yml')
  writeFileSync(marker, '# the operator\'s installed preset\n', 'utf8')
  return { home, marker }
}

/** A copy of the profile whose patch pins a headless bundle that does not exist. */
function stageProfileWithMissingPin(): string {
  const src = mkdtempSync(join(tmpdir(), 'web-eval-src-'))
  cpSync(PROFILE, src, { recursive: true })
  const patchPath = join(src, 'cordis.patch.yml')
  const patch = readFileSync(patchPath, 'utf8')
    .replace(/headlessBundleDir: .*/, 'headlessBundleDir: /nonexistent/dsh-headless/bundle')
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

/** A PATH with the ordinary tools but no `dsh`. */
const NO_DSH_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

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
    // A `dsh` that answers --version, so the failure is the pin and nothing else.
    const binDir = mkdtempSync(join(tmpdir(), 'web-eval-bin-'))
    writeFileSync(join(binDir, 'dsh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const result = runScript('install.sh', { home, path: `${binDir}:${NO_DSH_PATH}`, src })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('/nonexistent/dsh-headless/bundle')
    expect(result.stderr).toContain('preflight failed — nothing has been written')
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
