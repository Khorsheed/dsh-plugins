import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  addSkillFromPayload,
  addSkillFromText,
  addSkillFromZip,
  commandInstall,
  inferModelInvocable,
  isZipPayload,
  listDirSkills,
  managedRoot,
  resolveSkillNameFromContent,
} from '../src/import.ts'
import { extractZip } from '../src/zip.ts'
import type { CatalogAddSkillRequest } from '../src/types.ts'

const SKILL = `---
name: wechat-reading
description: Read WeChat Reading shelf
---

# body
`

const SKILL_DISABLED = `---
name: wechat-reading
description: Read WeChat Reading shelf
disable-model-invocation: true
---

# body
`

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

/** Build a minimal, non-CRC zip (stored or deflated) for tests. */
function buildZip(files: Array<[string, string]>, compress = true): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const [path, content] of files) {
    const name = Buffer.from(path, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const method = compress ? 8 : 0
    const stored = method === 8 ? deflateRawSync(data) : data
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    localParts.push(local, stored)
    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length + stored.length
  }
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, central, eocd])
}

async function tmpHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cap-catalog-'))
}

describe('resolveSkillNameFromContent', () => {
  it('parses name/description from frontmatter', () => {
    expect(resolveSkillNameFromContent(SKILL)).toEqual({ name: 'wechat-reading', description: 'Read WeChat Reading shelf' })
  })

  it('returns undefined for missing frontmatter', () => {
    expect(resolveSkillNameFromContent('# no frontmatter')).toBeUndefined()
  })

  it('returns undefined for an invalid (non-kebab) name', () => {
    const bad = '---\nname: Bad Name\ndescription: d\n---\nbody'
    expect(resolveSkillNameFromContent(bad)).toBeUndefined()
  })
})

describe('inferModelInvocable', () => {
  it('defaults to model-invocable true', () => {
    expect(inferModelInvocable(SKILL)).toBe(true)
  })

  it('reads disable-model-invocation: true as false', () => {
    expect(inferModelInvocable(SKILL_DISABLED)).toBe(false)
  })
})

describe('managedRoot', () => {
  it('resolves user and project roots', () => {
    expect(managedRoot('user', '/home/user/.dsh')).toBe('/home/user/.dsh/skills')
    expect(managedRoot('project', '/home/user/.dsh')).toBe('/home/user/.dsh/.agents/skills')
  })
})

describe('extractZip', () => {
  it('reads deflated and stored entries', () => {
    const zip = buildZip([['a/SKILL.md', SKILL], ['a/x.txt', 'hi']])
    const entries = extractZip(zip)
    expect(entries.map(e => e.path)).toEqual(['a/SKILL.md', 'a/x.txt'])
    expect(entries[0].data.toString('utf8')).toContain('name: wechat-reading')
  })

  it('reads stored entries', () => {
    const zip = buildZip([['SKILL.md', SKILL]], false)
    expect(extractZip(zip)[0].data.toString('utf8')).toContain('# body')
  })

  it('throws on a non-zip buffer', () => {
    expect(() => extractZip(Buffer.from('not a zip'))).toThrow()
  })
})

describe('isZipPayload', () => {
  it('detects a zip archive', () => {
    const zip = buildZip([['wechat-reading/SKILL.md', SKILL]])
    expect(isZipPayload(zip.toString('base64'))).toBe(true)
  })

  it('rejects a raw SKILL.md text payload', () => {
    expect(isZipPayload(base64(SKILL))).toBe(false)
  })
})

