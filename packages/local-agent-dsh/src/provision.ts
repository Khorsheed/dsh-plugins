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
 * A sub-profile may additionally compose an AGENT PRESET (host 0.2.0's
 * declarative form): the bundle package that declares the preset — an
 * `@deepseek-ai/dsh-agent-preset` row in its own bundle patch — joins the
 * manifest's bundle list, and one appended patch layer inserts
 * `@deepseek-ai/dsh-agent-preset-registry` with that preset as its
 * `default`. Without it the sub-dsh's model-facing rows come from the host
 * plane and the agent reads them off the global layer — which is why "the
 * same harness under two presets" was not a thing a condition could ask for.
 * With it, the scope directory IS the capability face: two scopes naming two
 * presets are two subjects, and the difference is files a person can read.
 *
 * Where the preset PACKAGE lives is the scope's business too. The scope keeps
 * its own copy at `<scoped home>/preset-packages/<id>` and the sub-profile
 * resolves it through a RELATIVE symlink in its own `node_modules`, so the
 * package is found identically on the host and inside an evaluation unit
 * (which bind-mounts the scope, and nothing else). The copy comes from the
 * evaluation instance's own installation of the same package, which is also
 * what the instance's capability catalog measures. `provisionDshScope` below
 * is the entry that makes the copy, records what the scope composes in a
 * file of its own, and composes it. (0.1.x wrote a roster row for
 * `@deepseek-ai/dsh-agent-presets` and a `<scoped home>/.agent-presets/<id>`
 * directory instead; 0.2.0 ships neither the roster nor the directory scan.)
 *
 * It may also carry a PERMISSION BOUNDARY: one appended patch layer pinning
 * `sandbox-policy`'s mode and `user-approval`'s policy to one of dsh's own
 * three permission presets. Without it the sub-dsh runs whatever `dsh-base`
 * composes — `workspace-write` plus `ask` — which is the right default for a
 * sub-dsh on a developer's machine and the wrong one inside an evaluation
 * unit, where the container IS the boundary and nobody is there to answer an
 * approval prompt. The layer is a FILE in the scope directory for the same
 * reason the preset layer is: a scoped home bind-mounted into a unit carries its
 * own boundary with it, and the value never has to ride the spawn env (where
 * every name enters the unit's composite fingerprint) or be baked into an
 * image.
 *
 * The headless bundle declares no `dsh.bundle` on purpose (the T6/G3
 * incident): a declaration would let the host's `dsh plugin` reconcile mount
 * its sub-dsh-only composition into any profile where the package is a
 * direct dependency — duplicate `ptc-runtime` at best. The patch therefore
 * reaches the sub-profile through this copy, not through the manifest
 * declaration; being the profile's own layer, it lands after every bundle
 * layer, the same position the headless bundle layer used to occupy.
 * @module @khorsheed/dsh-local-agent-dsh/provision
 */

import { createRequire } from 'node:module'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import yaml from 'js-yaml'

/** Default name of the sub-dsh profile under the scoped home. */
export const DEFAULT_SUB_PROFILE_NAME = 'headless-local-agent-dsh'

/** The user patch layer filename inside a profile directory. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Filename of the family headless bundle's patch, inside the bundle directory. */
const HEADLESS_PATCH_FILENAME = 'cordis.patch.yml'

/**
 * The agent preset a sub-profile composes.
 *
 * `id` is the preset every sub-dsh session of this scope joins — the
 * registry row's `default`. `package` is the bundle package that DECLARES it
 * (an `@deepseek-ai/dsh-agent-preset` row in its bundle patch): it joins the
 * sub-profile's bundle list and resolves from the sub-profile's own
 * `node_modules`, where provisioning links the scope's copy of it. Absent
 * `package` writes the registry row alone, for an id the sub-dsh's own
 * installation already declares.
 */
export interface DshSubProfilePreset {
  /** The preset id the sub-dsh composes (`[a-z0-9][a-z0-9-]*`). */
  id: string
  /** The bundle package declaring that preset. */
  package?: string
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
   * The headless bundle directory as an evaluation UNIT sees it (the image's
   * own install, `/opt/dsh-headless/node_modules/@khorsheed/dsh-local-agent-dsh-headless`
   * on the dataset image). Present, provisioning writes a second sub-profile,
   * `<profileName>-unit`, identical but for that symlink target, and
   * container rounds launch it — so the host profile can link the bundle THIS
   * instance resolves (its own host line) while the unit keeps the image's.
   * Absent, both kinds of round share one profile, as before this existed.
   */
  unitHeadlessBundleDir?: string
  /**
   * Compose an agent preset into the sub-profile. Absent leaves the
   * sub-profile exactly as every scope had it before this field existed: no
   * registry row, and the agent reading the global layer.
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

/** The registry row's id inside the sub-profile patch. */
const PRESET_REGISTRY_ROW_ID = 'agent-preset-registry'

/**
 * The registry package the registry row names.
 *
 * Deliberately NOT symlinked into the sub-profile the way the headless bundle
 * is. The headless bundle is a `@khorsheed` package the dsh installation does
 * not carry, so it must be linked in from the plugin installation; the
 * registry is an OFFICIAL package, already in the installation anchor's
 * closure beside `@deepseek-ai/dsh-base`. Linking a second copy would give it
 * a second `@deepseek-ai/cordis` — and cordis does service lookup and type
 * checks by instance identity, so the symptom would be silently missing
 * services rather than an error. A deployment whose anchor genuinely lacks the
 * registry gets the loader's own "cannot resolve" message, which names the
 * module better than provisioning could.
 */
export const PRESET_REGISTRY_MODULE = '@deepseek-ai/dsh-agent-preset-registry'

/** The declarative preset row a preset bundle package carries in its patch. */
export const PRESET_ROW_MODULE = '@deepseek-ai/dsh-agent-preset'

/** A preset id doubles as a directory name inside the scope. */
export const SUB_PROFILE_PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/

/** An npm package name the sub-profile manifest may list as a bundle. */
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/** Header line that opens the generated preset layer (the parse anchor). */
const PRESET_BLOCK_HEADER = '# --- agent preset (written by local-agent-dsh provisioning) ---'

/** Header line that opens the generated permission layer (the parse anchor). */
const PERMISSION_BLOCK_HEADER = '# --- permission boundary (written by local-agent-dsh provisioning) ---'

/** The sub-profile's bundle layer list: the official base layer. The headless
 * composition rides the profile's own patch layer (see the module doc). */
const SUB_PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
]

/** The sub-profile manifest the boot reads. */
function subProfileManifest(profileName: string, presetPackage: string | undefined): string {
  const bundles = presetPackage === undefined ? [...SUB_PROFILE_BUNDLES] : [...SUB_PROFILE_BUNDLES, presetPackage]
  return JSON.stringify({
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
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

/** YAML-quote a scalar the generated layers carry (ids are operator input). */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * The preset layer appended to the sub-profile's patch, or `''` when the
 * sub-profile composes no preset.
 *
 * One insert of the 0.2.0 preset registry with the preset as its `default`:
 * every sub-dsh session that names no preset joins this one (the headless
 * agent loader mounts it through the registry's `mount`). The preset's own
 * declaration rides the bundle layer — the package that declares it is in
 * the manifest's bundle list — so this layer never repeats the composition.
 *
 * It is a SEPARATE patch operation appended after the headless bundle's own
 * list, which is what keeps the two independent: an upgraded headless bundle
 * rewrites its half and the preset survives, and dropping the preset drops
 * exactly these lines.
 * @param preset - the preset to compose, or undefined for none.
 * @returns the YAML text to append (already newline-terminated), or `''`.
 */
export function presetRegistryLayer(preset: DshSubProfilePreset | undefined): string {
  if (preset === undefined) return ''
  if (!SUB_PROFILE_PRESET_ID_RE.test(preset.id)) {
    throw new Error(`provision-dsh: preset id ${JSON.stringify(preset.id)} must match ${String(SUB_PROFILE_PRESET_ID_RE)} (it is a directory name)`)
  }
  const lines = [
    '',
    PRESET_BLOCK_HEADER,
    '# The sub-dsh composes every session from this preset; the headless agent',
    '# loader mounts it through the registry. Remove this layer and the agent',
    '# falls back to the global layer.',
    '- insert:',
    `    - id: ${PRESET_REGISTRY_ROW_ID}`,
    `      name: '${PRESET_REGISTRY_MODULE}'`,
    '      config:',
    `        default: ${yamlString(preset.id)}`,
  ]
  return `${lines.join('\n')}\n`
}

/**
 * The preset id a provisioned sub-profile's patch composes, read back from
 * the file. The preset layer is generated, so it is also parseable: a lock
 * check or a status surface can answer "which preset does this scope run?"
 * without booting the sub-dsh.
 * @param homeDir - the harness scoped home.
 * @param profileName - the sub-profile name (default {@link DEFAULT_SUB_PROFILE_NAME}).
 * @returns the preset id, or undefined when the sub-profile composes no preset.
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

/** Suffix of the evaluation-unit twin of a sub-profile (see `unitHeadlessBundleDir`). */
export const UNIT_PROFILE_SUFFIX = '-unit'

/**
 * The profile name an evaluation UNIT launches for this config: the
 * `-unit` twin when one is configured, else the one sub-profile.
 * @param config - provisioning config.
 * @returns the profile name a container round passes to `--profile`.
 */
export function unitSubProfileName(config: DshSubProfileConfig = {}): string {
  const profileName = config.profileName ?? DEFAULT_SUB_PROFILE_NAME
  return config.unitHeadlessBundleDir === undefined ? profileName : `${profileName}${UNIT_PROFILE_SUFFIX}`
}

/** Write one file only when its content differs. */
function writeIfChanged(path: string, content: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== content) writeFileSync(path, content)
}

/** Provision one sub-profile directory against one headless bundle directory. */
function provisionOneSubProfile(
  homeDir: string, profileName: string, bundleDir: string, patchSourceDir: string, config: DshSubProfileConfig,
): string {
  const profileDir = join(homeDir, 'profiles', profileName)
  mkdirSync(profileDir, { recursive: true })
  const presetPackage = config.preset?.package
  if (presetPackage !== undefined && !PACKAGE_NAME_RE.test(presetPackage)) {
    throw new Error(`provision-dsh: preset package name ${JSON.stringify(presetPackage)} is not an npm package name`)
  }
  writeIfChanged(join(profileDir, 'package.json'), subProfileManifest(profileName, presetPackage))
  writeIfChanged(
    join(profileDir, PROFILE_PATCH_FILENAME),
    readFileSync(join(patchSourceDir, HEADLESS_PATCH_FILENAME), 'utf8')
      + presetRegistryLayer(config.preset)
      + permissionBoundaryLayer(config.permissions),
  )
  const bundleLink = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
  mkdirSync(dirname(bundleLink), { recursive: true })
  ensureSymlink(bundleLink, bundleDir)
  if (presetPackage !== undefined && config.preset !== undefined) {
    // RELATIVE, so the link resolves the same on the host and inside a unit
    // that bind-mounts the scope at a different absolute path.
    const presetLink = join(profileDir, 'node_modules', ...presetPackage.split('/'))
    mkdirSync(dirname(presetLink), { recursive: true })
    ensureSymlink(presetLink, relative(dirname(presetLink), scopePresetPackageDir(homeDir, config.preset.id)))
  }
  return profileDir
}

/**
 * Provision (idempotently) the sub-dsh headless profile in the harness
 * scoped home: manifest, the headless patch as the profile's own patch
 * layer, and the bundle symlink — plus, when a preset package is composed,
 * the relative link resolving it from the scope's own copy, and, when
 * `unitHeadlessBundleDir` is configured, the `-unit` twin a container round
 * launches. A file whose content already matches is left untouched, so
 * re-running after a restart is a no-op; a drifted file (an upgraded headless
 * bundle, or a profile provisioned by an earlier scheme) is rewritten, which
 * heals it before the sub-dsh boots.
 * @param homeDir - the `dsh` harness's scoped home (its `$DSH_HOME` root).
 * @param config - profile naming and bundle-dir overrides.
 * @returns the absolute (host) sub-profile directory.
 */
export function provisionDshSubProfile(homeDir: string, config: DshSubProfileConfig = {}): string {
  const profileName = config.profileName ?? DEFAULT_SUB_PROFILE_NAME
  const hostBundleDir = resolveHeadlessBundleDir(config)
  const profileDir = provisionOneSubProfile(homeDir, profileName, hostBundleDir, hostBundleDir, config)
  const unitDir = config.unitHeadlessBundleDir
  if (unitDir !== undefined) {
    // The twin's patch comes from the unit's bundle when this machine can
    // read it (a host-side mirror of the image's install, as `/opt` is on a
    // dataset machine), else from the host bundle — the link is what moves.
    const patchSource = existsSync(join(unitDir, HEADLESS_PATCH_FILENAME)) ? unitDir : hostBundleDir
    provisionOneSubProfile(homeDir, unitSubProfileName(config), unitDir, patchSource, config)
  }
  return profileDir
}

// ── the scope's own preset ───────────────────────────────────────────────

/**
 * Where a scope keeps its own copy of each preset PACKAGE it composes:
 * `<scoped home>/preset-packages/<id>`. (0.1.x used `.agent-presets/<id>`,
 * the directory roster's derived user root; 0.2.0 has no directory scan.)
 */
export const SCOPE_PRESET_PACKAGES_DIR = 'preset-packages'

/**
 * The scope's copy of one preset package.
 * @param homeDir - the harness scoped home.
 * @param id - the preset id.
 * @returns the directory, whether or not it exists.
 */
export function scopePresetPackageDir(homeDir: string, id: string): string {
  return join(homeDir, SCOPE_PRESET_PACKAGES_DIR, id)
}

/**
 * The scope's own declaration of what its sub-profile composes.
 *
 * A FILE in the scope directory, for the third time and the same reason as
 * the preset layer and the permission boundary: a scoped home bind-mounted
 * into an evaluation unit carries its own composition with it, and nothing
 * has to ride the spawn env or be baked into an image.
 *
 * It exists because the plugin's own `config` is instance-global — one
 * deployment, one answer — while a preset is a property of the SUBJECT. Two
 * scopes composing two presets was therefore unexpressible, and the only way
 * to build it was to hand-append the preset layer to each scope's patch. That
 * hand edit does not survive: this module regenerates the patch WHOLE, and
 * the registry re-provisions a scope the first time anything names it in a
 * fresh host process — so the layer silently disappears on the next restart,
 * and the next read-back reports a scope that composes nothing.
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
 * Every absolute filesystem path a preset bundle patch names.
 *
 * An absolute path is the one thing in a composition that cannot be true in
 * two places at once, and a preset used as an evaluation factor is copied:
 * it is read on the host from the instance's installation, again from the
 * scope's own copy, and a third time inside a unit where the scope is bound
 * at a different mount point. `skill-filesystem` resolves each
 * `customSkillDirs` entry with `resolve()`, so an absolute entry is taken as
 * written and a bare relative one resolves against the process's cwd —
 * neither travels.
 *
 * What does travel is resolving the package's own directory through the
 * loader's `baseUrl` (the declaring profile's root), the form the official
 * web-app presets use:
 *
 * ```yaml
 * customSkillDirs:
 *   - !!js "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('<pkg>/package.json')), 'skills')"
 * ```
 *
 * Unparsable YAML reports NO findings: the loader is the authority on whether
 * a composition loads, and refusing a preset because this reader could not
 * parse it would be this module overruling it.
 * @param text - the bundle patch content.
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

/** Every regular file under `dir`, as posix-ish relative paths, sorted (a top-level `node_modules` is not part of a preset). */
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
      if (rel === '' && entry.name === 'node_modules') continue
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
 * Whether two preset package directories are the same directory, byte for
 * byte.
 *
 * This is the whole claim the evaluation rests on: a capability face carries
 * no filesystem path, so the fingerprint taken against the deployment's copy
 * describes the scope's copy exactly when the two hold the same bytes.
 * @param a - one preset package directory.
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

/** Copy one preset package directory onto another, replacing whatever was there. */
function mirrorPresetTree(source: string, target: string): void {
  const files = presetTreeFiles(source)
  if (files === undefined) {
    throw new Error(`provision-dsh: preset package ${source} is not a plain tree of files`
      + ' (a symlink or a device node cannot be copied into a scope — an evaluation unit resolves neither)')
  }
  rmSync(target, { recursive: true, force: true })
  for (const name of files) {
    const destination = join(target, name)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(source, name), destination)
  }
}

/** A JSON object read off disk, or undefined. */
function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** The bundle patch files a package manifest declares (`dsh.bundle.patch`, a string or a list). */
function bundlePatchFiles(manifest: Record<string, unknown>): string[] {
  const dsh = manifest['dsh']
  if (typeof dsh !== 'object' || dsh === null) return []
  const bundle = (dsh as Record<string, unknown>)['bundle']
  if (typeof bundle !== 'object' || bundle === null) return []
  const patch = (bundle as Record<string, unknown>)['patch']
  if (typeof patch === 'string') return [patch]
  return Array.isArray(patch) ? patch.filter((item): item is string => typeof item === 'string') : []
}

/** The preset ids a bundle patch document declares through `@deepseek-ai/dsh-agent-preset` rows. */
function declaredPresetIds(text: string): string[] {
  let document: unknown
  try {
    document = yaml.load(text, { schema: EXPRESSION_SCHEMA })
  } catch {
    return []
  }
  if (!Array.isArray(document)) return []
  const ids: string[] = []
  const visit = (row: unknown): void => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return
    const record = row as Record<string, unknown>
    if (record['name'] !== PRESET_ROW_MODULE) return
    const config = record['config']
    if (typeof config !== 'object' || config === null) return
    const id = (config as Record<string, unknown>)['id']
    if (typeof id === 'string') ids.push(id)
  }
  for (const operation of document) {
    if (typeof operation !== 'object' || operation === null) continue
    const insert = (operation as Record<string, unknown>)['insert']
    if (Array.isArray(insert)) insert.forEach(visit)
    else visit(operation)
  }
  return ids
}

/** One installed bundle package that declares a preset. */
export interface DshPresetPackage {
  /** The package name (what the sub-profile manifest lists). */
  name: string
  /** The package directory, symlinks resolved. */
  dir: string
}

/**
 * Find the bundle package, among a profile's direct dependencies, whose
 * bundle patch declares preset `id`.
 *
 * This is how the 0.2.0 host itself learns the preset: a profile's direct
 * `dsh.bundle`-declaring dependency mounts its patch, and the patch's
 * `@deepseek-ai/dsh-agent-preset` row registers the id. Reading the same files
 * is what lets a scope copy exactly the package the evaluation instance's
 * capability catalog measures.
 * @param profileDir - the instance profile directory (holding `package.json`).
 * @param id - the preset id.
 * @returns the declaring package, or undefined when none (or more than one) declares it.
 */
export function findPresetPackage(profileDir: string, id: string): DshPresetPackage | undefined {
  const manifest = readJsonObject(join(profileDir, 'package.json'))
  if (manifest === undefined) return undefined
  const names = new Set<string>()
  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    const deps = manifest[field]
    if (typeof deps === 'object' && deps !== null) for (const name of Object.keys(deps)) names.add(name)
  }
  const found: DshPresetPackage[] = []
  for (const name of [...names].sort()) {
    if (!PACKAGE_NAME_RE.test(name)) continue
    let dir: string
    try {
      dir = realpathSync(join(profileDir, 'node_modules', ...name.split('/')))
    } catch {
      continue
    }
    const packageManifest = readJsonObject(join(dir, 'package.json'))
    if (packageManifest === undefined) continue
    const declares = bundlePatchFiles(packageManifest).some(file => {
      try {
        return declaredPresetIds(readFileSync(join(dir, file), 'utf8')).includes(id)
      } catch {
        return false
      }
    })
    if (declares) found.push({ name, dir })
  }
  return found.length === 1 ? found[0] : undefined
}

/**
 * Why a preset package directory cannot be copied into a scope, or undefined
 * when it can: it must name itself, declare its bundle patch, and the patch
 * must declare the preset without naming an absolute path.
 */
function presetPackageProblem(dir: string, id: string): string | undefined {
  const manifest = readJsonObject(join(dir, 'package.json'))
  const name = manifest?.['name']
  if (manifest === undefined || typeof name !== 'string' || !PACKAGE_NAME_RE.test(name)) {
    return `${dir} has no package.json naming the package`
  }
  const files = bundlePatchFiles(manifest)
  if (files.length === 0) return `${name} declares no dsh.bundle.patch`
  let declares = false
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(join(dir, file), 'utf8')
    } catch {
      return `${name} declares bundle patch ${file}, which is missing`
    }
    const offenders = compositionAbsolutePaths(text)
    if (offenders.length > 0) {
      return `${name}'s ${file} names absolute path(s) ${offenders.map(path => JSON.stringify(path)).join(', ')}`
        + ' — a preset that is copied into a scope and bind-mounted into a unit is read from three different directories,'
        + ' so an absolute path is wrong in at least two of them. Resolve the package\'s own directory through baseUrl instead:'
        + ` !!js "…dirname(createRequire(baseUrl).resolve('${name}/package.json'))…"`
    }
    if (declaredPresetIds(text).includes(id)) declares = true
  }
  return declares ? undefined : `${name} declares no ${PRESET_ROW_MODULE} row with id ${JSON.stringify(id)}`
}

