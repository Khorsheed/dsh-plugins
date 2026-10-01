/**
 * T65/T91 — the scope's own copy of a preset package, as the evaluation reads it: the
 * digest that makes the subject checkable offline, and the composition shape
 * a factor may not have.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compositionAbsolutePaths, hashPresetTree, scopePresetDir, scopePresetProblem } from '../src/preset-snapshot.ts'

const RELOCATABLE = `- insert:
    - id: preset-eval-lean
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: eval-lean
        plugins:
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              includeDefaultRoots: false
              customSkillDirs:
                - !!js "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@dataseek-eval/preset-eval-lean/package.json')), 'skills')"
`

/** One preset package directory, written wherever the caller says. */
function preset(dir: string, options: { composition?: string; body?: string } = {}): string {
  mkdirSync(join(dir, 'skills', 'eval-planning'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@dataseek-eval/preset-eval-lean', version: '0.0.0', private: true, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(dir, 'cordis.patch.yml'), options.composition ?? RELOCATABLE)
  writeFileSync(join(dir, 'skills', 'eval-planning', 'SKILL.md'), options.body ?? 'Draft the plan. One stage.\n')
  return dir
}

const temp = (): string => mkdtempSync(join(tmpdir(), 'eval-preset-'))

describe('hashPresetTree', () => {
  it('is content-addressed: the same bytes in two places, under two names, hash alike', async () => {
    // This is the claim the whole arrangement rests on. The capability face
    // carries no filesystem path, so a fingerprint taken against the
    // deployment's copy describes the scope's copy exactly when the two hold
    // the same bytes — and "the same bytes" is what this digest means.
    const here = preset(join(temp(), 'eval-lean'))
    const there = preset(join(temp(), 'renamed-lean'))
    expect((await hashPresetTree(here))?.sha).toBe((await hashPresetTree(there))?.sha)
  })

  it('moves when a skill BODY changes — the edit `home.sha` never sees', async () => {
    const before = preset(join(temp(), 'eval-lean'))
    const after = preset(join(temp(), 'eval-lean'), { body: 'Draft the plan. TWO stages.\n' })
    expect((await hashPresetTree(before))?.sha).not.toBe((await hashPresetTree(after))?.sha)
  })

  it('counts every file, not just the config-suffixed ones', async () => {
    expect((await hashPresetTree(preset(join(temp(), 'eval-lean'))))?.files).toBe(3)
  })

  it('refuses a tree with a symlink in it — a link does not survive the bind mount', async () => {
    const dir = preset(join(temp(), 'eval-lean'))
    symlinkSync(join(dir, 'cordis.patch.yml'), join(dir, 'alias.yml'))
    expect(await hashPresetTree(dir)).toBeUndefined()
  })

  it('reads a directory that is not there as undefined, never as an empty face', async () => {
    expect(await hashPresetTree(join(temp(), 'absent'))).toBeUndefined()
  })
})

describe('compositionAbsolutePaths', () => {
  it('passes the package-relative expression the official web-app presets use', () => {
    expect(compositionAbsolutePaths(RELOCATABLE)).toEqual([])
  })

  it('catches a plain absolute string and one hidden inside an expression', () => {
    expect(compositionAbsolutePaths('- config:\n    customSkillDirs:\n      - "/opt/p/skills"\n'))
      .toEqual(['/opt/p/skills'])
    expect(compositionAbsolutePaths('- config:\n    dir: !!js "process.env.X ?? \'/opt/p/skills\'"\n'))
      .toEqual(['/opt/p/skills'])
  })

  it('reports nothing for a composition it cannot parse — the loader owns that verdict', () => {
    expect(compositionAbsolutePaths('not: [a, list')).toEqual([])
  })
})

describe('scopePresetProblem', () => {
  it('accepts a relocatable preset package', async () => {
    expect(await scopePresetProblem(preset(join(temp(), 'eval-lean')))).toBeUndefined()
  })

  it('refuses a directory that is not a preset at all', async () => {
    expect(await scopePresetProblem(join(temp(), 'nothing'))).toMatch(/holds no readable package\.json/)
  })

  it('refuses a package whose patch declares no preset row', async () => {
    const dir = preset(join(temp(), 'eval-lean'), { composition: '- id: tools\n' })
    expect(await scopePresetProblem(dir)).toMatch(/declares no @deepseek-ai\/dsh-agent-preset row/)
  })

  it('refuses an absolute skills root and names the idiom that replaces it', async () => {
    const dir = preset(join(temp(), 'eval-lean'), {
      composition: '- config:\n    customSkillDirs:\n      - "/opt/dsh-lab/.agent-presets/eval-lean/skills"\n',
    })
    expect(await scopePresetProblem(dir)).toMatch(/absolute path\(s\).*baseUrl/s)
  })
})

describe('scopePresetDir', () => {
  it('is the scope\'s preset package copy inside the scoped home', () => {
    expect(scopePresetDir('/creds/dsh', 'eval-lean')).toBe('/creds/dsh/preset-packages/eval-lean')
  })
})
