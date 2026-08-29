/**
 * Add-skill import: write a skill from a pasted SKILL.md payload or an uploaded
 * zip archive into the managed skills root and extract its name/frontmatter.
 *
 * A skill is a directory bundle (`<name>/SKILL.md` plus optional
 * `references`/`scripts`/`assets`) or a single flat file, discovered by the
 * skill-filesystem watcher from one of the managed roots. So "installing" a
 * skill is just placing it under the root; nothing executes the payload.
 *
 * The zip path reads the archive with the dependency-free zip reader
 * (`./zip.ts`, node:zlib only), locates the `SKILL.md`, derives the kebab-case
 * `name` from frontmatter, and extracts the bundle under `<root>/<name>/`
 * (strip the archive's own wrapping folder if present). The GitHub clone path
 * is a follow-up (needs a git child process).
 * @module @khorsheed/dsh-capability-catalog/import
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { CatalogAddSkillRequest, CatalogAddSkillResult, CatalogDirSkillInfo } from './types.ts'
import { extractZip, type ZipEntry } from './zip.ts'

const execFileAsync = promisify(execFile)

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/** First bytes of a ZIP archive (local file header / empty / spanned). */
const ZIP_MAGIC_PK = 0x50 // 'P'
const ZIP_MAGIC_K = 0x4b // 'K'

/** Resolve the managed root directory. */
export function managedRoot(root: 'user' | 'project', dshHome: string): string {
  return root === 'user'
    ? join(dshHome, 'skills')
    : join(dshHome, '.agents', 'skills')
}

/** Extract the kebab-case `name` and `description` from a SKILL.md body. */
export function resolveSkillNameFromContent(content: string): { name: string; description: string } | undefined {
  const m = FRONTMATTER.exec(content)
  if (m === null) return undefined
  const front = m[1] ?? ''
  const name = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim()
  const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim()
  if (name === undefined || description === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return undefined
  return { name, description }
}

/** Decode base64 bytes to a UTF-8 string. */
function decodeBase64(payload: string): string {
  return Buffer.from(payload, 'base64').toString('utf8')
}

/** Read the frontmatter `disable-model-invocation` flag (default model-invocable true). */
export function inferModelInvocable(content: string): boolean {
  const m = FRONTMATTER.exec(content)
  if (m === null) return true
  const front = m[1] ?? ''
  const line = /^disable-model-invocation:\s*(true|false)$/m.exec(front)?.[1]
  return line !== 'true'
}

/** Whether a filesystem path exists (dir or file). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** True when a base64 payload decodes to a ZIP archive (magic bytes). */
export function isZipPayload(payload: string): boolean {
  let bytes: Buffer
  try {
    bytes = Buffer.from(payload, 'base64')
  } catch {
    return false
  }
  return bytes.length >= 4 && bytes[0] === ZIP_MAGIC_PK && bytes[1] === ZIP_MAGIC_K &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
}

/** Reject unsafe relative paths (absolute, drive-letter, or `..` traversal). */
function sanitizeRelPath(p: string): string | undefined {
  if (p === '' || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return undefined
  const safe: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return undefined
    safe.push(seg)
  }
  return safe.length === 0 ? undefined : safe.join('/')
}

/** Apply the frontmatter `disable-model-invocation` line to match the request. */
function finalizeSkillText(content: string, modelInvocable: boolean): string {
  const m = FRONTMATTER.exec(content)
  if (m === null) return content
  const front = String(m[1] ?? '')
  const body = String(m[2] ?? '')
  const effective = inferModelInvocable(content)
  if (effective === modelInvocable) return content
  const without = front
    .split('\n')
    .filter(line => !line.trim().startsWith('disable-model-invocation:'))
    .join('\n')
  const withFlag = modelInvocable
    ? without
    : `${without}${without.endsWith('\n') ? '' : '\n'}disable-model-invocation: true`
  return `---\n${withFlag}\n---\n${body}`
}

/**
 * Add a skill from a base64 SKILL.md text payload into the managed root.
 * @param request - the add-skill request.
 * @param dshHome - the dsh home root.
 */
export async function addSkillFromText(request: CatalogAddSkillRequest, dshHome: string): Promise<CatalogAddSkillResult> {
  let text: string
  try {
    text = decodeBase64(request.payload)
  } catch {
    return { ok: false, error: 'invalid payload: not base64 text' }
  }
  const parsed = resolveSkillNameFromContent(text)
  if (parsed === undefined) {
    return { ok: false, error: 'SKILL.md missing or missing name/description frontmatter' }
  }
  const finalText = finalizeSkillText(text, request.modelInvocable)
  const target = join(managedRoot(request.root, dshHome), parsed.name)
  if (!request.overwrite && await pathExists(target)) return { ok: false, exists: true, name: parsed.name }
  try {
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), finalText, 'utf8')
  } catch (error) {
    return { ok: false, error: `failed to write skill: ${String(error)}` }
  }
  return { ok: true, name: parsed.name }
}

