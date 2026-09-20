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
 * (strip the archive's own wrapping folder if present). The clone path resolves
 * a repo spec — including a whole `npx skills add <repo> --skill <name>` command
 * copied from a skill's README — clones it into a scratch directory, and lifts
 * the selected skill bundle(s) into the root.
 * @module @khorsheed/dsh-capability-catalog/import
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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

/** A parsed `command`-channel spec: the source reference plus its `--skill` selections. */
interface RepoSpec {
  /** owner/repo or a git URL (a local path is copied before this parse runs). */
  readonly ref: string
  /** Sub-skill names from `--skill`/`-s`, matching the CLI's own greedy values. */
  readonly skills: readonly string[]
}

/** `skills add` flags whose following non-flag values dsh consumes and ignores. */
const DROPPED_VALUE_FLAGS = new Set(['-a', '--agent', '--subagent'])
/** `skills add` flags that take exactly one value dsh consumes and ignores. */
const DROPPED_SINGLE_VALUE_FLAGS = new Set(['--metadata'])
/** `skills add` boolean flags dsh consumes and ignores (`-g` is meaningless for a root dsh owns). */
const DROPPED_BOOL_FLAGS = new Set(['-g', '--global', '-y', '--yes', '-l', '--list', '--all', '--full-depth', '--json', '--copy'])
/** `skills add` flags that select sub-skills; their greedy values are kept. */
const SKILL_FLAGS = new Set(['-s', '--skill'])

/**
 * Parse a `command`-channel spec — `owner/repo`, a git URL, or a whole
 * `npx skills add <repo> [--skill <name>]… [-g]` command — into its source
 * reference and `--skill` selections.
 *
 * Every flag token is consumed here, never left in the string: the spec used to
 * be handed to `git clone` after only a prefix and a trailing `-g` were
 * stripped, so the README form `npx skills add owner/repo --skill name` became
 * the clone URL `https://github.com/owner/repo --skill name`, which git rejects
 * as a malformed URL. The recognized set mirrors the `skills` CLI's own `add`
 * parser (vercel-labs/skills) so a command copied from a skill's README installs
 * what it says: a flag's value is consumed with it, never glued onto the
 * reference.
 * @param spec - the raw spec from the add-skill command channel.
 */
export function parseRepoSpec(spec: string): RepoSpec | undefined {
  const tokens = spec.trim().replace(/^npx\s+skills\s+add\s+/i, '').trim().split(/\s+/)
  const skills: string[] = []
  let ref: string | undefined
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    if (token === '') continue
    if (SKILL_FLAGS.has(token)) {
      // Greedy, like the CLI: `--skill a b` selects both.
      while (i + 1 < tokens.length && !(tokens[i + 1] as string).startsWith('-')) skills.push(tokens[++i] as string)
      continue
    }
    if (DROPPED_VALUE_FLAGS.has(token)) {
      while (i + 1 < tokens.length && !(tokens[i + 1] as string).startsWith('-')) i++
      continue
    }
    if (DROPPED_SINGLE_VALUE_FLAGS.has(token)) {
      i++
      continue
    }
    // Known boolean flags — and anything else flag-shaped — are dropped: no flag
    // token may ever reach the clone URL.
    if (DROPPED_BOOL_FLAGS.has(token) || token.startsWith('-')) continue
    // The first non-flag token is the source; the CLI accepts several, dsh one.
    if (ref === undefined) ref = token
  }
  return ref === undefined ? undefined : { ref, skills }
}

/** Turn a source reference (owner/repo or a git URL) into a clone URL. */
function refToCloneUrl(ref: string): string | undefined {
  if (/^https?:\/\//.test(ref)) return ref
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(ref)) {
    const [owner, repo] = ref.split('/')
    return `https://github.com/${owner}/${repo}`
  }
  return undefined
}

/** A skill bundle found inside a cloned source repo. */
interface FoundSkill {
  /** Absolute directory holding the bundle. */
  readonly dir: string
  /** Basename of `dir` — the install name `--skill` matches. */
  readonly dirName: string
  /** Frontmatter `name`, which drives the folder written under the managed root. */
  readonly name: string
  /** Raw SKILL.md content. */
  readonly content: string
}

/** Every skill bundle at or under `dir` (depth ≤ 4, `.git` skipped), shallowest first. */
async function collectSkills(dir: string, depth = 0): Promise<FoundSkill[]> {
  if (depth > 4) return []
  const out: FoundSkill[] = []
  const content = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => undefined)
  const parsed = content === undefined ? undefined : resolveSkillNameFromContent(content)
  if (content !== undefined && parsed !== undefined) {
    out.push({ dir, dirName: basename(dir), name: parsed.name, content })
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.git') continue
    out.push(...await collectSkills(join(dir, entry.name), depth + 1))
  }
  return out
}

/**
 * Resolve `--skill` selections against the skills a repo carries. A selection
 * matches a skill's directory name or its frontmatter `name`, case-insensitively
 * — the `skills` CLI's own rule — and `*` selects every skill.
 * @returns the chosen skills; `[]` when nothing was selected but the repo is
 * ambiguous (more than one skill); `undefined` when a selection matched nothing.
 */
