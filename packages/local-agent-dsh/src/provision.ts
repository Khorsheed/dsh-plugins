/**
 * Provision the sub-dsh's headless profile inside the harness scoped home.
 * The sub-dsh runs `dsh --profile <name>` with `$DSH_HOME` pointed at the
 * scoped home, so its profile must live under
 * `<scoped home>/profiles/<name>` — a manifest listing the official
 * `@deepseek-ai/dsh-base` layer, the family headless composition as the
 * profile's own patch layer (copied verbatim from the headless bundle's
 * `cordis.patch.yml`), and a single symlink resolving
 * `@khorsheed/dsh-local-agent-dsh-headless` from the sub-profile's
 * node_modules (the loader resolves the patch's insert rows through it).
 * Everything else the boot needs (dsh-base and its whole dependency graph,
 * cordis, the healed `profiles/node_modules` fallback) is resolved from the
 * dsh installation anchor automatically, so provisioning costs no pnpm
 * install.
 *
 * A sub-profile may additionally carry a PRESET ROSTER: one appended patch
 * layer inserting `@deepseek-ai/dsh-agent-presets` with a `default` preset
 * id. Without it the sub-dsh's model-facing rows come from the host plane and
 * the agent reads them off the global layer — which is why "the same harness
 * under two presets" was not a thing a condition could ask for. With it, the
 * scope directory IS the capability face: two scopes whose rosters name two
 * presets are two subjects, and the difference is a file a person can read.
 *
 * Where the preset DIRECTORY lives is the scope's business too. The roster
 * derives a user root of `<$DSH_HOME>/.agent-presets` and the sub-dsh runs
 * with `DSH_HOME` pointed at the scoped home, so a scope that keeps its own
 * copy there is resolved identically on the host and inside an evaluation
 * unit (which bind-mounts the scope, and nothing else). `provisionDshScope`
 * below is the entry that puts the copy there, records what the scope
 * composes in a file of its own, and rosters it with no `roots` at all.
 *
 * It may also carry a PERMISSION BOUNDARY: one appended patch layer pinning
 * `sandbox-policy`'s mode and `user-approval`'s policy to one of dsh's own
 * three permission presets. Without it the sub-dsh runs whatever `dsh-base`
 * composes — `workspace-write` plus `ask` — which is the right default for a
 * sub-dsh on a developer's machine and the wrong one inside an evaluation
 * unit, where the container IS the boundary and nobody is there to answer an
 * approval prompt. The layer is a FILE in the scope directory for the same
 * reason the roster is: a scoped home bind-mounted into a unit carries its
 * own boundary with it, and the value never has to ride the spawn env (where
 * every name enters the unit's composite fingerprint) or be baked into an
 * image.
 *
 * The headless bundle declares no `dsh.bundle` on purpose (the T6/G3
 * incident): a declaration would let the host's `dsh plugin` reconcile mount
 * its sub-dsh-only composition into any profile where the package is a
 * direct dependency — duplicate `code-runtime` at best. The patch therefore
 * reaches the sub-profile through this copy, not through the manifest
 * declaration; being the profile's own layer, it lands after every bundle
 * layer, the same position the headless bundle layer used to occupy.
 * @module @khorsheed/dsh-local-agent-dsh/provision
 */

import { createRequire } from 'node:module'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import yaml from 'js-yaml'

/** Default name of the sub-dsh profile under the scoped home. */
export const DEFAULT_SUB_PROFILE_NAME = 'headless-local-agent-dsh'

/** The user patch layer filename inside a profile directory. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Filename of the family headless bundle's patch, inside the bundle directory. */
const HEADLESS_PATCH_FILENAME = 'cordis.patch.yml'

/** One preset root the sub-profile's roster scans. */
export interface DshSubProfilePresetRoot {
  /** Directory holding preset sub-directories; a leading `~` is expanded by the roster. */
  path: string
  /** Trust level; the roster defaults it to `user`. */
  trust?: 'system' | 'user'
}