describe('addSkillFromZip', () => {
  it('extracts a wrapped skill folder and derives the name from frontmatter', async () => {
    const home = await tmpHome()
    const zip = buildZip([
      ['wechat-reading/SKILL.md', SKILL],
      ['wechat-reading/assets/cover.png', 'PNG'],
    ])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: zip.toString('base64'), modelInvocable: true, root: 'user' }
    const res = await addSkillFromZip(req, home)
    expect(res).toEqual({ ok: true, name: 'wechat-reading' })
    const dir = join(home, 'skills', 'wechat-reading')
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toContain('name: wechat-reading')
    expect(await stat(join(dir, 'assets', 'cover.png'))).toBeTruthy()
  })

  it('extracts a root SKILL.md archive as-is', async () => {
    const home = await tmpHome()
    const zip = buildZip([['SKILL.md', SKILL]])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: zip.toString('base64'), modelInvocable: true, root: 'project' }
    const res = await addSkillFromZip(req, home)
    expect(res.ok).toBe(true)
    expect(await readFile(join(home, '.agents', 'skills', 'wechat-reading', 'SKILL.md'), 'utf8')).toContain('# body')
  })

  it('applies modelInvocable=false by setting the disabled flag', async () => {
    const home = await tmpHome()
    const zip = buildZip([['wechat-reading/SKILL.md', SKILL]])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: zip.toString('base64'), modelInvocable: false, root: 'user' }
    const res = await addSkillFromZip(req, home)
    expect(res.ok).toBe(true)
    const written = await readFile(join(home, 'skills', 'wechat-reading', 'SKILL.md'), 'utf8')
    expect(written).toContain('disable-model-invocation: true')
    expect(inferModelInvocable(written)).toBe(false)
  })

  it('skips path-traversal entries but keeps the skill', async () => {
    const home = await tmpHome()
    const zip = buildZip([['wechat-reading/SKILL.md', SKILL], ['../../evil.txt', 'x']])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: zip.toString('base64'), modelInvocable: true, root: 'user' }
    const res = await addSkillFromZip(req, home)
    expect(res.ok).toBe(true)
    expect(await readFile(join(home, 'skills', 'wechat-reading', 'SKILL.md'), 'utf8')).toContain('# body')
    await expect(stat(join(home, 'evil.txt'))).rejects.toBeTruthy()
  })

  it('fails cleanly when no SKILL.md is present', async () => {
    const home = await tmpHome()
    const zip = buildZip([['readme.txt', 'hi']])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: zip.toString('base64'), modelInvocable: true, root: 'user' }
    const res = await addSkillFromZip(req, home)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('SKILL.md')
  })
})

describe('addSkillFromPayload dispatch', () => {
  it('routes a zip payload to the zip path', async () => {
    const home = await tmpHome()
    const zip = buildZip([['wechat-reading/SKILL.md', SKILL]])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: zip.toString('base64'), modelInvocable: true, root: 'user' }
    const res = await addSkillFromPayload(req, home)
    expect(res).toEqual({ ok: true, name: 'wechat-reading' })
    expect(await readFile(join(home, 'skills', 'wechat-reading', 'SKILL.md'), 'utf8')).toContain('# body')
  })

  it('routes a text payload to the text path', async () => {
    const home = await tmpHome()
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: base64(SKILL), modelInvocable: true, root: 'user' }
    const res = await addSkillFromPayload(req, home)
    expect(res).toEqual({ ok: true, name: 'wechat-reading' })
  })
})

describe('addSkillFromText', () => {
  it('still writes a plain SKILL.md from text', async () => {
    const home = await tmpHome()
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: base64(SKILL), modelInvocable: true, root: 'user' }
    const res = await addSkillFromText(req, home)
    expect(res).toEqual({ ok: true, name: 'wechat-reading' })
  })
})

