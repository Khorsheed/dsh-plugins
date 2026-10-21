/**
 * A harness's curated model list: `<scopedHome>/models.json` holds an
 * ORDERED array of model identifiers the user picked from the endpoint's
 * served catalog. The list's FIRST entry is the harness's default model —
 * it answers wherever the plugin-config `model` key answered before (round
 * resolution, the broker's settings layer, the eval snapshot's model
 * field), ahead of that key; an absent or empty list leaves the
 * pre-existing chain untouched (settings key → the scoped config file →
 * the CLI's own default). One store shape serves every harness in the
 * family (claude-code, codex, kimi): the file is keyed by the scoped home
 * alone, so a scope carries its own list exactly like its own endpoint
 * credential.
 *
 * Why a file and not the settings channel: the credential form's
 * endpoint-auth.json proved the pattern — the harness owns the store, the
 * volatile row-config channel rejects writes a deployment cannot explain,
 * and the file keeps every scope free to carry its own list. The settings
 * card edits the default scope's file through the gateway's
 * `modelList`/`configureModelList` Remotes; nothing here is secret (0600 is
 * for uniformity with the credential file, not necessity).
 * @module @khorsheed/dsh-local-agent/model-list
 */

import { readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The scoped-home model list file. */
export const MODEL_LIST_FILE = 'models.json'

/** Normalize one list: trimmed, blank-dropped, deduplicated keeping first occurrence. */
export function normalizeModelList(models: readonly unknown[]): string[] {
  const out: string[] = []
  for (const candidate of models) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed !== '' && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/** Fold a parsed file payload into a list; any other shape reads as empty. */
function fold(parsed: unknown): readonly string[] {
  if (Array.isArray(parsed)) return normalizeModelList(parsed)
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { models?: unknown }).models)) {
    return normalizeModelList((parsed as { models: unknown[] }).models)
  }
  return []
}

/**
 * Read the scope's model list. Absent, unreadable, or malformed content all
 * read as an empty list — the fallback chain then decides, exactly as
 * before the file existed.
 * @param homeDir - the harness's scoped home.
 * @returns the ordered model identifiers.
 */
export async function readModelList(homeDir: string): Promise<readonly string[]> {
  try {
    return fold(JSON.parse(await readFile(join(homeDir, MODEL_LIST_FILE), 'utf8')))
  } catch {
    return []
  }
}

/**
 * The sync twin of {@link readModelList} for the per-round model resolver —
 * one small file read per resolution, no caching, so a card write always
 * reaches the very next round.
 * @param homeDir - the scope's scoped home.
 * @returns the ordered model identifiers.
 */
export function readModelListSync(homeDir: string): readonly string[] {
  try {
    return fold(JSON.parse(readFileSync(join(homeDir, MODEL_LIST_FILE), 'utf8')))
  } catch {
    return []
  }
}

/** The list's default model: its first entry, or undefined when empty. */
export function firstModelOf(models: readonly string[]): string | undefined {
  return models.length === 0 ? undefined : models[0]
}

/**
 * Persist the scope's model list (normalized; an empty list DELETES the
 * file rather than shadowing the fallback chain with nothing). Answers the
 * normalized list as written, so the writer can flip its surface without a
 * re-read.
 * @param homeDir - the scope's scoped home.
 * @param models - the new ordered list.
 * @returns the normalized list.
 */
export async function writeModelList(homeDir: string, models: readonly string[]): Promise<readonly string[]> {
  const normalized = normalizeModelList(models)
  if (normalized.length === 0) {
    await rm(join(homeDir, MODEL_LIST_FILE), { force: true })
    return []
  }
  await mkdir(homeDir, { recursive: true })
  await writeFile(join(homeDir, MODEL_LIST_FILE), JSON.stringify({ models: normalized }, undefined, 2) + '\n', { mode: 0o600 })
  return normalized
}