/**
 * The preset roster a sub-profile composes.
 *
 * `id` is the preset every sub-dsh session of this scope runs on. With no
 * `roots`, the roster's own derived roots apply: the presets shipped inside
 * `@deepseek-ai/dsh-agent-presets`, then `<scoped home>/.agent-presets` —
 * the sub-dsh runs with `DSH_HOME` pointed at the scoped home, so dropping a
 * preset directory THERE is how a scope gets a preset of its own.
 */
export interface DshSubProfilePreset {
  /** The preset id the sub-dsh composes (`[a-z0-9][a-z0-9-]*`, a directory name). */
  id: string
  /** Extra roots to scan, in precedence order. */
  roots?: readonly DshSubProfilePresetRoot[]
  /** Keep the roster's bundled presets (default true, the roster's own default). */
  includeShippedRoot?: boolean
  /** Keep `<scoped home>/.agent-presets` (default true, the roster's own default). */
  includeUserRoot?: boolean
}

/**
 * A sub-dsh permission preset: dsh's own three-word vocabulary, spelled the
 * way `@deepseek-ai/dsh-base` spells it in its `permission-presets` table.
 * Each word names BOTH halves of the boundary — the sandbox mode and the
 * approval policy — because that is what the table pairs them as.
 */
export type DshSubProfilePermissions = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * The approval policy each permission preset pairs with, copied from
 * `dsh-base`'s own `permission-presets` table. Pinning the two rows
 * separately (they are two plugins) must not let them drift apart: the sub-
 * dsh that sandboxes at `danger-full-access` while still asking for approval
 * would be a boundary nobody asked for.
 */
const APPROVAL_FOR: Readonly<Record<DshSubProfilePermissions, 'ask' | 'never'>> = {
  'read-only': 'ask',
  'workspace-write': 'ask',
  'danger-full-access': 'never',
}

/** Config the provisioning step reads. */
export interface DshSubProfileConfig {
  /** Sub-dsh profile name under the scoped home. */
  profileName?: string
  /**
   * Override the headless bundle directory the sub-profile symlinks to.
   * Absent means resolve `@khorsheed/dsh-local-agent-dsh-headless` from this
   * package's own installation.
   */
  headlessBundleDir?: string
  /**
   * Compose a preset roster into the sub-profile. Absent leaves the
   * sub-profile exactly as every scope had it before this field existed: no
   * roster row, and the agent reading the global layer.
   */
  preset?: DshSubProfilePreset
  /**
   * Pin the sub-dsh's permission boundary — the sandbox mode every confined
   * call runs under and the approval policy a denied call escalates through.
   * Absent leaves `dsh-base`'s own rows untouched, which is byte for byte
   * the behavior of every scope before this field existed.
   */
  permissions?: DshSubProfilePermissions
}

/** The roster row's id inside the sub-profile patch (and the marker this module rewrites). */
const PRESET_ROSTER_ROW_ID = 'agent-presets'

/**
 * The roster package the roster row names.
 *
 * Deliberately NOT symlinked into the sub-profile the way the headless bundle
 * is. The headless bundle is a `@khorsheed` package the dsh installation does
 * not carry, so it must be linked in from the plugin installation; the roster
 * is an OFFICIAL package, already in the installation anchor's closure beside
 * `@deepseek-ai/dsh-base`. Linking a second copy would give it a second
 * `@deepseek-ai/cordis` — and cordis does service lookup and type checks by
 * instance identity, so the symptom would be silently missing services rather
 * than an error (the same failure the dual-filesystem contract in the README
 * describes for the bundle). A deployment whose anchor genuinely lacks the
 * roster gets the loader's own "cannot resolve" message, which names the
 * module better than provisioning could.
 */
export const PRESET_ROSTER_MODULE = '@deepseek-ai/dsh-agent-presets'

/** A preset id doubles as a directory name — the roster's own rule. */
export const SUB_PROFILE_PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/

/** Header line that opens the generated roster layer (the parse anchor). */
const PRESET_BLOCK_HEADER = '# --- preset roster (written by local-agent-dsh provisioning) ---'

/** Header line that opens the generated permission layer (the parse anchor). */
const PERMISSION_BLOCK_HEADER = '# --- permission boundary (written by local-agent-dsh provisioning) ---'