/** What {@link snapshotScopePreset} did. */
export interface DshScopePresetSnapshot {
  /** The scope's copy of the preset package. */
  dir: string
  /** The package name the copy carries. */
  packageName: string
  /** Whether that copy is byte-for-byte the deployment's own. */
  matchesSource: boolean
  /** Whether this call wrote it. */
  copied: boolean
}

/**
 * Give one scope its own copy of a preset package, from the evaluation
 * instance's own installation of it.
 *
 * The copy is what makes a preset reachable on BOTH paths. The sub-profile
 * resolves the package through a relative link to
 * `<scope>/preset-packages/<id>`, which is one directory on the host and
 * inside an evaluation unit, because the unit binds the scope.
 *
 * `refresh` is the difference between provisioning a condition and healing a
 * scope. A deliberate provision re-syncs from the instance's copy, because
 * that is the moment a new lock is minted and an edited preset should be
 * picked up. Every other provisioning leaves an existing copy alone: nothing
 * may move the subject under a run — and a healing call whose instance no
 * longer carries the package keeps the copy, reporting `matchesSource: false`.
 * @param homeDir - the harness scoped home.
 * @param instanceProfileDir - the instance profile directory, or undefined when unknown.
 * @param id - the preset id.
 * @param options - `refresh` re-syncs an existing copy.
 * @returns where the copy is and whether it matches the source.
 * @throws when no copy can be made: no installed package declares the id, or it is not a usable preset package.
 */
