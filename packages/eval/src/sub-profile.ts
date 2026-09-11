/**
 * Reading back which preset a scoped home's sub-profile actually rosters.
 *
 * A condition's `preset` is a DECLARATION. The lock's `provisioned.preset` is
 * supposed to be the counterpart — what was actually written into the scope —
 * and the difference only exists if something reads the scope back. This
 * module is that read.
 *
 * It reads a FILE rather than calling a service, and that needs saying. The
 * sub-profile is written by `@khorsheed/dsh-local-agent-dsh`, which eval may
 * not import (community plugins never depend on siblings), and no service
 * face reports the roster. What is stable enough to read directly is the pair
 * of published contracts the file is made of: the loader's patch format (a
 * YAML list of operations, `insert` carrying plugin rows) and the roster
 * package's own name. Neither the generated comment banner nor the profile's
 * directory name is trusted — every profile under the scoped home is scanned,
 * so a deployment that renamed its sub-profile still reads correctly.
 *
 * Everything here degrades to `undefined`, never a throw: a scope with no
 * sub-profile, an unparsable patch, a harness that has no sub-profile at all
 * (the three external CLIs) all mean the same thing to the caller — "no
 * roster read back" — and the caller turns that into a refusal with a reason
 * rather than a guess.
 * @module @khorsheed/dsh-eval
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** The roster package a sub-profile's preset layer mounts. */
export const PRESET_ROSTER_MODULE = '@deepseek-ai/dsh-agent-presets'

/** Profiles live under `<scoped home>/profiles/<name>/`. */
const PROFILES_DIR = 'profiles'

/** The user patch layer inside a profile directory. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/**
 * A YAML schema that tolerates the loader's `!!js` expression tags.
 *
 * A sub-profile patch is full of them (`!!js process.env.DSH_MEMBER_SOCKET`,
 * …). They are the LOADER's to evaluate, never this reader's — evaluating one
 * here would run profile text as code in the orchestrator — so each is parsed
 * to `undefined` and dropped. Without this, js-yaml rejects the whole
 * document over a tag on a row we do not even look at.
 */
const LOADER_SCHEMA = yaml.DEFAULT_SCHEMA.extend(
  (['scalar', 'sequence', 'mapping'] as const).map(kind => new yaml.Type('tag:yaml.org,2002:js', {
    kind,
    construct: () => undefined,
  })),
)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The preset id a single patch document rosters, or undefined when it mounts
 * no roster. Exported for the tests that pin this against the shape
 * `local-agent-dsh` generates.
 * @param text - the `cordis.patch.yml` content.
 * @returns the roster's `default` preset id, or undefined.
 */
export function presetFromPatch(text: string): string | undefined {
  let document: unknown
  try {
    document = yaml.load(text, { schema: LOADER_SCHEMA })
  } catch {
    return undefined
  }
  if (!Array.isArray(document)) return undefined
  for (const operation of document) {
    if (!isPlainObject(operation) || !Array.isArray(operation['insert'])) continue
    for (const row of operation['insert']) {
      if (!isPlainObject(row) || row['name'] !== PRESET_ROSTER_MODULE) continue
      const config = row['config']
      if (!isPlainObject(config)) continue
      const preset = config['default']
      if (typeof preset === 'string' && preset !== '') return preset
    }
  }
  return undefined
}

/**
 * The preset the sub-profile inside one scoped home composes.
 *
 * Every profile under `<homeDir>/profiles` is scanned rather than one
 * well-known name, because the sub-profile's name is configurable. Two
 * profiles rostering two different presets is an ambiguity nobody can resolve
 * from here, so it reads as `undefined` — the caller refuses rather than
 * picking one.
 * @param homeDir - the harness scoped home.
 * @returns the preset id, or undefined when none is rostered (or it is ambiguous).
 */
export function readScopePreset(homeDir: string): string | undefined {
  let entries: string[]
  try {
    entries = readdirSync(join(homeDir, PROFILES_DIR), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return undefined
  }
  const found = new Set<string>()
  for (const name of entries.sort()) {
    let text: string
    try {
      text = readFileSync(join(homeDir, PROFILES_DIR, name, PROFILE_PATCH_FILENAME), 'utf8')
    } catch {
      continue
    }
    const preset = presetFromPatch(text)
    if (preset !== undefined) found.add(preset)
  }
  return found.size === 1 ? [...found][0] : undefined
}