/** The sub-profile's bundle layer list: the official base layer. The headless
 * composition rides the profile's own patch layer (see the module doc). */
const SUB_PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
]

/** The sub-profile manifest the boot reads. */
function subProfileManifest(profileName: string): string {
  return JSON.stringify({
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...SUB_PROFILE_BUNDLES] } },
  }, undefined, 2) + '\n'
}

/**
 * Resolve the family headless bundle's directory. The bundle is a declared
 * dependency of this package, so it resolves from the same installation; the
 * explicit config override exists for deployments that keep it elsewhere.
 * @param config - provisioning config carrying the optional override.
 * @returns the absolute bundle directory (holding `cordis.patch.yml`).
 */
export function resolveHeadlessBundleDir(config: DshSubProfileConfig = {}): string {
  if (config.headlessBundleDir !== undefined) return config.headlessBundleDir
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('@khorsheed/dsh-local-agent-dsh-headless/package.json')
  return dirname(manifestPath)
}

/** YAML-quote a scalar the roster config carries (paths and ids are operator input). */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * The roster layer appended to the sub-profile's patch, or `''` when the
 * sub-profile composes no preset.
 *
 * It is a SEPARATE patch operation appended after the headless bundle's own
 * list, which is what keeps the two independent: an upgraded headless bundle
 * rewrites its half and the roster survives, and dropping the preset drops
 * exactly these lines.
 * @param preset - the roster to compose, or undefined for none.
 * @returns the YAML text to append (already newline-terminated), or `''`.
 */