/** Pick the SKILL.md entry: the shallowest absolute path ending in `SKILL.md`. */
function pickSkillEntry(entries: ReadonlyArray<ZipEntry>): ZipEntry | undefined {
  let best: ZipEntry | undefined
  let bestDepth = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const parts = entry.path.split('/')
    if (parts[parts.length - 1] !== 'SKILL.md') continue
    const depth = parts.length - 1
    if (depth < bestDepth) {
      best = entry
      bestDepth = depth
    }
  }
  return best
}

/** The archive's wrapping folder prefix ('' when SKILL.md is at the root). */
function skillDirPrefix(entryName: string): string {
  const idx = entryName.lastIndexOf('/')
  return idx >= 0 ? entryName.slice(0, idx + 1) : ''
}

/**
 * Add a skill from a base64 ZIP archive payload into the managed root.
 *
 * The archive should contain a skill bundle. If the `SKILL.md` sits directly at
 * the archive root it is extracted as-is; if it sits under a single wrapping
 * folder that folder is stripped so the bundle lands at `<root>/<name>/`. Path
 * traversal entries are skipped; the frontmatter name drives the target folder.
 * @param request - the add-skill request.
 * @param dshHome - the dsh home root.
 */
export async function addSkillFromZip(request: CatalogAddSkillRequest, dshHome: string): Promise<CatalogAddSkillResult> {
  let bytes: Buffer
  try {
    bytes = Buffer.from(request.payload, 'base64')
  } catch {
    return { ok: false, error: 'invalid payload: not base64' }
  }
  let entries: readonly ZipEntry[]
  try {
    entries = extractZip(bytes)
  } catch (error) {
    return { ok: false, error: `invalid zip archive: ${String(error)}` }
  }
  const skillEntry = pickSkillEntry(entries)
  if (skillEntry === undefined) return { ok: false, error: 'archive did not contain a SKILL.md' }
  const original = skillEntry.data.toString('utf8')
  const parsed = resolveSkillNameFromContent(original)
  if (parsed === undefined) return { ok: false, error: 'SKILL.md missing name/description frontmatter' }
  const name = parsed.name
  const prefix = skillDirPrefix(skillEntry.path)
  const finalContent = finalizeSkillText(original, request.modelInvocable)
  const target = join(managedRoot(request.root, dshHome), name)
  if (!request.overwrite && await pathExists(target)) return { ok: false, exists: true, name }

  let wrote = false
  try {
    if (request.overwrite === true) await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
  } catch (error) {
    return { ok: false, error: `failed to create skill dir: ${String(error)}` }
  }

  for (const entry of entries) {
    const rel = entry.path
    if (prefix !== '' && !rel.startsWith(prefix)) continue
    const relPath = prefix !== '' ? rel.slice(prefix.length) : rel
    const safe = sanitizeRelPath(relPath)
    if (safe === undefined) continue
    const outPath = join(target, safe)
    if (!outPath.startsWith(target)) continue
    const isMain = safe === 'SKILL.md'
    const data = isMain ? Buffer.from(finalContent, 'utf8') : entry.data
    try {
      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, data)
      wrote = true
    } catch (error) {
      return { ok: false, error: `failed to write skill file: ${String(error)}` }
    }
  }

  return wrote ? { ok: true, name } : { ok: false, error: 'archive contained no reusable skill files' }
}