export function snapshotScopePreset(
  homeDir: string,
  instanceProfileDir: string | undefined,
  id: string,
  options: { refresh?: boolean } = {},
): DshScopePresetSnapshot {
  if (!SUB_PROFILE_PRESET_ID_RE.test(id)) {
    throw new Error(`provision-dsh: preset id ${JSON.stringify(id)} must match ${String(SUB_PROFILE_PRESET_ID_RE)} (it is a directory name)`)
  }
  const dir = scopePresetPackageDir(homeDir, id)
  const copyName = (): string | undefined => {
    const name = readJsonObject(join(dir, 'package.json'))?.['name']
    return typeof name === 'string' && PACKAGE_NAME_RE.test(name) ? name : undefined
  }
  const source = instanceProfileDir === undefined ? undefined : findPresetPackage(instanceProfileDir, id)
  const existing = existsSync(dir) ? copyName() : undefined
  if (existing !== undefined && options.refresh !== true) {
    return { dir, packageName: existing, matchesSource: source !== undefined && presetTreesEqual(source.dir, dir), copied: false }
  }
  if (source === undefined) {
    throw new Error(`provision-dsh: no package installed in ${instanceProfileDir ?? 'this instance\'s profile'} declares preset ${JSON.stringify(id)}`
      + ` (an ${PRESET_ROW_MODULE} row in its dsh.bundle.patch) — add the preset package to the instance profile before a scope can compose it`)
  }
  const problem = presetPackageProblem(source.dir, id)
  if (problem !== undefined) throw new Error(`provision-dsh: preset ${JSON.stringify(id)}: ${problem}`)
  if (existing !== undefined && presetTreesEqual(source.dir, dir)) {
    return { dir, packageName: existing, matchesSource: true, copied: false }
  }
  mirrorPresetTree(source.dir, dir)
  return { dir, packageName: source.name, matchesSource: true, copied: true }
}

