/**
 * Writing side of preset-scoped delivery: rewrite one managed skill's
 * `metadata.presetScope`, adopt an installed skill into the managed root, and
 * release one back out.
 *
 * Every write here is deliberately narrow. The preset scope is edited in place
 * in the skill's OWN frontmatter (the same store the delivery reads), adoption
 * copies before it removes anything, and release refuses to overwrite an
 * existing default-root skill. Nothing deletes a managed skill: releasing is the
 * documented recovery direction, and a broken plugin must not take the user's
 * files with it.
 * @module @khorsheed/dsh-capability-catalog/scoped-edits
 */

import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  defaultSkillRoots,
  isKebabId,
  scanManagedSkills,
  scopedSkillsRoot,
  splitFrontmatter,
} from './scoped-delivery.ts'

/** Shared guard: every write path addresses one skill directory by name. */
function invalidName(name: string): ScopedEditResult | undefined {
  return isKebabId(name) ? undefined : { ok: false, error: `"${name}" is not a valid skill name` }
}

/** Outcome of one write: a reason is present exactly when it failed. */
export interface ScopedEditResult {
  readonly ok: boolean
  readonly error?: string
}

/** Where a managed skill came from, for the release path. */
export interface ManagedSkillLocation {
  readonly name: string
  /** The absolute `SKILL.md` path inside the managed root. */
  readonly path: string
  /** Its directory (the bundle the release moves). */
  readonly dir: string
}

/**
 * Rewrite a SKILL.md's `metadata.presetScope` list.
 *
 * The frontmatter is edited line by line rather than re-serialized, so every
 * other key, comment, and quote in the file survives untouched. The canonical
 * inline form is written: `presetScope: []` for "every preset", otherwise
 * `presetScope: [a, b]`.
 * @param content - the current SKILL.md text.
 * @param presets - the preset ids to declare (deduplicated, order preserved).
 * @returns the rewritten file text.
 * @throws when the file has no frontmatter block to edit.
 */
export function withPresetScope(content: string, presets: readonly string[]): string {
  const split = splitFrontmatter(content)
  if (split === undefined) {
    throw new Error('the skill has no frontmatter block to edit')
  }
  const ids = [...new Set(presets)]
  const lines = split.front.split('\n')
  const kept: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const match = /^(\s*)presetScope\s*:/.exec(line)
    if (match === null) {
      kept.push(line)
      continue
    }
    // Drop the key and any block-list items it owned.
    const indent = (match[1] ?? '').length
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? ''
      const entry = /^(\s*)-\s*/.exec(next)
      if (entry === null || (entry[1] ?? '').length <= indent) break
      index += 1
    }
  }
  const rendered = `presetScope: [${ids.join(', ')}]`
  const metadataAt = kept.findIndex(line => /^\s*metadata\s*:\s*$/.test(line))
  if (metadataAt >= 0) {
    const indent = (/^(\s*)/.exec(kept[metadataAt] ?? '')?.[1] ?? '').length + 2
    kept.splice(metadataAt + 1, 0, `${' '.repeat(indent)}${rendered}`)
  } else if (kept.some(line => line.trim() !== '')) {
    kept.push('metadata:', `  ${rendered}`)
  } else {
    kept.push('metadata:', `  ${rendered}`)
  }
  return `---\n${kept.join('\n')}\n---\n${split.body}`
}

/** Find the managed entry for one skill name. */
export async function managedLocation(dshHome: string, name: string): Promise<ManagedSkillLocation | undefined> {
  const root = scopedSkillsRoot(dshHome)
  const skill = (await scanManagedSkills(root)).find(entry => entry.name === name)
  if (skill === undefined) return undefined
  return { name: skill.name, path: skill.path, dir: skill.dir }
}

/** Write a file through a sibling temp file and one atomic rename. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${Date.now()}-${process.pid}.tmp`)
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

/**
 * Set one managed skill's preset scope.
 * @param dshHome - the harness home owning the managed root.
 * @param name - the skill name (its directory under the managed root).
 * @param presets - the preset ids to declare.
 * @returns the outcome, with a reason on failure.
 */