/**
 * Add a skill from a base64 payload into the managed root, auto-detecting a
 * ZIP archive (magic bytes) from a raw SKILL.md text payload.
 * @param request - the add-skill request.
 * @param dshHome - the dsh home root.
 */
export async function addSkillFromPayload(request: CatalogAddSkillRequest, dshHome: string): Promise<CatalogAddSkillResult> {
  if (isZipPayload(request.payload)) return addSkillFromZip(request, dshHome)
  return addSkillFromText(request, dshHome)
}

/** Turn a repo spec (owner/repo, git URL, or `npx skills add <repo> -g`) into a clone URL. */
function repoSpecToClone(spec: string): string | undefined {
  let s = spec.trim()
  const prefix = /^npx\s+skills\s+add\s+/i
  if (prefix.test(s)) s = s.replace(prefix, '')
  s = s.trim().replace(/\s+-g$/, '')
  if (s === '') return undefined
  if (/^https?:\/\//.test(s)) return s
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(s)) {
    const [owner, repo] = s.split('/')
    return `https://github.com/${owner}/${repo}`
  }
  return undefined
}

/** Expand a leading `~` to the OS home directory. */
function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/** Sub-directories of `dir` that contain a SKILL.md (a skills container). */
async function listSkillDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const out: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await stat(join(dir, entry.name, 'SKILL.md'))
        out.push(entry.name)
      } catch {
        // not a skill dir
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Install a skill by cloning a source repo (owner/repo, git URL, or an
 * `npx skills add <repo>` form) into the managed root. The frontmatter name
 * drives the target folder; the repo must carry a `SKILL.md` at its root. This
 * is the dsh-native "install from source" — a plain `npx skills add` writes
 * into an external skills dir the dsh filesystem watcher does not scan.
 * @param request - the add-skill request (channel 'command', repo carries the spec).
 * @param dshHome - the dsh home root.
 */
export async function commandInstall(request: CatalogAddSkillRequest, dshHome: string): Promise<CatalogAddSkillResult> {
  const spec = request.repo ?? ''
  const trimmed = spec.trim()
  // A `npx skills add ...` form is treated as its repo (the real npx installer
  // writes into an external skills dir dsh cannot scan); repoSpecToClone below
  // extracts the repo from that form. Local directory copy is handled next.
  // Local directory: copy it (or a selected sub-skill) into the managed root.
  const expanded = expandHome(trimmed)
  let dirStat
  try {
    dirStat = await stat(expanded)
  } catch {
    dirStat = undefined
  }
  if (dirStat?.isDirectory() === true) {
    const copyInto = async (src: string, skillName?: string): Promise<CatalogAddSkillResult> => {
      const skillMd = join(src, 'SKILL.md')
      let content: string
      try {
        content = await readFile(skillMd, 'utf8')
      } catch {
        return { ok: false, error: 'directory has no SKILL.md' }
      }
      const parsed = resolveSkillNameFromContent(content)
      if (parsed === undefined) return { ok: false, error: 'SKILL.md missing name/description frontmatter' }
      const name = skillName ?? parsed.name
      const target = join(managedRoot(request.root, dshHome), name)
      if (!request.overwrite && await pathExists(target)) return { ok: false, exists: true, name }
      try {
        await rm(target, { recursive: true, force: true })
      } catch {
        // ignore
      }
      await cp(src, target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), finalizeSkillText(content, request.modelInvocable), 'utf8')
      return { ok: true, name }
    }
    // A skills container (multiple <name>/SKILL.md): install the selected
    // sub-skills (request.skills), or error listing them for the chooser.
    const children = await listSkillDirs(expanded)
    if (request.skills !== undefined && request.skills.length > 0) {
      const results = await Promise.all(request.skills.map(async (s) => copyInto(join(expanded, s), s)))
      const existing = results.find(r => !r.ok && r.exists === true)
      if (existing !== undefined) return existing
      const ok = results.filter(r => r.ok)
      if (ok.length > 0) return { ok: true, name: ok.map(r => r.name).join(', ') }
      const firstBad = results.find(r => !r.ok)
      return firstBad ?? { ok: false, error: 'no skills installed' }
    }
    if (children.length > 1) {
      return { ok: false, error: `directory has ${children.length} skills — pick one: ${children.join(', ')}` }
    }
    const only = children[0]
    if (children.length === 1 && only !== undefined) return copyInto(join(expanded, only), only)
    return copyInto(expanded)
  }
  const url = repoSpecToClone(spec)
  if (url === undefined) return { ok: false, error: `unrecognized repo spec: ${spec || '(empty)'}` }
  const repoName = url.replace(/\.git$/, '').split('/').pop() ?? 'skill'
  const dest = join(managedRoot(request.root, dshHome), repoName)
  try {
    await rm(dest, { recursive: true, force: true })
  } catch {
    // ignore — the destination may not exist yet
  }
  try {
    await execFileAsync('git', ['clone', '--depth', '1', url, dest])
  } catch (error) {
    return { ok: false, error: `install failed: ${String(error)}` }
  }
  const found = await findSkillMd(dest)
  if (found === undefined) return { ok: false, error: 'cloned repo has no SKILL.md' }
  const parsed = resolveSkillNameFromContent(found.content)
  if (parsed === undefined) return { ok: false, error: 'cloned SKILL.md missing name/description frontmatter' }
  const name = parsed.name
  const target = join(managedRoot(request.root, dshHome), name)
  if (!request.overwrite && await pathExists(target)) {
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    return { ok: false, exists: true, name }
  }
  try {
    await rm(target, { recursive: true, force: true })
  } catch {
    // ignore
  }
  // Lift the skill dir (which may be nested, e.g. <repo>/skills/<name>) to <managedRoot>/<name>/.
  if (found.skillDir !== dest) {
    await cp(found.skillDir, target, { recursive: true })
  } else {
    await rename(dest, target)
  }
  await writeFile(join(target, 'SKILL.md'), finalizeSkillText(found.content, request.modelInvocable), 'utf8')
  return { ok: true, name }
}