/** Per-scope inputs {@link provisionDshScope} takes. */
export interface DshScopeProvisionOptions {
  /**
   * The preset this scope composes. Present, it is authoritative: it is
   * persisted into the scope's own declaration and its copy is re-synced from
   * the instance's installation. Absent, the scope's declaration decides.
   */
  preset?: string
  /**
   * The evaluation instance's own profile directory, whose direct
   * dependencies are searched for the package declaring the preset.
   */
  instanceProfileDir?: string
}

/** What {@link provisionDshScope} left in the scope. */
export interface DshScopeProvisioned {
  /** The sub-profile directory. */
  profileDir: string
  /** The preset the sub-profile now composes, when it composes one. */
  preset?: string
  /** The scope's own copy of that preset package, when it keeps one. */
  presetSnapshot?: { matchesSource: boolean }
}

/**
 * Provision one scope: its own preset package copy, its declaration, and the
 * sub-profile that composes it.
 *
 * The preset resolves in one order, and the order is the decision: the
 * CALLER's explicit request, then the SCOPE's own declaration, then the
 * deployment's plugin config. The first is how a condition says which subject
 * this scope is; the second is how that survives a restart; the third is the
 * deployment-wide answer every scope had before either existed.
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
  let snapshot: DshScopePresetSnapshot | undefined
  if (declared !== undefined) {
    snapshot = snapshotScopePreset(homeDir, options.instanceProfileDir, declared, { refresh: requested !== undefined })
  }
  if (requested !== undefined) writeScopeSubProfile(homeDir, { preset: requested })
  const preset: DshSubProfilePreset | undefined = declared === undefined || snapshot === undefined
    ? config.preset
    : { id: declared, package: snapshot.packageName }
  const profileDir = provisionDshSubProfile(homeDir, { ...config, ...(preset === undefined ? {} : { preset }) })
  return {
    profileDir,
    ...(preset === undefined ? {} : { preset: preset.id }),
    ...(snapshot === undefined ? {} : { presetSnapshot: { matchesSource: snapshot.matchesSource } }),
  }
}
