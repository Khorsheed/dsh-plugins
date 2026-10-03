/**
 * T94: every file the shipped dataset-authoring skill points the model at must
 * exist once the package is installed. The 3185 walk-through showed what
 * happens otherwise: SKILL.md named `docs/dataset-authoring-protocol.md`, a
 * repo path no installed package carries, and the organizing agent searched
 * the whole disk (and another instance's plugin lib) for it.
 *
 * The skill reaches the model as text, so its references are install-relative
 * placeholders (`{{skillDir}}/…`, `{{packageDir}}/…`) the loader resolves to
 * absolute paths. These tests pin both halves: the resolved text names real
 * files, and the package's publish file list (what `npm pack` would ship —
 * the same `files` globs pack-dist honors) carries every one of them.
 *
 * Both depend on build output (the protocol copy and `lib/cli.js`), so they
 * run after `pnpm run build`, as the build contract orders every test.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTHORING_SKILL_DIR, loadAuthoringSkill, resolveSkillPaths } from '../src/tool.ts'

const PKG = join(import.meta.dirname, '..')
const RAW = readFileSync(join(AUTHORING_SKILL_DIR, 'SKILL.md'), 'utf8')

/** Every `{{skillDir}}/…` / `{{packageDir}}/…` reference, as a package-relative path. */
function referencedFiles(raw: string): string[] {
  const out = new Set<string>()
  for (const match of raw.matchAll(/\{\{(skillDir|packageDir)\}\}\/([A-Za-z0-9._/-]+)/g)) {
    out.add(match[1] === 'skillDir' ? `skills/dataset-authoring/${match[2]}` : match[2]!)
  }
  return [...out].sort()
}

/** The files `npm pack` would put in the tarball (package-relative). */
function packedFiles(): Set<string> {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: PKG,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'silent' },
  })
  const [report] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>
  return new Set(report!.files.map(file => file.path))
}

describe('dataset-authoring skill — shipped references', () => {
  it('references the bundled protocol (both languages) and the CLI, never a repo-only docs/ path', () => {
    expect(referencedFiles(RAW)).toEqual([
      'lib/cli.js',
      'skills/dataset-authoring/protocol.en.md',
      'skills/dataset-authoring/protocol.zh.md',
    ])
    expect(RAW).not.toMatch(/docs\/dataset-authoring-protocol/)
  })

  it('the loaded skill carries absolute paths that exist, and no unresolved placeholder', () => {
    const skill = loadAuthoringSkill()
    expect(skill).toBeDefined()
    expect(skill!.content).not.toMatch(/\{\{\w+\}\}/)
    for (const rel of referencedFiles(RAW)) {
      const abs = join(PKG, rel)
      expect(skill!.content).toContain(abs)
      expect(existsSync(abs), `${rel} must exist after build`).toBe(true)
    }
  })

  it('the bundled protocol is the repo protocol, byte for byte', () => {
    const docs = join(PKG, '..', '..', 'docs')
    expect(readFileSync(join(AUTHORING_SKILL_DIR, 'protocol.en.md'), 'utf8'))
      .toBe(readFileSync(join(docs, 'dataset-authoring-protocol.en.md'), 'utf8'))
    expect(readFileSync(join(AUTHORING_SKILL_DIR, 'protocol.zh.md'), 'utf8'))
      .toBe(readFileSync(join(docs, 'dataset-authoring-protocol.md'), 'utf8'))
  })

  it('the publish file list ships SKILL.md and every file it references', () => {
    const packed = packedFiles()
    for (const rel of ['skills/dataset-authoring/SKILL.md', ...referencedFiles(RAW)]) {
      expect(packed.has(rel), `${rel} missing from the npm pack file list`).toBe(true)
    }
  }, 60_000)

  it('the ground rules keep the agent inside source, target and protocol', () => {
    const text = resolveSkillPaths(RAW)
    for (const rule of [
      'Read only three places',
      'Rules come from the tools, not from code',
      'Never search the disk',
      'Never read any plugin\'s source code or `lib/`',
      'never read another dsh instance\'s directories',
      '-maxdepth',
      'Right away',
    ]) expect(text).toContain(rule)
  })
})