export function presetRosterLayer(preset: DshSubProfilePreset | undefined): string {
  if (preset === undefined) return ''
  if (!SUB_PROFILE_PRESET_ID_RE.test(preset.id)) {
    throw new Error(`provision-dsh: preset id ${JSON.stringify(preset.id)} must match ${String(SUB_PROFILE_PRESET_ID_RE)} (it is a directory name)`)
  }
  const lines = [
    '',
    PRESET_BLOCK_HEADER,
    '# The sub-dsh composes every session from this preset; the headless agent',
    '# loader joins the roster in its agent setup. Remove this layer and the',
    '# agent falls back to the global layer.',
    '- insert:',
    `    - id: ${PRESET_ROSTER_ROW_ID}`,
    `      name: '${PRESET_ROSTER_MODULE}'`,
    '      config:',
    `        default: ${yamlString(preset.id)}`,
  ]
  if (preset.includeShippedRoot !== undefined) lines.push(`        includeShippedRoot: ${String(preset.includeShippedRoot)}`)
  if (preset.includeUserRoot !== undefined) lines.push(`        includeUserRoot: ${String(preset.includeUserRoot)}`)
  if (preset.roots !== undefined && preset.roots.length > 0) {
    lines.push('        roots:')
    for (const root of preset.roots) {
      lines.push(`          - path: ${yamlString(root.path)}`)
      if (root.trust !== undefined) lines.push(`            trust: ${root.trust}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * The preset id a provisioned sub-profile's patch composes, read back from
 * the file. The roster layer is generated, so it is also parseable: a lock
 * check or a status surface can answer "which preset does this scope run?"
 * without booting the sub-dsh.
 * @param homeDir - the harness scoped home.
 * @param profileName - the sub-profile name (default {@link DEFAULT_SUB_PROFILE_NAME}).
 * @returns the preset id, or undefined when the sub-profile composes no roster.
 */
export function readSubProfilePreset(homeDir: string, profileName: string = DEFAULT_SUB_PROFILE_NAME): string | undefined {
  const patchPath = join(homeDir, 'profiles', profileName, PROFILE_PATCH_FILENAME)
  let content: string
  try {
    content = readFileSync(patchPath, 'utf8')
  } catch {
    return undefined
  }
  const header = content.indexOf(PRESET_BLOCK_HEADER)
  if (header === -1) return undefined
  const match = /^\s*default:\s*"([^"]*)"\s*$/m.exec(content.slice(header))
  return match?.[1]
}

/**
 * The permission layer appended to the sub-profile's patch, or `''` when the
 * sub-profile pins no boundary.
 *
 * Two PATCH rows, not inserts: `sandbox-policy` and `approval` already exist
 * in the `@deepseek-ai/dsh-base` layer this profile stacks on, and the layer
 * lands after it, so these override what the base composed. A base that
 * mounts neither row (a future line, a different bundle) makes the loader
 * warn "entry not found" and skip — a sub-dsh that boots with the composition
 * it has, never one that fails to boot over a knob.
 *
 * Both rows RE-STATE every key they own. A patch `config` is a whole-value
 * REPLACE, not a deep merge (`applyEntryPatches`: `target[key] = value`), so
 * a row that wrote `mode` alone would silently drop `workspaceRoot` — and
 * both rows carry `name` so a foreign plugin squatting the id makes the
 * loader report a name mismatch and skip, rather than take this config.
 *
 * Pinning the literal also takes the boundary OFF `DSH_PERMISSION_MODE`,
 * which is what `dsh-base` otherwise reads it from: the value belongs to the
 * scope directory, where `home.sha` already hashes it, rather than to
 * whatever environment happened to spawn the process.
 * @param permissions - the boundary to pin, or undefined for none.
 * @returns the YAML text to append (already newline-terminated), or `''`.
 */
export function permissionBoundaryLayer(permissions: DshSubProfilePermissions | undefined): string {
  if (permissions === undefined) return ''
  // The value reaches here from YAML, so the union is a claim rather than a
  // guarantee: a typo must fail loud at provisioning time, not compose a
  // boundary the sandbox plugin then rejects at the sub-dsh's boot.
  if (!Object.hasOwn(APPROVAL_FOR, permissions)) {
    throw new Error(`provision-dsh: permissions ${JSON.stringify(permissions)} must be one of ${Object.keys(APPROVAL_FOR).join(', ')}`)
  }
  const approval = APPROVAL_FOR[permissions]
  const lines = [
    '',
    PERMISSION_BLOCK_HEADER,
    '# The sub-dsh runs every confined call under this mode and answers every',
    '# escalation with this policy. Remove this layer and the sub-dsh falls',
    '# back to what dsh-base composes (workspace-write + ask).',
    '- id: sandbox-policy',
    "  name: '@deepseek-ai/dsh-sandbox-policy'",
    '  config:',
    `    mode: ${permissions}`,
    '    workspaceRoot: !!js process.cwd()',
    '- id: approval',
    "  name: '@deepseek-ai/dsh-user-approval'",
    '  config:',
    `    policy: ${approval}`,
  ]
  return `${lines.join('\n')}\n`
}

/**
 * The permission boundary a provisioned sub-profile's patch pins, read back
 * from the file — the counterpart of {@link readSubProfilePreset}, and
 * readable for the same reason: the layer is generated, so a lock check or a
 * status surface can answer "what boundary does this scope run under?"
 * without booting the sub-dsh.
 * @param homeDir - the harness scoped home.
 * @param profileName - the sub-profile name (default {@link DEFAULT_SUB_PROFILE_NAME}).
 * @returns the pinned mode, or undefined when the sub-profile pins none.
 */
export function readSubProfilePermissions(
  homeDir: string,
  profileName: string = DEFAULT_SUB_PROFILE_NAME,
): DshSubProfilePermissions | undefined {
  const patchPath = join(homeDir, 'profiles', profileName, PROFILE_PATCH_FILENAME)
  let content: string
  try {
    content = readFileSync(patchPath, 'utf8')
  } catch {
    return undefined
  }
  const header = content.indexOf(PERMISSION_BLOCK_HEADER)
  if (header === -1) return undefined
  const match = /^\s*mode:\s*(\S+)\s*$/m.exec(content.slice(header))
  const mode = match?.[1]
  return mode !== undefined && Object.hasOwn(APPROVAL_FOR, mode) ? (mode as DshSubProfilePermissions) : undefined
}

/** Ensure `link` is a symlink to `target`, replacing a wrong or dangling link; a real directory throws. */
function ensureSymlink(link: string, target: string): void {
  let stat
  try {
    stat = lstatSync(link)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    symlinkSync(target, link)
    return
  }
  if (stat.isDirectory()) {
    throw new Error(`provision-dsh: ${link} is a real directory, not the expected symlink; remove it manually`)
  }
  if (readlinkSync(link) === target) return
  rmSync(link, { force: true })
  symlinkSync(target, link)
}

/**
 * Provision (idempotently) the sub-dsh headless profile in the harness
 * scoped home: manifest, the headless patch as the profile's own patch
 * layer, and the bundle symlink. A file whose content already matches is
 * left untouched, so re-running after a restart is a no-op; a drifted file
 * (an upgraded headless bundle, or a profile provisioned by the pre-T6
 * scheme whose manifest listed the headless bundle as a layer) is rewritten,
 * which heals it before the sub-dsh boots.
 * @param homeDir - the `dsh` harness's scoped home (its `$DSH_HOME` root).
 * @param config - profile naming and bundle-dir overrides.
 * @returns the absolute sub-profile directory.
 */
export function provisionDshSubProfile(homeDir: string, config: DshSubProfileConfig = {}): string {
  const profileName = config.profileName ?? DEFAULT_SUB_PROFILE_NAME
  const bundleDir = resolveHeadlessBundleDir(config)
  const profileDir = join(homeDir, 'profiles', profileName)
  mkdirSync(profileDir, { recursive: true })
  const manifestPath = join(profileDir, 'package.json')
  const manifestContent = subProfileManifest(profileName)
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifestContent) {
    writeFileSync(manifestPath, manifestContent)
  }
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  const patchContent = readFileSync(join(bundleDir, HEADLESS_PATCH_FILENAME), 'utf8')
    + presetRosterLayer(config.preset)
    + permissionBoundaryLayer(config.permissions)
  if (!existsSync(patchPath) || readFileSync(patchPath, 'utf8') !== patchContent) {
    writeFileSync(patchPath, patchContent)
  }
  const bundleLink = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
  mkdirSync(dirname(bundleLink), { recursive: true })
  ensureSymlink(bundleLink, bundleDir)
  return profileDir
}

// ── the scope's own preset ───────────────────────────────────────────────

/**
 * The preset root a harness home derives — the roster's own rule, spelled
 * here because this module has to write into it.
 */
export const USER_PRESET_DIR = '.agent-presets'

/** The file that makes a preset directory a preset (the roster's rule). */
const PRESET_COMPOSITION_FILE = 'agent.cordis.yml'

/**
 * The scope's own declaration of what its sub-profile composes.
 *
 * A FILE in the scope directory, for the third time and the same reason as
 * the roster layer and the permission boundary: a scoped home bind-mounted
 * into an evaluation unit carries its own composition with it, and nothing
 * has to ride the spawn env or be baked into an image.
 *
 * It exists because the plugin's own `config` is instance-global — one
 * deployment, one answer — while a preset is a property of the SUBJECT. Two
 * scopes rostering two presets was therefore unexpressible, and the only way
 * to build it was to hand-append the roster layer to each scope's patch. That
 * hand edit does not survive: this module regenerates the patch WHOLE, and
 * the registry re-provisions a scope the first time anything names it in a
 * fresh host process — so the roster silently disappears on the next restart,
 * and the next read-back reports a scope that rosters nothing.
 */
export const SCOPE_SUB_PROFILE_FILENAME = 'sub-profile.json'

/** What {@link SCOPE_SUB_PROFILE_FILENAME} may say. */
export interface DshScopeSubProfile {
  /** The preset id this scope's sub-dsh composes. */
  preset?: string
}

/**
 * Read one scope's own sub-profile declaration.
 *
 * Degrades to `undefined` for every unreadable shape — no file, unparsable
 * JSON, a `preset` that is not a usable id — because the caller's next step
 * is the plugin-level config, and a scope whose declaration is junk must fall
 * back to the deployment's answer rather than fail to provision at all.
 * @param homeDir - the harness scoped home.
 * @returns the declaration, or undefined when the scope declares nothing usable.
 */
export function readScopeSubProfile(homeDir: string): DshScopeSubProfile | undefined {
  let text: string
  try {
    text = readFileSync(join(homeDir, SCOPE_SUB_PROFILE_FILENAME), 'utf8')
  } catch {
    return undefined
  }
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return undefined
  const preset = (document as Record<string, unknown>)['preset']
  if (typeof preset !== 'string' || !SUB_PROFILE_PRESET_ID_RE.test(preset)) return undefined
  return { preset }
}

/**
 * Record one scope's sub-profile declaration, so the next provisioning of
 * that scope reproduces it without being told. Idempotent — a file that
 * already says this is left untouched.
 * @param homeDir - the harness scoped home.
 * @param declaration - what the scope composes.
 */
export function writeScopeSubProfile(homeDir: string, declaration: DshScopeSubProfile): void {
  const path = join(homeDir, SCOPE_SUB_PROFILE_FILENAME)
  const content = JSON.stringify(declaration, undefined, 2) + '\n'
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return
  mkdirSync(homeDir, { recursive: true })
  writeFileSync(path, content)
}

/**
 * A YAML schema that keeps `!!js` expressions as their SOURCE TEXT.
 *
 * The loader evaluates those expressions; this module only reads them, and
 * evaluating one here would run preset text as code inside the host process.
 * Keeping the source is what lets {@link compositionAbsolutePaths} see an
 * absolute path hidden inside one.
 */
const EXPRESSION_SCHEMA = yaml.DEFAULT_SCHEMA.extend(
  (['scalar', 'sequence', 'mapping'] as const).map(kind => new yaml.Type('tag:yaml.org,2002:js', {
    kind,
    construct: (data: unknown) => ({ __jsExpr: typeof data === 'string' ? data : '' }),
  })),
)

/** A quoted absolute path inside an expression's source text. */
const QUOTED_ABSOLUTE_RE = /(['"])(\/[^'"\n]*)\1/g

/**
 * Every absolute filesystem path a preset composition names.
 *
 * An absolute path is the one thing in a composition that cannot be true in
 * two places at once, and a preset used as an evaluation factor is copied:
 * it is read on the host from the deployment's preset root, again from the
 * scope's own copy, and a third time inside a unit where the scope is bound
 * at a different mount point. `skill-filesystem` resolves each
 * `customSkillDirs` entry with `resolve()`, so an absolute entry is taken as
 * written and a bare relative one resolves against the process's cwd —
 * neither travels.
 *
 * What does travel is the loader's own expression form, which the shipped
 * `cordis` preset already uses:
 *
 * ```yaml
 * customSkillDirs:
 *   - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
 * ```
 *
 * `baseUrl` is the composition's own directory (the include rewrites it), so
 * the root resolves wherever the preset is installed.
 *
 * Unparsable YAML reports NO findings: the loader is the authority on whether
 * a composition loads, and refusing a preset because this reader could not
 * parse it would be this module overruling it.
 * @param text - the `agent.cordis.yml` content.
 * @returns the offending literals, in document order, deduplicated.
 */
export function compositionAbsolutePaths(text: string): string[] {
  let document: unknown
  try {
    document = yaml.load(text, { schema: EXPRESSION_SCHEMA })
  } catch {
    return []
  }
  const found: string[] = []
  const add = (value: string): void => {
    if (!found.includes(value)) found.push(value)
  }
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (isAbsolute(value) || value.startsWith('file:///')) add(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const expression = (value as Record<string, unknown>)['__jsExpr']
    if (typeof expression === 'string') {
      for (const match of expression.matchAll(QUOTED_ABSOLUTE_RE)) {
        const literal = match[2]
        if (literal !== undefined) add(literal)
      }
      return
    }
    for (const item of Object.values(value as Record<string, unknown>)) walk(item)
  }
  walk(document)
  return found
}

/** Every regular file under `dir`, as posix-ish relative paths, sorted. */
function presetTreeFiles(dir: string): string[] | undefined {
  const files: string[] = []
  const walk = (absDir: string, rel: string): boolean => {
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const relChild = rel === '' ? entry.name : `${rel}/${entry.name}`
      // A symlink is refused rather than followed: it does not survive the
      // bind mount into a unit, and the scoped home's own hash counts one as
      // skipped — a preset half of which is not hashed is not a subject.
      if (entry.isSymbolicLink()) return false
      if (entry.isDirectory()) {
        if (!walk(join(absDir, entry.name), relChild)) return false
        continue
      }
      if (!entry.isFile()) return false
      files.push(relChild)
    }
    return true
  }
  if (!walk(dir, '')) return undefined
  return files.sort()
}

/**
 * Whether two preset directories are the same directory, byte for byte.
 *
 * This is the whole claim the evaluation rests on: a capability face carries
 * no filesystem path, so the fingerprint taken against the deployment's copy
 * describes the scope's copy exactly when the two hold the same bytes.
 * @param a - one preset directory.
 * @param b - the other.
 * @returns true when both hold the same files with the same contents.
 */
export function presetTreesEqual(a: string, b: string): boolean {
  const left = presetTreeFiles(a)
  const right = presetTreeFiles(b)
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length || left.some((name, index) => name !== right[index])) return false
  return left.every(name => {
    try {
      return readFileSync(join(a, name)).equals(readFileSync(join(b, name)))
    } catch {
      return false
    }
  })
}

/** Copy one preset directory onto another, replacing whatever was there. */
function mirrorPresetTree(source: string, target: string): void {
  const files = presetTreeFiles(source)
  if (files === undefined) {
    throw new Error(`provision-dsh: preset directory ${source} is not a plain tree of files`
      + ' (a symlink or a device node cannot be copied into a scope — an evaluation unit resolves neither)')
  }
  rmSync(target, { recursive: true, force: true })
  for (const name of files) {
    const destination = join(target, name)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(source, name), destination)
  }
}

/** What {@link snapshotScopePreset} did. */
export interface DshScopePresetSnapshot {
  /** The scope's copy of the preset directory. */
  dir: string
  /** Whether that copy is byte-for-byte the deployment's own. */
  matchesSource: boolean
  /** Whether this call wrote it. */
  copied: boolean
}

/**
 * Give one scope its own copy of a preset, from the deployment's preset root.
 *
 * The copy is what makes a preset reachable on BOTH paths. The roster derives
 * a user root of `<$DSH_HOME>/.agent-presets`, and the sub-dsh runs with
 * `DSH_HOME` pointed at the scoped home — which is `<scope>/.agent-presets`
 * on the host and `/creds/dsh/.agent-presets` inside an evaluation unit,
 * one directory, because the unit binds the scope. A roster pointed at the
 * deployment's root instead resolves on the host and names a path the unit
 * does not have.
 *
 * `refresh` is the difference between provisioning a condition and healing a
 * scope. A deliberate provision re-syncs from the deployment's copy, because
 * that is the moment a new lock is minted and an edited preset should be
 * picked up. Every other provisioning leaves an existing copy alone: nothing
 * may move the subject under a run.
 * @param homeDir - the harness scoped home.
 * @param presetRoot - the deployment's preset root.
 * @param id - the preset id (a directory name in both roots).
 * @param options - `refresh` re-syncs an existing copy.
 * @returns where the copy is and whether it matches the source.
 * @throws when the source is missing, is not a preset, or names an absolute path.
 */
export function snapshotScopePreset(
  homeDir: string,
  presetRoot: string,
  id: string,
  options: { refresh?: boolean } = {},
): DshScopePresetSnapshot {
  if (!SUB_PROFILE_PRESET_ID_RE.test(id)) {
    throw new Error(`provision-dsh: preset id ${JSON.stringify(id)} must match ${String(SUB_PROFILE_PRESET_ID_RE)} (it is a directory name)`)
  }
  const source = join(presetRoot, id)
  const composition = join(source, PRESET_COMPOSITION_FILE)
  if (!existsSync(composition)) {
    throw new Error(`provision-dsh: no preset ${JSON.stringify(id)} in ${presetRoot}`
      + ` (expected ${join(id, PRESET_COMPOSITION_FILE)}) — install it into this deployment's preset root before a scope can compose it`)
  }
  const offenders = compositionAbsolutePaths(readFileSync(composition, 'utf8'))
  if (offenders.length > 0) {
    throw new Error(`provision-dsh: preset ${JSON.stringify(id)} names absolute path(s) ${offenders.map(path => JSON.stringify(path)).join(', ')}`
      + ' — a preset that is copied into a scope and bind-mounted into a unit is read from three different directories,'
      + ' so an absolute path is wrong in at least two of them. Use the loader expression the shipped `cordis` preset uses:'
      + ' !!js "process.getBuiltinModule(\'node:url\').fileURLToPath(new URL(\'skills/\', baseUrl))"')
  }
  const dir = join(homeDir, USER_PRESET_DIR, id)
  if (existsSync(dir) && options.refresh !== true) {
    return { dir, matchesSource: presetTreesEqual(source, dir), copied: false }
  }
  if (existsSync(dir) && presetTreesEqual(source, dir)) {
    return { dir, matchesSource: true, copied: false }
  }
  mirrorPresetTree(source, dir)
  return { dir, matchesSource: true, copied: true }
}

/**
 * The deployment's own preset root, when the caller names no other.
 *
 * The roster's own derivation, repeated here because the provisioning paths
 * that heal a scope (a host round, a live runtime) have no settings service
 * in reach: the harness home from the environment, else the installation
 * default.
 */
export function defaultPresetRoot(): string {
  return join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh-official'), USER_PRESET_DIR)
}

/** Per-scope inputs {@link provisionDshScope} takes. */
export interface DshScopeProvisionOptions {
  /**
   * The preset this scope composes. Present, it is authoritative: it is
   * persisted into the scope's own declaration and its copy is re-synced from
   * the deployment's preset root. Absent, the scope's declaration decides.
   */
  preset?: string
  /** The deployment's preset root; defaults to `<$DSH_HOME>/.agent-presets`. */
  presetRoot?: string
}

/** What {@link provisionDshScope} left in the scope. */
export interface DshScopeProvisioned {
  /** The sub-profile directory. */
  profileDir: string
  /** The preset the sub-profile now rosters, when it rosters one. */
  preset?: string
  /** The scope's own copy of that preset, when it keeps one. */
  presetSnapshot?: { matchesSource: boolean }
}

/**
 * Provision one scope: its own preset copy, its declaration, and the
 * sub-profile that rosters it.
 *
 * The preset resolves in one order, and the order is the decision: the
 * CALLER's explicit request, then the SCOPE's own declaration, then the
 * deployment's plugin config. The first is how a condition says which subject
 * this scope is; the second is how that survives a restart; the third is the
 * deployment-wide answer every scope had before either existed.
 *
 * A scope-owned preset rosters with NO `roots`. The roster's derived user
 * root is exactly the scope's copy on both paths, so leaving the roots alone
 * is what gives the host and the unit one resolution rule instead of two.
 * @param homeDir - the harness scoped home.
 * @param config - the deployment's sub-profile config.
 * @param options - per-scope inputs.
 * @returns what the scope now composes.
 */
export function provisionDshScope(
  homeDir: string,
  config: DshSubProfileConfig = {},
  options: DshScopeProvisionOptions = {},
): DshScopeProvisioned {
  const requested = options.preset
  const declared = requested ?? readScopeSubProfile(homeDir)?.preset
  if (requested !== undefined) writeScopeSubProfile(homeDir, { preset: requested })
  let snapshot: DshScopePresetSnapshot | undefined
  if (declared !== undefined) {
    snapshot = snapshotScopePreset(homeDir, options.presetRoot ?? defaultPresetRoot(), declared, { refresh: requested !== undefined })
  }
  const preset: DshSubProfilePreset | undefined = declared === undefined ? config.preset : { id: declared }
  const profileDir = provisionDshSubProfile(homeDir, { ...config, ...(preset === undefined ? {} : { preset }) })
  return {
    profileDir,
    ...(preset === undefined ? {} : { preset: preset.id }),
    ...(snapshot === undefined ? {} : { presetSnapshot: { matchesSource: snapshot.matchesSource } }),
  }
}