export async function setManagedPresetScope(
  dshHome: string,
  name: string,
  presets: readonly string[],
): Promise<ScopedEditResult> {
  const badName = invalidName(name)
  if (badName !== undefined) return badName
  const location = await managedLocation(dshHome, name)
  if (location === undefined) {
    return { ok: false, error: `"${name}" is not a managed skill` }
  }
  try {
    const content = await readFile(location.path, 'utf8')
    const updated = withPresetScope(content, presets)
    // Nothing to write is not a failure: the declared scope already matches.
    if (updated !== content) await writeAtomic(location.path, updated)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** The default root currently supplying one skill, with its shape. */
export interface SkillSource {
  readonly root: string
  readonly dir?: string
  readonly file?: string
}

/**
 * Locate one skill in the default roots.
 * @param dshHome - the harness home.
 * @param workdir - the session workspace, when known.
 * @param name - the skill name.
 * @returns the source found, or undefined.
 */
export function findSkillSource(
  dshHome: string,
  workdir: string | undefined,
  name: string,
): SkillSource | undefined {
  for (const root of defaultSkillRoots(dshHome, workdir)) {
    const dir = join(root, name)
    if (existsSync(join(dir, 'SKILL.md'))) return { root, dir }
    const file = join(root, `${name}.md`)
    if (existsSync(file)) return { root, file }
  }
  return undefined
}

/**
 * Move an installed skill into the managed root and declare its preset scope.
 *
 * Order matters: the source is only removed after the copy has been committed
 * and the scope written, so a failure at any step leaves one complete copy
 * behind. The copy lands as a temp sibling and is committed with one rename, so
 * the managed root never holds a half-written skill.
 * @param dshHome - the harness home.
 * @param name - the skill name.
 * @param presets - the preset ids to declare.
 * @param workdir - the session workspace, when known.
 * @returns the outcome, with a reason on failure.
 */
export async function adoptManagedSkill(
  dshHome: string,
  name: string,
  presets: readonly string[],
  workdir?: string | undefined,
): Promise<ScopedEditResult> {
  const badName = invalidName(name)
  if (badName !== undefined) return badName
  const root = scopedSkillsRoot(dshHome)
  const target = join(root, name)
  if (existsSync(target)) {
    return { ok: false, error: `the managed root already holds "${name}"` }
  }
  const source = findSkillSource(dshHome, workdir, name)
  if (source === undefined) {
    return { ok: false, error: `"${name}" was not found in a default skill root` }
  }
  const staging = join(root, `.${name}-${process.pid}`)
  try {
    await mkdir(root, { recursive: true })
    await rm(staging, { recursive: true, force: true })
    if (source.dir !== undefined) {
      await cp(source.dir, staging, { recursive: true })
    } else {
      await mkdir(staging, { recursive: true })
      await writeFile(join(staging, 'SKILL.md'), await readFile(source.file ?? '', 'utf8'), 'utf8')
    }
    const staged = join(staging, 'SKILL.md')
    const content = await readFile(staged, 'utf8')
    await writeFile(staged, withPresetScope(content, presets), 'utf8')
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: messageOf(error) }
  }
  // Committed: only now drop the default-root copy, and never fail the whole
  // operation over it — the managed copy is already authoritative.
  try {
    if (source.dir !== undefined) await rm(source.dir, { recursive: true, force: true })
    else if (source.file !== undefined) await rm(source.file, { force: true })
  } catch (error) {
    return { ok: false, error: `adopted "${name}", but the default-root copy could not be removed: ${messageOf(error)}` }
  }
  return { ok: true }
}

/**
 * Move a managed skill back to the user skill root — the recovery direction.
 *
 * A managed skill is delivered by this plugin, so releasing it restores plain
 * filesystem behavior that survives the plugin being removed.
 * @param dshHome - the harness home.
 * @param name - the skill name.
 * @returns the outcome, with a reason on failure.
 */
export async function releaseManagedSkill(dshHome: string, name: string): Promise<ScopedEditResult> {
  const badName = invalidName(name)
  if (badName !== undefined) return badName
  const location = await managedLocation(dshHome, name)
  if (location === undefined) {
    return { ok: false, error: `"${name}" is not a managed skill` }
  }
  const target = join(dshHome, 'skills', name)
  if (existsSync(target)) {
    return { ok: false, error: `"${name}" already exists in ${join(dshHome, 'skills')}` }
  }
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(location.dir, target, { recursive: true })
    await rm(location.dir, { recursive: true, force: true })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Whether a path exists and is a directory. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Render an unknown failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