/** Find a SKILL.md under `dir` (shallowest, valid frontmatter), skipping .git. */
async function findSkillMd(dir: string, depth = 0): Promise<{ skillDir: string; content: string } | undefined> {
  if (depth > 4) return undefined
  const rootMd = join(dir, 'SKILL.md')
  try {
    const content = await readFile(rootMd, 'utf8')
    if (resolveSkillNameFromContent(content) !== undefined) return { skillDir: dir, content }
  } catch {
    // no SKILL.md here
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.git') continue
    const res = await findSkillMd(join(dir, entry.name), depth + 1)
    if (res !== undefined) return res
  }
  return undefined
}

/**
 * List the skills inside a local container dir (each `<name>/SKILL.md`), for
 * the add-skill chooser to present to the user before installing.
 * @param dirPath - the local directory path (may be `~`-prefixed).
 */
export async function listDirSkills(dirPath: string): Promise<readonly CatalogDirSkillInfo[]> {
  const expanded = expandHome(dirPath)
  const names = await listSkillDirs(expanded)
  const out: CatalogDirSkillInfo[] = []
  for (const name of names) {
    const content = await readFile(join(expanded, name, 'SKILL.md'), 'utf8').catch(() => '')
    const parsed = resolveSkillNameFromContent(content)
    out.push({ name, description: parsed?.description ?? '' })
  }
  return out
}
