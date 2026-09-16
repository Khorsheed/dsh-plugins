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
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
