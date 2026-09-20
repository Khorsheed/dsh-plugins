import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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
  parseRepoSpec,
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

describe('parseRepoSpec', () => {
  it('takes the repo and the --skill selection out of a README install command', () => {
    expect(parseRepoSpec('npx skills add typesafe-ai/skills --skill typesafe-ai'))
      .toEqual({ ref: 'typesafe-ai/skills', skills: ['typesafe-ai'] })
  })

  it('never leaves a flag glued onto the reference', () => {
    const parsed = parseRepoSpec('npx skills add owner/repo --skill a')
    expect(parsed?.ref).toBe('owner/repo')
    expect(parsed?.ref).not.toContain('--skill')
  })

  it('keeps every greedy --skill value', () => {
    expect(parseRepoSpec('npx skills add owner/repo --skill a b'))
      .toEqual({ ref: 'owner/repo', skills: ['a', 'b'] })
  })

  it('accepts -s as --skill and consumes the --agent value with it', () => {
    expect(parseRepoSpec('npx skills add owner/repo -s a --agent claude-code'))
      .toEqual({ ref: 'owner/repo', skills: ['a'] })
  })

  it('drops boolean flags, including the trailing -g it always handled', () => {
    expect(parseRepoSpec('npx skills add owner/repo -g')).toEqual({ ref: 'owner/repo', skills: [] })
    expect(parseRepoSpec('npx skills add owner/repo --all -y')).toEqual({ ref: 'owner/repo', skills: [] })
  })

  it('drops an unknown flag rather than making it part of the repo', () => {
    expect(parseRepoSpec('npx skills add owner/repo --future-flag')).toEqual({ ref: 'owner/repo', skills: [] })
  })

  it('passes a git URL through untouched', () => {
    expect(parseRepoSpec('https://github.com/owner/repo.git')).toEqual({ ref: 'https://github.com/owner/repo.git', skills: [] })
    expect(parseRepoSpec('https://github.com/owner/repo --skill a')?.ref).toBe('https://github.com/owner/repo')
  })

  it('returns undefined when no reference is left', () => {
    expect(parseRepoSpec('')).toBeUndefined()
    expect(parseRepoSpec('npx skills add --skill a')).toBeUndefined()
  })
})

/** Stub `git`: log argv to $GIT_LOG and "clone" the fixture at $STUB_REPO. */
const GIT_STUB = `#!/bin/sh
echo "$*" >> "$GIT_LOG"
for dest in "$@"; do :; done
mkdir -p "$dest"
cp -R "$STUB_REPO"/. "$dest"/
`

const TYPESAFE = `---
name: typesafe-ai
description: Design TypeSafe workflows
---

# body
`

/**
 * Run `fn` with a stub `git` first on PATH, so `commandInstall`'s clone path can
 * be exercised without the network. Returns the call's result plus the argv each
 * `git` invocation actually received.
 */
async function withGitStub<T>(fixture: string, fn: () => Promise<T>): Promise<{ result: T; argv: readonly string[] }> {
  const bin = await mkdtemp(join(tmpdir(), 'cap-gitbin-'))
  const log = join(bin, 'git.log')
  await writeFile(join(bin, 'git'), GIT_STUB, 'utf8')
  await chmod(join(bin, 'git'), 0o755)
  const prev = { path: process.env['PATH'], repo: process.env['STUB_REPO'], log: process.env['GIT_LOG'] }
  process.env['PATH'] = `${bin}:${prev.path ?? ''}`
  process.env['STUB_REPO'] = fixture
  process.env['GIT_LOG'] = log
  try {
    const result = await fn()
    const logged = await readFile(log, 'utf8').catch(() => '')
    return { result, argv: logged.split('\n').filter(line => line !== '') }
  } finally {
    if (prev.path === undefined) delete process.env['PATH']
    else process.env['PATH'] = prev.path
    if (prev.repo === undefined) delete process.env['STUB_REPO']
    else process.env['STUB_REPO'] = prev.repo
    if (prev.log === undefined) delete process.env['GIT_LOG']
    else process.env['GIT_LOG'] = prev.log
  }
}

/** A fixture "repo" carrying `<name>/SKILL.md` per entry. */
async function fixtureRepo(skills: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cap-repo-'))
  for (const [name, content] of Object.entries(skills)) {
    await mkdir(join(dir, name), { recursive: true })
    await writeFile(join(dir, name, 'SKILL.md'), content, 'utf8')
  }
  return dir
}

