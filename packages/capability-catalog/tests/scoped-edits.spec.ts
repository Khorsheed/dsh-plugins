import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  adoptManagedSkill,
  findSkillSource,
  releaseManagedSkill,
  setManagedPresetScope,
  withPresetScope,
} from '../src/scoped-edits.ts'
import { scopedSkillsRoot } from '../src/scoped-delivery.ts'

const SKILL = [
  '---',
  'name: md-to-wechat',
  'description: Publish to WeChat',
  'version: 1.1.0',
  '---',
  '',
  '# md-to-wechat',
  '',
].join('\n')

describe('withPresetScope', () => {
  it('adds a metadata block and keeps every other key', () => {
    const updated = withPresetScope(SKILL, ['dsh-writing'])
    expect(updated).toContain('version: 1.1.0')
    expect(updated).toContain('description: Publish to WeChat')
    expect(updated).toContain('metadata:\n  presetScope: [dsh-writing]')
    expect(updated.endsWith('# md-to-wechat\n')).toBe(true)
  })

  it('replaces an inline value in place, under an existing metadata block', () => {
    const source = SKILL.replace('version: 1.1.0', 'metadata:\n  presetScope: [old]\n  credentials: []')
    const updated = withPresetScope(source, ['dev', 'dsh-writing'])
    expect(updated).toContain('metadata:\n  presetScope: [dev, dsh-writing]\n  credentials: []')
    expect(updated).not.toContain('[old]')
  })

  it('replaces a block-list form and its items', () => {
    const source = SKILL.replace('version: 1.1.0', 'metadata:\n  presetScope:\n    - old\n  credentials: []')
    const updated = withPresetScope(source, ['dev'])
    expect(updated).toContain('metadata:\n  presetScope: [dev]\n  credentials: []')
    expect(updated).not.toContain('- old')
  })

  it('writes an explicit empty list and de-duplicates ids', () => {
    expect(withPresetScope(SKILL, [])).toContain('presetScope: []')
    expect(withPresetScope(SKILL, ['a', 'a', 'b'])).toContain('presetScope: [a, b]')
  })

  it('refuses a file with no frontmatter block', () => {
    expect(() => withPresetScope('# nothing', ['x'])).toThrow(/no frontmatter/)
  })
})

describe('managed writes over a temp home', () => {
  let home: string

  beforeAll(async () => {
    process.env.DSH_AGENTS_HOME = await mkdtemp(join(tmpdir(), 'catalog-agents-'))
  })

  afterEach(async () => {
    if (home !== undefined) await rm(home, { recursive: true, force: true })
  })

  /** Create a managed (or default-root) skill directory. */
  async function putSkill(root: string, name: string, text = SKILL): Promise<string> {
    const dir = join(root, name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), text)
    return dir
  }

  it('sets the scope on a managed skill and reports an unknown name', async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-edits-'))
    const root = scopedSkillsRoot(home)
    await putSkill(root, 'md-to-wechat')
    expect(await setManagedPresetScope(home, 'md-to-wechat', ['dsh-writing'])).toEqual({ ok: true })
    expect(await readFile(join(root, 'md-to-wechat', 'SKILL.md'), 'utf8')).toContain('presetScope: [dsh-writing]')
    expect((await setManagedPresetScope(home, 'nope', ['x'])).ok).toBe(false)
    expect((await setManagedPresetScope(home, 'Bad Name', ['x'])).error).toMatch(/not a valid skill name/)
  })

  it('adopts a directory skill out of the default root and declares its scope', async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-edits-'))
    const source = await putSkill(join(home, 'skills'), 'md-to-wechat')
    const result = await adoptManagedSkill(home, 'md-to-wechat', ['dsh-writing'])
    expect(result).toEqual({ ok: true })
    expect(existsSync(source)).toBe(false)
    const adopted = join(scopedSkillsRoot(home), 'md-to-wechat', 'SKILL.md')
    expect(existsSync(adopted)).toBe(true)
    expect(await readFile(adopted, 'utf8')).toContain('presetScope: [dsh-writing]')
  })

  it('adopts a flat <name>.md file and copies its resources-free body', async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-edits-'))
    await mkdir(join(home, 'skills'), { recursive: true })
    const flat = join(home, 'skills', 'md-to-wechat.md')
    await writeFile(flat, SKILL)
    expect(await adoptManagedSkill(home, 'md-to-wechat', ['dev'])).toEqual({ ok: true })
    expect(existsSync(flat)).toBe(false)
    expect(await readFile(join(scopedSkillsRoot(home), 'md-to-wechat', 'SKILL.md'), 'utf8'))
      .toContain('presetScope: [dev]')
  })

  it('refuses an occupied target and a missing source, leaving the source in place', async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-edits-'))
    const source = await putSkill(join(home, 'skills'), 'md-to-wechat')
    await putSkill(scopedSkillsRoot(home), 'md-to-wechat')
    expect((await adoptManagedSkill(home, 'md-to-wechat', ['dev'])).error).toMatch(/already holds/)
    expect(existsSync(source)).toBe(true)
    expect((await adoptManagedSkill(home, 'absent', ['dev'])).error).toMatch(/was not found/)
  })

  it('reports the default root a skill would be adopted from', async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-edits-'))
    await putSkill(join(home, 'skills'), 'md-to-wechat')
    expect(findSkillSource(home, undefined, 'md-to-wechat')).toMatchObject({ root: join(home, 'skills') })
    expect(findSkillSource(home, undefined, 'absent')).toBeUndefined()
  })

  it('releases a managed skill back to the user root, removing the managed copy', async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-edits-'))
    const managed = await putSkill(scopedSkillsRoot(home), 'md-to-wechat')
    expect(await releaseManagedSkill(home, 'md-to-wechat')).toEqual({ ok: true })
    expect(existsSync(managed)).toBe(false)
    expect(existsSync(join(home, 'skills', 'md-to-wechat', 'SKILL.md'))).toBe(true)
    // The managed root now holds nothing, but it still exists for the next write.
    expect(await readdir(scopedSkillsRoot(home))).toEqual([])
  })

  it('refuses to release onto an existing default-root skill and refuses unknown names', async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-edits-'))
    await putSkill(scopedSkillsRoot(home), 'md-to-wechat')
    await putSkill(join(home, 'skills'), 'md-to-wechat')
    expect((await releaseManagedSkill(home, 'md-to-wechat')).error).toMatch(/already exists/)
    expect((await releaseManagedSkill(home, 'absent')).error).toMatch(/not a managed skill/)
  })
})