function selectSkills(skills: readonly FoundSkill[], selections: readonly string[]): FoundSkill[] | undefined {
  if (selections.length === 0) return skills.length > 1 ? [] : [...skills]
  if (selections.includes('*')) return [...skills]
  const chosen = skills.filter(s => selections.some(sel =>
    sel.toLowerCase() === s.dirName.toLowerCase() || sel.toLowerCase() === s.name.toLowerCase()))
  return chosen.length === 0 ? undefined : chosen
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
 * Install a skill by cloning a source repo (owner/repo, git URL, or a whole
 * `npx skills add <repo> [--skill <name>]` command) into the managed root. This
 * is the dsh-native "install from source" — a plain `npx skills add` writes into
 * an external skills dir the dsh filesystem watcher does not scan.
 *
 * The clone lands in a scratch directory; the chosen skill bundle (the repo's
 * only one, `request.skills`, or the command's `--skill` values) is then lifted
 * to `<managed root>/<frontmatter name>/`. A repo carrying several skills and no
 * selection is refused with the list rather than installing the shallowest one.
 * @param request - the add-skill request (channel 'command', repo carries the spec).
 * @param dshHome - the dsh home root.
 */
export async function commandInstall(request: CatalogAddSkillRequest, dshHome: string): Promise<CatalogAddSkillResult> {
  const spec = request.repo ?? ''
  const trimmed = spec.trim()
  // A `npx skills add ...` form is treated as its repo (the real npx installer
  // writes into an external skills dir dsh cannot scan); parseRepoSpec below
  // extracts the repo and any `--skill` selection from that form. Local
  // directory copy is handled next.
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
  const source = parseRepoSpec(spec)
  const url = source === undefined ? undefined : refToCloneUrl(source.ref)
  if (source === undefined || url === undefined) return { ok: false, error: `unrecognized repo spec: ${spec || '(empty)'}` }
  const root = managedRoot(request.root, dshHome)
  const repoName = url.replace(/\.git$/, '').split('/').pop() ?? 'skill'
  // Clone into a scratch directory, never straight into `root`: a partial clone
  // must not surface as a skill, and a repo named like an installed skill must
  // not overwrite it on the way in. Naming the clone after the repo keeps the
  // CLI's install name available to `--skill` matching.
  const scratchRoot = await mkdtemp(join(tmpdir(), 'dsh-skill-clone-'))
  const scratch = join(scratchRoot, repoName)
  try {
    try {
      await execFileAsync('git', ['clone', '--depth', '1', url, scratch])
    } catch (error) {
      return { ok: false, error: `install failed: ${String(error)}` }
    }
    const skills = await collectSkills(scratch)
    if (skills.length === 0) return { ok: false, error: 'cloned repo has no SKILL.md' }
    // An explicit selection (a chooser's `request.skills`) and `--skill` flags in
    // a pasted command are the same intent; the caller wins when both are present.
    const selections = request.skills !== undefined && request.skills.length > 0 ? request.skills : source.skills
    const chosen = selectSkills(skills, selections)
    if (chosen === undefined) {
      return { ok: false, error: `no matching skill for: ${selections.join(', ')} — available: ${skills.map(s => s.dirName).join(', ')}` }
    }
    if (chosen.length === 0) {
      // Several skills and no selection: installing the shallowest one silently is
      // how the wrong skill lands. Mirror the directory path and ask for a choice.
      return { ok: false, error: `directory has ${skills.length} skills — pick one: ${skills.map(s => s.dirName).join(', ')}` }
    }
    const plans = chosen.map(skill => ({ skill, target: join(root, skill.name) }))
    // Check every target before writing any, so a selection spanning a new and an
    // existing skill never half-installs.
    for (const { skill, target } of plans) {
      if (!request.overwrite && await pathExists(target)) return { ok: false, exists: true, name: skill.name }
    }
    const installed: string[] = []
    for (const { skill, target } of plans) {
      await rm(target, { recursive: true, force: true }).catch(() => {})
      // Lift the bundle (which may be nested, e.g. <repo>/skills/<name>) to <root>/<name>/.
      await cp(skill.dir, target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), finalizeSkillText(skill.content, request.modelInvocable), 'utf8')
      installed.push(skill.name)
    }
    return { ok: true, name: installed.join(', ') }
  } finally {
    await rm(scratchRoot, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * List the skills inside a local dir for the add-skill chooser. If the dir is a
 * **skill container** (a set of `<name>/SKILL.md` sub-dirs) the sub-skills are
 * listed as `kind:'child'`; if the dir is **itself a single skill bundle** (a
 * `SKILL.md` at its root) it is listed as one `kind:'self'` entry so the user can
 * install the directory as-is. Both shapes are returned when a dir has a root
 * `SKILL.md` AND child skill dirs.
 * @param dirPath - the local directory path (may be `~`-prefixed).
 */
export async function listDirSkills(dirPath: string): Promise<readonly CatalogDirSkillInfo[]> {
  const expanded = expandHome(dirPath)
  const out: CatalogDirSkillInfo[] = []
  const selfContent = await readFile(join(expanded, 'SKILL.md'), 'utf8').catch(() => undefined)
  if (selfContent !== undefined) {
    const parsed = resolveSkillNameFromContent(selfContent)
    if (parsed !== undefined) out.push({ name: parsed.name, description: parsed.description, kind: 'self' })
  }
  for (const name of await listSkillDirs(expanded)) {
    const content = await readFile(join(expanded, name, 'SKILL.md'), 'utf8').catch(() => '')
    const parsed = resolveSkillNameFromContent(content)
    out.push({ name, description: parsed?.description ?? '', kind: 'child' })
  }
  return out
}