describe('commandInstall from a source repo', () => {
  const request = (repo: string, extra: { skills?: readonly string[]; modelInvocable?: boolean } = {}): CatalogAddSkillRequest => ({
    channel: 'command',
    payload: '',
    repo,
    root: 'user',
    modelInvocable: extra.modelInvocable ?? true,
    ...(extra.skills === undefined ? {} : { skills: extra.skills }),
  })

  it('installs the skill named by a pasted npx command, with no flag in the clone URL', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ 'skills/typesafe-ai': TYPESAFE })
    const { result, argv } = await withGitStub(fixture, () => commandInstall(request('npx skills add typesafe-ai/skills --skill typesafe-ai'), home))
    expect(result).toEqual({ ok: true, name: 'typesafe-ai' })
    // The regression: git used to be handed `https://github.com/typesafe-ai/skills --skill typesafe-ai`.
    expect(argv[0]).toMatch(/^clone --depth 1 https:\/\/github\.com\/typesafe-ai\/skills /)
    expect(argv[0]).not.toContain('--skill')
    expect(await readFile(join(home, 'skills', 'typesafe-ai', 'SKILL.md'), 'utf8')).toContain('# body')
  })

  it('leaves no clone behind in the managed root', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ 'skills/typesafe-ai': TYPESAFE })
    await withGitStub(fixture, () => commandInstall(request('typesafe-ai/skills --skill typesafe-ai'), home))
    expect(await readdir(join(home, 'skills'))).toEqual(['typesafe-ai'])
  })

  it('installs only the skill a --skill flag selects', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ a: SKILL, b: TYPESAFE })
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo --skill b'), home))
    expect(result).toEqual({ ok: true, name: 'typesafe-ai' })
    expect(await readdir(join(home, 'skills'))).toEqual(['typesafe-ai'])
  })

  it('installs every skill for --skill *', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ a: SKILL, b: TYPESAFE })
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo --skill *'), home))
    expect(result).toEqual({ ok: true, name: 'wechat-reading, typesafe-ai' })
    expect((await readdir(join(home, 'skills'))).sort()).toEqual(['typesafe-ai', 'wechat-reading'])
  })

  it('refuses a multi-skill repo with no selection instead of picking one', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ a: SKILL, b: TYPESAFE })
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo'), home))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('directory has 2 skills — pick one: a, b')
    await expect(stat(join(home, 'skills'))).rejects.toBeTruthy()
  })

  it('reports a selection that matches nothing, listing what the repo has', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ a: SKILL, b: TYPESAFE })
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo --skill nonexistent'), home))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no matching skill for: nonexistent — available: a, b')
  })

  it('honours the chooser\'s skills field over the pasted command', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ a: SKILL, b: TYPESAFE })
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo --skill a', { skills: ['b'] }), home))
    expect(result).toEqual({ ok: true, name: 'typesafe-ai' })
  })

  it('installs a single-skill repo with no selection at all', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ 'typesafe-ai': TYPESAFE })
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo'), home))
    expect(result).toEqual({ ok: true, name: 'typesafe-ai' })
  })

  it('applies modelInvocable=false to the installed clone', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ 'skills/typesafe-ai': TYPESAFE })
    await withGitStub(fixture, () => commandInstall(request('owner/repo --skill typesafe-ai', { modelInvocable: false }), home))
    expect(inferModelInvocable(await readFile(join(home, 'skills', 'typesafe-ai', 'SKILL.md'), 'utf8'))).toBe(false)
  })

  it('reports exists instead of overwriting an installed same-name skill', async () => {
    const home = await tmpHome()
    const fixture = await fixtureRepo({ 'typesafe-ai': TYPESAFE })
    await withGitStub(fixture, () => commandInstall(request('owner/repo'), home))
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo'), home))
    expect(result).toEqual({ ok: false, exists: true, name: 'typesafe-ai' })
  })

  it('fails cleanly when the repo carries no SKILL.md', async () => {
    const home = await tmpHome()
    const fixture = await mkdtemp(join(tmpdir(), 'cap-repo-'))
    await writeFile(join(fixture, 'README.md'), 'no skill here', 'utf8')
    const { result } = await withGitStub(fixture, () => commandInstall(request('owner/repo'), home))
    expect(result).toEqual({ ok: false, error: 'cloned repo has no SKILL.md' })
  })
})