describe('dedup: same-name skill in the target root', () => {
  it('text: second add without overwrite reports exists', async () => {
    const home = await tmpHome()
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: base64(SKILL), modelInvocable: true, root: 'user' }
    await addSkillFromText(req, home)
    const res = await addSkillFromText(req, home)
    expect(res).toEqual({ ok: false, exists: true, name: 'wechat-reading' })
  })

  it('text: overwrite replaces the SKILL.md content', async () => {
    const home = await tmpHome()
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: base64(SKILL), modelInvocable: true, root: 'user' }
    await addSkillFromText(req, home)
    const res = await addSkillFromText({ ...req, overwrite: true, modelInvocable: false }, home)
    expect(res).toEqual({ ok: true, name: 'wechat-reading' })
    const written = await readFile(join(home, 'skills', 'wechat-reading', 'SKILL.md'), 'utf8')
    expect(inferModelInvocable(written)).toBe(false)
  })

  it('zip: second add without overwrite reports exists', async () => {
    const home = await tmpHome()
    const zip = buildZip([['wechat-reading/SKILL.md', SKILL]])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: zip.toString('base64'), modelInvocable: true, root: 'user' }
    await addSkillFromZip(req, home)
    const res = await addSkillFromZip(req, home)
    expect(res).toEqual({ ok: false, exists: true, name: 'wechat-reading' })
  })

  it('zip: overwrite cleans a stale file from a prior version', async () => {
    const home = await tmpHome()
    const v1 = buildZip([['wechat-reading/SKILL.md', SKILL], ['wechat-reading/stale.txt', 'old']])
    const req: CatalogAddSkillRequest = { channel: 'zip', payload: v1.toString('base64'), modelInvocable: true, root: 'user' }
    await addSkillFromZip(req, home)
    expect(await stat(join(home, 'skills', 'wechat-reading', 'stale.txt'))).toBeTruthy()
    const v2 = buildZip([['wechat-reading/SKILL.md', SKILL]])
    const res = await addSkillFromZip({ ...req, payload: v2.toString('base64'), overwrite: true }, home)
    expect(res).toEqual({ ok: true, name: 'wechat-reading' })
    await expect(stat(join(home, 'skills', 'wechat-reading', 'stale.txt'))).rejects.toBeTruthy()
  })

  it('dir: second install without overwrite reports exists', async () => {
    const home = await tmpHome()
    const src = await mkdtemp(join(tmpdir(), 'cap-src-'))
    await writeFile(join(src, 'SKILL.md'), SKILL, 'utf8')
    const req: CatalogAddSkillRequest = { channel: 'command', payload: '', repo: src, modelInvocable: true, root: 'user' }
    await commandInstall(req, home)
    const res = await commandInstall(req, home)
    expect(res).toEqual({ ok: false, exists: true, name: 'wechat-reading' })
  })
})

describe('listDirSkills self vs child', () => {
  it('lists a single-skill dir itself as one self entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cap-skill-'))
    await writeFile(join(dir, 'SKILL.md'), SKILL, 'utf8')
    const list = await listDirSkills(dir)
    expect(list).toEqual([{ name: 'wechat-reading', description: 'Read WeChat Reading shelf', kind: 'self' }])
  })

  it('lists a container dir as child entries', async () => {
    const home = await tmpHome()
    const dir = join(home, 'container')
    await mkdir(join(dir, 'a'), { recursive: true })
    await mkdir(join(dir, 'b'), { recursive: true })
    await writeFile(join(dir, 'a', 'SKILL.md'), SKILL, 'utf8')
    await writeFile(join(dir, 'b', 'SKILL.md'), SKILL, 'utf8')
    const list = await listDirSkills(dir)
    expect(list.length).toBe(2)
    expect(list.every(s => s.kind === 'child')).toBe(true)
  })

  it('installs a single skill dir picked directly (repo=dir, no skills)', async () => {
    const home = await tmpHome()
    const src = await mkdtemp(join(tmpdir(), 'cap-skill-'))
    await writeFile(join(src, 'SKILL.md'), SKILL, 'utf8')
    const req: CatalogAddSkillRequest = { channel: 'command', payload: '', repo: src, modelInvocable: true, root: 'user' }
    const res = await commandInstall(req, home)
    expect(res).toEqual({ ok: true, name: 'wechat-reading' })
    expect(await readFile(join(home, 'skills', 'wechat-reading', 'SKILL.md'), 'utf8')).toContain('# body')
  })
})
