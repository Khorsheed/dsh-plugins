#!/usr/bin/env node
/**
 * Plugin independence checker.
 *
 * Enforces the AGENTS.md "Package conventions" that make every plugin in this
 * monorepo install, run, and uninstall alone — so any subset can be composed
 * (the "整合包" story) without cross-interference:
 *
 *   1. self-mounting     every installable package declares `dsh.bundle.patch`,
 *                        the patch file exists and is listed in `files`
 *                        (family-internal row packages are exempt — see
 *                        NO_OWN_PATCH below)
 *   2. identity          cordis.patch.yml `name:` values are quoted and one
 *                        top-level row matches the package name; a declarative
 *                        preset bundle (`dsh.bundle.kind: preset-declarations`)
 *                        mounts ONLY `@deepseek-ai/dsh-agent-preset` rows with
 *                        `preset-<id>` loader ids instead of its own runtime
 *                        row; a family bundle (`dsh.bundle.kind: family`)
 *                        re-mounts ONLY the canonical rows of its declared
 *                        `dsh.bundle.members` and registers nothing of its own;
 *                        `src/invariant.ts`'s PACKAGE_NAME equals it;
 *                        browser halves build through the shared `clientBundle`
 *                        helper with the same id — never a hand-rolled bundle
 *   3. no foreign scope  package docs/patches never reference one of THIS
 *                        repo's packages under `@deepseek-ai/` (stale identity
 *                        from the pre-consolidation layout)
 *   4. cross-plugin deps source imports and package.json dependency edges onto
 *                        `@khorsheed/*` are limited to ALLOWED_EDGES (the
 *                        sanctioned local-agent core/companion family and the
 *                        source-plane kernel consumers); intra-repo specs
 *                        are always `workspace:*`
 *   5. inject discipline nothing injects a `@khorsheed/*` package; injecting a
 *                        community-provided service (`localAgent`, …) is
 *                        limited to the family that owns it — everyone else
 *                        probes with `ctx.get` and degrades
 *   6. publish metadata  non-private packages point `repository` at this
 *                        monorepo with the right `directory`, and carry
 *                        `dsh-plugin` in `keywords`
 *   7. skill attribution a runtime skill registration's `provider` literal is
 *                        the full package name (`@khorsheed/dsh-…`) — the
 *                        capability catalog's skill card shows it verbatim
 *
 * Run by hand (`pnpm check:plugins`); the vitest spec re-runs it against the
 * real tree so `pnpm test:scripts` keeps the tree conformant.
 *
 * Exit code 0 = clean; 1 = findings (each printed as `<path>: <kind> — detail`).
 * @module scripts/check-plugin-independence
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface Finding {
  readonly path: string
  readonly kind: string
  readonly detail: string
  /** `error` fails the check (default); `warn` reports without failing. */
  readonly severity?: 'error' | 'warn'
}

/**
 * How a package that deliberately does NOT self-mount is composed, declared in
 * its own manifest as `dsh.composition.component`. The package map reads this
 * instead of inferring intent, so a missing `dsh.bundle` is no longer ambiguous
 * between "deliberate family-internal row" and "forgot the patch".
 */
export const COMPOSITION_COMPONENTS: ReadonlyArray<string> = [
  'preset-composed-row',
  'provider-mounted-row',
  'sub-profile-patch',
  // Not a row at all: a SOURCE-PLANE library. It registers no slot, service,
  // locale or loader row and owns no bundle; consumers declare it as a
  // workspace dependency and import its `./src/*` directly, so each plugin's
  // tsdown client bundle inlines it (zero runtime coupling, nothing to
  // install alongside). Kept distinct from the row components above so
  // "no patch" cannot read as "a row some other patch mounts". Added
  // 2026-09-23 with `ui-content-preview` (proposal preview-kernel).
  'source-plane-library',
]

/**
 * Sanctioned `dsh.bundle.kind` values: self-mounting bundles whose patch rows
 * are not the package's own runtime row. Closed vocabulary, like
 * COMPOSITION_COMPONENTS — the manifest metadata decides, never an inference.
 *
 *   preset-declarations  every top-level row of the patch is a
 *                        `@deepseek-ai/dsh-agent-preset` declaration with a
 *                        `preset-<id>` loader id (host 0.1.7-rc.1's preset
 *                        mechanism). The identity triangle's own-row rule does
 *                        not apply: the bundle's rows are data interpreted by
 *                        the official preset plugin, so the check pins THAT
 *                        convention instead. Added 2026-09-24 with `presets`.
 *   family               a thin meta package (proposal
 *                        2026-09-24-family-bundles-and-collections) whose patch
 *                        re-mounts the canonical rows of its declared
 *                        `dsh.bundle.members` — minus each member's companion
 *                        composition rows (a `name` with a subpath beyond the
 *                        package, like `@khorsheed/dsh-game/agent`; those live
 *                        in a preset's grant list, never at a pack's profile
 *                        root) — the official "one bundle card, many rows"
 *                        shape. Members are real self-mounting
 *                        packages carried as npm dependencies (installing the
 *                        bundle brings the family along; `dsh plugin add`
 *                        reconciles only the profile's DIRECT dependencies, so
 *                        the members' own patches stay inert and no row mounts
 *                        twice). The bundle registers nothing itself: no own
 *                        runtime row, no client half, no service/tool/slot
 *                        registrations in src. Added 2026-09-24 with
 *                        `bundle-local-agent` / `bundle-conversation-toolbox`
 *                        (the latter retired 2026-10-24, folded into basic).
 *   mode                 a family bundle that additionally carries exactly ONE
 *                        `@deepseek-ai/dsh-agent-preset` row — the mode the
 *                        bundle installs (id `preset-<mode>`,
 *                        `dsh.bundle.mode` declares `<mode>`). Every rule of
 *                        `family` applies unchanged, plus two grant rules:
 *                        each subtracted companion row must be named (same id,
 *                        same name) by the preset row's composition, and every
 *                        `@khorsheed/*` module that composition names must
 *                        belong to a declared member. The preset row is the
 *                        bundle's own declaration (its name is the official
 *                        preset plugin, never a community self-mount, so row
 *                        ownership stays clean). Mode values are unique across
 *                        mode bundles, which keeps the preset row ids
 *                        collision-free. Added 2026-10-18 for the per-mode
 *                        packs (dsh-dev / dsh-writing / …).
 */
export const BUNDLE_KINDS: ReadonlyArray<string> = ['preset-declarations', 'family', 'mode']

/** Kinds that re-mount declared members' canonical rows verbatim (mode = family + one preset row). */
export const FAMILY_LIKE_KINDS: ReadonlyArray<string> = ['family', 'mode']

/** A mode bundle's preset id: the `dsh-`-prefixed community namespace. */
export const MODE_ID_RE = /^dsh-[a-z0-9-]+$/

/** The official plugin a preset-declarations bundle's rows are interpreted by. */
export const AGENT_PRESET_ROW_NAME = '@deepseek-ai/dsh-agent-preset'

/** Loader row id convention of one preset declaration (SKILL: `preset-<id>`). */
export const PRESET_ROW_ID_RE = /^preset-[a-z0-9-]+$/

/**
 * Registration surface a `family` bundle's sources must never touch: the kind
 * is pure composition (its patch re-mounts member rows), so an apply entry, an
 * inject declaration, or any service/tool/slot/command registration would be
 * logic the meta package promised not to carry.
 */
export const FAMILY_REGISTRATION_RE = /ctx\.tools\.register|ctx\.commands\.register|ctx\.slots\.(?:register|inject)|ctx\.provide\(|ctx\.set\(|export\s+const\s+inject|export\s+function\s+apply|export\s+default/

/**
 * The same set as `COMPOSITION_COMPONENTS`, keyed by directory, kept as a
 * CROSS-CHECK rather than the source of truth: the manifest metadata decides,
 * and this list must agree with it (the historical Agent Notes cite the list,
 * so it is retired by removing entries as those notes stop being referenced,
 * not by letting the two drift).
 *
 * Packages deliberately NOT self-mounting: family-internal row packages whose
 * composition is mounted on their behalf — the
 * local-agent-dsh provisioner copies the headless patch into the provisioned
 * sub-profile's own patch layer (a `dsh.bundle` declaration there would hand
 * the host's `dsh plugin` reconcile a mount trigger for a sub-dsh-only
 * composition; see AGENTS.md "Package conventions" and the two packages'
 * README "Install" sections). The preset-composed companion tool rows used to
 * be the other member of this list; the last of them (typesafe-tool) folded
 * into its core package's `./tool` composition entry at the host-021 wave, so
 * no `preset-composed-row` package remains in the tree.
 */
export const NO_OWN_PATCH: ReadonlyArray<string> = [
  // local-agent-tool-subagent used to be this shape (provider patches mounted
  // its config-bearing rows); the 2026-09-30 family fold moved the tool into
  // each provider's own `./tool` composition entry and the factory into the
  // core's `./tool-factory` export, then retired the package.
  'local-agent-dsh-headless',
  // The preset-composed companion tool rows were this shape too, each folded
  // back into its core package as the `./tool` composition entry (the canvas
  // ./agent precedent): worktrees-tool and room-tool at worktrees 0.3.0 /
  // room 0.2.0; mission-tool / datasets-tool / eval-tool at the
  // evaluation-family fold (T88, 2026-10-01); typesafe-tool at the host-021
  // wave (2026-10-18). No preset-composed-row package remains in the tree.
  // ui-content-preview is NOT a row and NOT a companion: it is the
  // source-plane library whose `dsh.composition.component` is
  // 'source-plane-library'. Listed here because the checker pairs the
  // manifest metadata with this historical list; there is nothing for any
  // patch to mount on its behalf.
  'ui-content-preview',
  // ui-panel-kit is the same shape: the source-plane panel kit (type tokens
  // plus the shared compact controls), inlined into each consuming plugin's
  // own client bundle (proposal panel-responsive-spec, 2026-10-06).
  'ui-panel-kit',
]

/**
 * Sanctioned cross-package edges (AGENTS.md: the local-agent core/companion
 * family, the *-tool core/companion pairs, and the source-plane kernel
 * consumers). Keyed by package directory; values are the allowed
 * `@khorsheed/*` targets. Any new cross-package need must follow the same
 * declare-and-degrade pattern and be added here deliberately.
 */
export const ALLOWED_EDGES: Readonly<Record<string, ReadonlyArray<string>>> = {
  // The delegation tool folded into each provider as its `./tool` composition
  // entry at the 2026-09-30 family fold (the retired shared
  // local-agent-tool-subagent package); the factory lives in the core's
  // `./tool-factory` export, so the provider → core edge is the only one left.
  'local-agent-claude-code': ['@khorsheed/dsh-local-agent'],
  'local-agent-codex': ['@khorsheed/dsh-local-agent'],
  'local-agent-kimi': ['@khorsheed/dsh-local-agent'],
  'local-agent-dsh': [
    '@khorsheed/dsh-local-agent',
    '@khorsheed/dsh-local-agent-dsh-headless',
  ],
  // bundle-local-agent (family meta package): edges onto its declared
  // `dsh.bundle.members` are sanctioned by the manifest itself; this entry
  // covers only the family's DEPS-ONLY library it also installs (card-less,
  // no patch rows of its own beyond what the members' canonical rows name).
  'bundle-local-agent': ['@khorsheed/dsh-local-agent-dsh-headless'],
  // dev (the dsh-dev mode bundle) installs the same deps-only library for the
  // same reason — its local-agent-dsh member provisions the sub-dsh through it.
  'dev': ['@khorsheed/dsh-local-agent-dsh-headless'],
  // bundle-eval (the dsh-eval mode bundle) takes the local-agent family along
  // for eval's service-level delegation (the run / provision verbs go through
  // the localAgent facade) — the same deps-only library rides with it.
  'bundle-eval': ['@khorsheed/dsh-local-agent-dsh-headless'],
  // gamedev / video (mode bundles) carry the local-agent family and the room
  // since 2026-10-24 — the same deps-only library rides with them.
  'gamedev': ['@khorsheed/dsh-local-agent-dsh-headless'],
  'video': ['@khorsheed/dsh-local-agent-dsh-headless'],
  // The worktrees and room tool rows folded back into their core packages
  // (worktrees 0.3.0, room 0.2.0) as the `./tool` composition entry (the
  // canvas ./agent pattern) — no cross-package edge remains. Each core used
  // to carry a reverse DATA mention of its companion (the preset-visibility
  // probe's row constant); the constant now names the package's own subpath,
  // so no dsh.references entry is needed.
  // The mission / datasets / eval core/companion pairs (M4'③) folded the same
  // way at the evaluation-family fold (T88, 2026-10-01): no edge remains.
  // canvas → inline-html-render: the card detail renders HTML cards through
  // inline-html-render's SOURCE-plane helpers (buildCardSrcDoc/attachBridge),
  // bundled by tsdown — a compile-time edge with zero runtime coupling (the
  // renderer package need not be installed for canvas to work).
  // canvas also takes ui-panel-kit (panel-responsive-spec P3: the panel root,
  // the face tabs and the chip row) — the same inlined, zero-runtime edge.
  'canvas': ['@khorsheed/dsh-inline-html-render', '@khorsheed/dsh-client-ui-panel-kit'],
  // local-files / worktrees → ui-content-preview: the two file surfaces render
  // through ONE shared content pane (proposal preview-kernel). Same shape as
  // the canvas edge above — a compile-time SOURCE-plane import
  // (`.../src/client/*`) that tsdown inlines into each plugin's own client
  // bundle, so the kernel needs no runtime install and the two plugins stay
  // independently installable and uninstallable.
  // Both (and file-preview below) also take ui-panel-kit, the source-plane
  // panel kit (panel-responsive-spec P1: AdaptiveSplit, PanelRoot, and the
  // content pane's PanelHeader/UnderlineTabs) — the same inlined, zero-runtime
  // edge.
  'local-files': ['@khorsheed/dsh-client-ui-content-preview', '@khorsheed/dsh-client-ui-panel-kit'],
  'worktrees': ['@khorsheed/dsh-client-ui-content-preview', '@khorsheed/dsh-client-ui-panel-kit'],
  // file-preview → ui-content-preview: same source-plane kernel edge (the
  // ui-file-preview client half folded into the file-preview package at
  // 0.4.0, bringing its kernel import along).
  'file-preview': ['@khorsheed/dsh-client-ui-content-preview', '@khorsheed/dsh-client-ui-panel-kit'],
  // ui-content-preview → ui-panel-kit: one source-plane library reading
  // another (the pane's title bar and tab row); both are inlined into each
  // consuming plugin's bundle, so nothing is installed at runtime.
  'ui-content-preview': ['@khorsheed/dsh-client-ui-panel-kit'],
  // dsh-reader → ui-panel-kit: the inspiration space's compact header, chip
  // row and panel root (panel-responsive-spec P2) — the same inlined,
  // zero-runtime source-plane edge as the file surfaces above.
  'dsh-reader': ['@khorsheed/dsh-client-ui-panel-kit'],
  // canvas-novel → ui-panel-kit: the chapter book's compact header and the
  // story view's tabs (panel-responsive-spec P3) — the same inlined edge.
  'canvas-novel': ['@khorsheed/dsh-client-ui-panel-kit'],
  // library → ui-panel-kit: the learning sidebar's panel root, header, tabs,
  // chip row and list rows — the same inlined, zero-runtime source-plane edge.
  'library': ['@khorsheed/dsh-client-ui-panel-kit'],
  // context-lens → ui-panel-kit: the request panel's root, header, tabs,
  // chip row and request rows (the panel lands with the client milestone) —
  // the same inlined, zero-runtime source-plane edge.
  'context-lens': ['@khorsheed/dsh-client-ui-panel-kit'],
  // request-inspector → ui-panel-kit: the request panel's root, header, tabs,
  // chip row and request rows (the panel lands with the client milestone) —
  // the same inlined, zero-runtime source-plane edge.
  'request-inspector': ['@khorsheed/dsh-client-ui-panel-kit'],
  // video-studio → ui-panel-kit: the 剪辑 panel's root, header, tabs and chip
  // rows — the same inlined, zero-runtime source-plane edge.
  'video-studio': ['@khorsheed/dsh-client-ui-panel-kit'],
  // game → ui-panel-kit: the game tab's panel root, header, tabs and rows
  // (panel-design convention for every new panel).
  'game': ['@khorsheed/dsh-client-ui-panel-kit'],
  // room consumes the local-agent delegation facade as an OPTIONAL capability:
  // type-only imports, an optional peer dep, a runtime probe, and tested
  // degradation when the family is absent (the room works with the main agent
  // as its only member). Sanctioned per the declare-and-degrade pattern.
  'room': ['@khorsheed/dsh-local-agent'],
}

/**
 * Community-provided cordis services and which package directories may inject
 * them. Anything not listed is assumed to be an official host service.
 */
export const COMMUNITY_SERVICE_INJECTORS: Readonly<Record<string, RegExp>> = {
  localAgent: /^local-agent/,
  localAgentDshHeadlessStartup: /^local-agent-dsh-headless$/,
  // `shortcuts` had one entry (/^ui-shortcuts$/) until the package retired
  // 2026-10-22: the host ships the official shortcuts service (resident in the
  // web-app bundle) under the same key since 0.1.7-rc.2, so the name is an
  // official service now and needs no community-owner row.
  // The preset-composed tool rows inject their owning core: a one-shot
  // apply-time probe lost the rc.1 boot-order race (the standing scope mounts
  // before the profile's later bundle rows provide the core), so the row
  // pends on the core instead (2026-09-27 3080 incident). The worktrees and
  // room tool rows folded back into their core packages (worktrees 0.3.0,
  // room 0.2.0) as the `./tool` entry, the datasets / eval / mission tool
  // rows at the evaluation-family fold (T88), and the typesafe tool row at
  // the host-021 wave, so the core package itself is the allowed injector.
  typesafe: /^typesafe$/,
  // Renamed from `worktrees` at host 0.2.1: the official experimental
  // `worktree` package provides `ctx.worktrees`, so this package's core moved
  // to `worktreesCore` (a duplicate provide fails the boot).
  worktreesCore: /^worktrees$/,
  room: /^room$/,
  datasets: /^datasets$/,
  dshEval: /^eval$/,
  mission: /^mission$/,
  // library's `./tool` composition entry injects its own core service (the
  // evaluation-family fold pattern): the preset's standing scope mounts before
  // the profile's bundle rows provide `library`, so the row pends on the core.
  library: /^library$/,
  // video-studio's `./tool` entry injects its own core service (same pattern).
  videoStudio: /^video-studio$/,
}

const MONOREPO_URL = 'git+https://github.com/Khorsheed/dsh-plugins.git'

const CROSS_IMPORT_RE = /(?:from|import|require(?:\.resolve)?)\s*\(?\s*['"](@khorsheed\/[a-z0-9-]+)/g
const INJECT_RE = /export const inject = \[([^\]]*)\]/g

interface Pkg {
  readonly dir: string
  readonly path: string
  readonly json: {
    readonly name: string
    readonly private?: boolean
    readonly files?: readonly string[]
    readonly keywords?: readonly string[]
    readonly repository?: { readonly url?: string; readonly directory?: string }
    readonly dsh?: {
      readonly bundle?: { readonly patch?: string; readonly kind?: string; readonly members?: readonly string[]; readonly mode?: string }
      readonly client?: { readonly inject?: readonly string[] }
      /** Sibling names a package mentions as DATA (never as a dependency edge). */
      readonly references?: readonly string[]
      /** How a package that does not self-mount is composed. */
      readonly composition?: { readonly component?: string }
    }
    readonly dependencies?: Record<string, string>
    readonly devDependencies?: Record<string, string>
    readonly peerDependencies?: Record<string, string>
  }
}

function listPackages(packagesRoot: string): Pkg[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packagesRoot, e.name, 'package.json')))
    .map((e) => ({
      dir: e.name,
      path: join(packagesRoot, e.name),
      json: JSON.parse(readFileSync(join(packagesRoot, e.name, 'package.json'), 'utf8')),
    }))
}

function listSources(dir: string): string[] {
  const src = join(dir, 'src')
  if (!existsSync(src)) return []
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
  }
  walk(src)
  return out
}

/** `@khorsheed/<pkg>` specifiers a source text imports (self-references excluded by caller). */
export function findCrossImports(source: string): string[] {
  const out = new Set<string>()
  const re = new RegExp(CROSS_IMPORT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    out.add(m[1])
  }
  return [...out]
}

/**
 * Bare `provider: '<literal>'` values on runtime skill registrations — only
 * meaningful in files that register runtime skills (gated on `source:
 * 'runtime'`, a skill-registration marker no other code in the tree uses).
 * The capability catalog's skill card shows `provider` verbatim as the source
 * label, so a bare word reads as another namespace next to every other card's
 * `@khorsheed/dsh-…` (2026-10-18: ankh-guard and inline-html-render shipped
 * bare words). A `PACKAGE_NAME` reference needs no literal and never matches.
 */
export function findBareSkillProviders(source: string): string[] {
  if (!source.includes(`source: 'runtime'`)) return []
  const out = new Set<string>()
  const re = /provider:\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m[1]!.startsWith('@khorsheed/dsh-')) continue
    out.add(m[1]!)
  }
  return [...out]
}

/**
 * Source text with comments removed. A sibling name in prose is documentation,
 * not a data reference the shipped artifact carries.
 */
export function stripCodeComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/** Service/package names listed in `export const inject = [...]` blocks. */
export function findInjects(source: string): string[] {
  const out: string[] = []
  const re = new RegExp(INJECT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^['"]|['"]$/g, '')
      if (name) out.push(name)
    }
  }
  return out
}

/** `name:` values in a bundle patch, plus whether each was quoted. */
export function parsePatchNames(patch: string): Array<{ readonly name: string; readonly quoted: boolean }> {
  const out: Array<{ name: string; quoted: boolean }> = []
  for (const line of patch.split(/\r?\n/)) {
    const m = /^\s*name:\s*(\S.*)$/.exec(line)
    if (!m) continue
    const raw = m[1].trim()
    const quoted = /^['"].*['"]$/.test(raw)
    out.push({ name: raw.replace(/^['"]|['"]$/g, ''), quoted })
  }
  return out
}

/** Bare service names in inline `inject: [a, b]` rows of a bundle patch. */
export function parsePatchInjects(patch: string): string[] {
  const out: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    const m = /^\s*inject:\s*\[([^\]]*)\]/.exec(line)
    if (!m) continue
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^['"]|['"]$/g, '')
      if (name) out.push(name)
    }
  }
  return out
}

/** One loader row a patch mounts at the profile root (fields it declares directly). */
export interface PatchRow {
  readonly id?: string
  readonly name?: string
}

/**
 * A top-level patch row plus its normalized YAML block: the item's own lines
 * with comment and blank lines dropped, trailing whitespace trimmed, and
 * single-quoted whole scalars requoted double (YAML-equivalent — the parity
 * specs' convention), so a cross-file verbatim comparison does not fail on a
 * copy's comment placement or quote style.
 */
export interface PatchRowBlock extends PatchRow {
  readonly block: string
}

/** Normalize one content line for verbatim block comparison. */
function normalizeBlockLine(line: string): string {
  return line.trimEnd().replace(/^(.*?:\s*)'([^']*)'$/, '$1"$2"')
}

/**
 * The loader rows a patch mounts at the profile root: the direct items of each
 * top-level `- insert:` list, plus bare top-level `- id:` entries (the override
 * form). Content nested inside a row's `config` — an agent preset's
 * `config.plugins` list is the case this exists for — composes in that row's
 * own scope, not the profile root, so row-id uniqueness, patch row ownership
 * and package identity all read only this top level.
 *
 * Line- and indent-based (the repo ships no YAML parser): a row's fields are
 * read at the indent its first field establishes, so deeper `config` content
 * never leaks into the row, and every patch shape already in the tree
 * (insert lists, bare overrides, comment/blank padding) parses the same.
 */
export function parseTopLevelPatchRowBlocks(patch: string): PatchRowBlock[] {
  const lines = patch.split(/\r?\n/)
  const isContent = (line: string): boolean => line.trim() !== '' && !line.trimStart().startsWith('#')
  const indentOf = (line: string): number => line.length - line.trimStart().length
  const unquote = (raw: string): string => raw.trim().replace(/^['"]|['"]$/g, '')

  /** Read the id/name fields of the row whose item line is `start`. */
  const readRow = (start: number, itemIndent: number): { row: PatchRowBlock; end: number } => {
    const row: { id?: string; name?: string } = {}
    const assign = (key: string, raw: string): void => {
      if (key === 'id') row.id = unquote(raw)
      else row.name = unquote(raw)
    }
    const onItemLine = /^\s*-\s+(id|name):\s*(\S.*)$/.exec(lines[start]!)
    if (onItemLine !== null) assign(onItemLine[1]!, onItemLine[2]!)
    let fieldIndent: number | null = null
    let j = start + 1
    while (j < lines.length) {
      const line = lines[j]!
      if (!isContent(line)) { j++; continue }
      const indent = indentOf(line)
      if (indent <= itemIndent) break
      if (/^\s*-\s/.test(line)) break // a nested list begins — the row's own fields are done
      if (fieldIndent === null) fieldIndent = indent
      if (indent === fieldIndent) {
        const field = /^\s*(id|name):\s*(\S.*)$/.exec(line)
        if (field !== null) assign(field[1]!, field[2]!)
      }
      j++
    }
    const block = lines.slice(start, j).filter(isContent).map(normalizeBlockLine).join('\n')
    return { row: { ...row, block }, end: j }
  }

  const rows: PatchRowBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!isContent(line)) { i++; continue }
    const item = /^(\s*)- (.+)$/.exec(line)
    if (item === null) { i++; continue }
    const indent = item[1]!.length
    if (/^insert:\s*$/.test(item[2]!)) {
      // The rows of an insert block are its direct list items: the first
      // content line deeper than `- insert:` sets their indent.
      let j = i + 1
      let rowIndent: number | null = null
      while (j < lines.length) {
        const nested = lines[j]!
        if (!isContent(nested)) { j++; continue }
        const nestedIndent = indentOf(nested)
        if (nestedIndent <= indent) break
        if (rowIndent === null) {
          if (!/^\s*-\s/.test(nested)) break
          rowIndent = nestedIndent
        }
        if (nestedIndent === rowIndent && /^\s*-\s/.test(nested)) {
          const { row, end } = readRow(j, rowIndent)
          if (row.id !== undefined || row.name !== undefined) rows.push(row)
          j = end
          continue
        }
        j++
      }
      i = j
      continue
    }
    const { row, end } = readRow(i, indent)
    if (row.id !== undefined || row.name !== undefined) rows.push(row)
    i = end
  }
  return rows
}

/** The same rows without their YAML blocks (the long-standing check surface). */
export function parseTopLevelPatchRows(patch: string): PatchRow[] {
  return parseTopLevelPatchRowBlocks(patch).map(({ id, name }) => ({ id, name }))
}

/**
 * A companion composition row: its `name` carries a subpath beyond the package
 * (`@khorsheed/dsh-game/agent`, `@khorsheed/dsh-canvas/agent`). Such an entry
 * belongs to an agent preset's grant list — a pack patch never mounts it at
 * the profile root (the member's own patch stays inert under the bundle, and
 * under host 0.2.x a preset session's scoped copy shadows the global row).
 */
export const COMPANION_ROW_NAME_RE = /^@khorsheed\/[^/]+\/.+/

export function isCompanionRow(row: PatchRow): boolean {
  return row.name !== undefined && COMPANION_ROW_NAME_RE.test(row.name)
}

/** The package name part of a `@khorsheed/…` module specifier (subpath dropped). */
export function packageNameOf(name: string): string {
  return name.split('/').slice(0, 2).join('/')
}

/**
 * The (id, name) pairs of every list item under a preset row's
 * `config.plugins` — the grant list a mode bundle's preset row declares.
 * Line- and indent-based like parseTopLevelPatchRowBlocks; items nested inside
 * `cordis:group` rows are composition too, so depth is not restricted.
 */
export function parsePresetGrantRows(patch: string, presetRowId: string): PatchRow[] {
  const lines = patch.split(/\r?\n/)
  const isContent = (line: string): boolean => line.trim() !== '' && !line.trimStart().startsWith('#')
  const indentOf = (line: string): number => line.length - line.trimStart().length
  const unquote = (raw: string): string => raw.trim().replace(/^['"]|['"]$/g, '')

  // Locate the preset row's own top-level item line.
  let start = -1
  for (let idx = 0; idx < lines.length; idx++) {
    const m = /^\s*-\s+id:\s*(\S+)\s*$/.exec(lines[idx]!)
    if (m !== null && m[1] === presetRowId) { start = idx; break }
  }
  if (start === -1) return []
  const itemIndent = indentOf(lines[start]!)
  let end = lines.length
  for (let j = start + 1; j < lines.length; j++) {
    if (!isContent(lines[j]!)) continue
    if (indentOf(lines[j]!) <= itemIndent) { end = j; break }
  }
  let pluginsIdx = -1
  for (let j = start + 1; j < end; j++) {
    if (/^\s+plugins:\s*$/.test(lines[j]!)) { pluginsIdx = j; break }
  }
  if (pluginsIdx === -1) return []
  const pluginsIndent = indentOf(lines[pluginsIdx]!)

  const rows: PatchRow[] = []
  for (let j = pluginsIdx + 1; j < end; j++) {
    const line = lines[j]!
    if (!isContent(line)) continue
    if (indentOf(line) <= pluginsIndent) break
    const m = /^(\s*)-\s+(id|name):\s*(\S.*)$/.exec(line)
    if (m === null) continue
    const row: { id?: string; name?: string } = {}
    const assign = (key: string, raw: string): void => {
      if (key === 'id') row.id = unquote(raw)
      else row.name = unquote(raw)
    }
    assign(m[2]!, m[3]!)
    const itemInd = m[1]!.length
    let fieldIndent: number | null = null
    for (let k = j + 1; k < end; k++) {
      const nested = lines[k]!
      if (!isContent(nested)) continue
      const indent = indentOf(nested)
      if (indent <= itemInd) break
      if (/^\s*-\s/.test(nested)) break
      if (fieldIndent === null) fieldIndent = indent
      if (indent === fieldIndent) {
        const field = /^\s*(id|name):\s*(\S.*)$/.exec(nested)
        if (field !== null) assign(field[1]!, field[2]!)
      }
    }
    if (row.id !== undefined || row.name !== undefined) rows.push(row)
  }
  return rows
}

export function checkInjectName(dir: string, name: string): string | null {
  if (name.startsWith('@khorsheed/')) {
    return `injects community package ${name} — probe with ctx.get and degrade, or use the sanctioned family pattern`
  }
  const owner = COMMUNITY_SERVICE_INJECTORS[name]
  if (owner && !owner.test(dir)) {
    return `injects community service '${name}' outside its owning family — probe with ctx.get and degrade instead`
  }
  return null
}

export function isAllowedEdge(dir: string, target: string): boolean {
  return (ALLOWED_EDGES[dir] ?? []).includes(target)
}

export function scanPackage(pkg: Pkg, allNames: ReadonlyArray<string>): Finding[] {
  const findings: Finding[] = []
  const { dir, path, json } = pkg
  const add = (file: string, kind: string, detail: string): void => {
    findings.push({ path: join(path, file), kind, detail })
  }

  // 1. self-mounting. A package that does not self-mount must say HOW it is
  // composed (`dsh.composition.component`) — that manifest field, not a central
  // allowlist, is what the package map and this checker read, so a future
  // companion row cannot be mistaken for a plugin someone forgot to give a patch.
  const patchRel = json.dsh?.bundle?.patch
  const component = json.dsh?.composition?.component
  if (!patchRel) {
    if (component === undefined) {
      add('package.json', 'self-mounting', 'no dsh.bundle.patch and no dsh.composition.component — declare how the package is composed')
    }
  } else if (component !== undefined) {
    add('package.json', 'composition component', 'declares dsh.composition.component and also self-mounts (dsh.bundle.patch) — pick one')
  } else {
    const patchPath = join(path, patchRel)
    if (!existsSync(patchPath)) {
      add('package.json', 'self-mounting', `dsh.bundle.patch ${patchRel} does not exist`)
    }
    if (!(json.files ?? []).some((f) => f === patchRel || f === patchRel.replace(/^\.\//, ''))) {
      add('package.json', 'self-mounting', `dsh.bundle.patch ${patchRel} is not listed in files — the published tarball would not self-mount`)
    }

    // Display metadata. The host's plugin card reads locale/<lang>.json
    // meta.title/meta.description, discovered through the en.json anchor
    // (deepseek-harness app-boot package-meta.ts); with no locale directory the
    // card falls back to the raw package name — the canvas-novel/game listing
    // bug fixed on 2026-10-12. A self-mounting package therefore ships BOTH
    // locale files with BOTH meta fields, the ./locale/*.json export the host
    // resolver needs, and the files entry that puts them in the tarball.
    for (const lang of ['en', 'zh']) {
      const localeRel = `locale/${lang}.json`
      const localePath = join(path, localeRel)
      if (!existsSync(localePath)) {
        add(localeRel, 'display metadata', 'missing — the plugin card falls back to the raw package name without locale/<lang>.json meta')
        continue
      }
      let meta: unknown
      try {
        meta = (JSON.parse(readFileSync(localePath, 'utf8')) as { meta?: unknown }).meta
      } catch {
        add(localeRel, 'display metadata', 'does not parse as JSON')
        continue
      }
      const fields = (typeof meta === 'object' && meta !== null ? meta : {}) as Record<string, unknown>
      for (const field of ['title', 'description']) {
        if (typeof fields[field] !== 'string' || (fields[field] as string).trim() === '') {
          add(localeRel, 'display metadata', `meta.${field} must be a non-empty string — the plugin card reads it`)
        }
      }
    }
    if (!JSON.stringify(json.exports ?? {}).includes('./locale/')) {
      add('package.json', 'display metadata', 'exports lacks ./locale/*.json — the host resolves locale files through the package specifier')
    }
    if (!(json.files ?? []).some((f) => f.replace(/^\.\//, '') === 'locale/*.json')) {
      add('package.json', 'display metadata', 'files lacks locale/*.json — the published tarball would carry no card metadata')
    }
  }

  // 2. identity. Quoting applies to every `name:` line at any depth (nested
  // preset rows are YAML too); the own-row rule reads TOP-LEVEL rows only — a
  // preset-declarations bundle mounts no runtime row of its own, so the kind
  // replaces that rule with the preset-row convention, mechanically pinned.
  // A family bundle likewise mounts no own row: the cross-package scan pins
  // each of its patch rows to the canonical rows of its declared members.
  const bundleKind = json.dsh?.bundle?.kind
  if (bundleKind !== undefined && !BUNDLE_KINDS.includes(bundleKind)) {
    add('package.json', 'bundle kind', `dsh.bundle.kind "${bundleKind}" is not one of ${BUNDLE_KINDS.join(' / ')}`)
  }
  const familyLike = bundleKind !== undefined && FAMILY_LIKE_KINDS.includes(bundleKind)
  const familyMembers = familyLike ? (json.dsh?.bundle?.members ?? []) : []
  const isFamilyMember = (name: string): boolean => familyMembers.includes(name)
  const bundleMode = json.dsh?.bundle?.mode
  if (bundleKind === 'mode') {
    if (bundleMode === undefined || !MODE_ID_RE.test(bundleMode)) {
      add('package.json', 'bundle kind', `dsh.bundle.kind mode requires dsh.bundle.mode matching ${MODE_ID_RE} (the preset id it carries)`)
    }
  } else if (bundleMode !== undefined) {
    add('package.json', 'bundle kind', 'dsh.bundle.mode is declared but the kind is not mode — only mode bundles carry a preset row')
  }
  if (familyLike) {
    const bundleLabel = bundleKind === 'mode' ? 'mode bundle' : 'family bundle'
    const members = json.dsh?.bundle?.members
    if (members === undefined || members.length === 0) {
      add('package.json', bundleLabel, `dsh.bundle.kind ${bundleKind} requires a non-empty dsh.bundle.members list`)
    } else {
      if (members.includes(json.name)) {
        add('package.json', bundleLabel, 'dsh.bundle.members names the bundle itself')
      }
      for (const member of members) {
        if (!allNames.includes(member)) {
          add('package.json', bundleLabel, `dsh.bundle.members names ${member}, which is not a package in this repo`)
        }
        if (json.dependencies?.[member] === undefined) {
          add('package.json', bundleLabel, `member ${member} is not in dependencies — installing the bundle must bring the whole family along`)
        }
        if (!(json.dsh?.references ?? []).includes(member)) {
          add('package.json', bundleLabel, `member ${member} is not registered in dsh.references — the family roster is data every pack-time and catalog check reads`)
        }
      }
    }
    if (json.dsh?.client) {
      add('package.json', bundleLabel, 'a family bundle is pure composition — it declares no dsh.client browser half')
    }
    for (const src of listSources(path)) {
      const text = stripCodeComments(readFileSync(src, 'utf8'))
      const hit = FAMILY_REGISTRATION_RE.exec(text)
      if (hit !== null) {
        add(src.slice(path.length + 1), bundleLabel, `registers runtime surface (${hit[0]}) — a family bundle is pure composition: no services, tools, slots, commands, or apply entry of its own`)
      }
    }
  }
  if (patchRel && existsSync(join(path, patchRel))) {
    const patch = readFileSync(join(path, patchRel), 'utf8')
    const names = parsePatchNames(patch)
    for (const n of names) {
      if (!n.quoted) add(patchRel, 'identity', `name: ${n.name} is unquoted (@ is YAML-reserved)`)
    }
    const rows = parseTopLevelPatchRows(patch)
    if (bundleKind === 'preset-declarations') {
      if (rows.length === 0) {
        add(patchRel, 'identity', 'declares dsh.bundle.kind preset-declarations but mounts no rows')
      }
      for (const row of rows) {
        if (row.name !== AGENT_PRESET_ROW_NAME) {
          add(patchRel, 'identity', `preset-declarations row ${row.id ?? '(no id)'} is named ${row.name ?? '(no name)'} — the kind mounts only ${AGENT_PRESET_ROW_NAME} declarations`)
        } else if (row.id === undefined || !PRESET_ROW_ID_RE.test(row.id)) {
          add(patchRel, 'identity', `agent-preset row id ${row.id ?? '(missing)'} does not match preset-<id> — the loader row id convention`)
        }
      }
    } else if (familyLike) {
      // The row whitelist itself is a TREE-level check: the exact allowlist is
      // the union of the members' canonical patch rows minus their companion
      // composition rows, which this per-package scan cannot see. Here only
      // the own-row rule is replaced. A mode bundle additionally pins its
      // single preset row here (the membership half is tree-level like the
      // family's).
      if (rows.length === 0) {
        add(patchRel, 'identity', `declares dsh.bundle.kind ${bundleKind} but mounts no rows`)
      }
      if (bundleKind === 'mode' && bundleMode !== undefined) {
        const presetRows = rows.filter((row) => row.name === AGENT_PRESET_ROW_NAME)
        const wantId = `preset-${bundleMode}`
        if (presetRows.length !== 1 || presetRows[0]!.id !== wantId) {
          add(patchRel, 'identity', `a mode bundle mounts exactly one ${AGENT_PRESET_ROW_NAME} row with id ${wantId} — found ${presetRows.length} preset row(s)${presetRows.length > 0 ? `, first id ${presetRows[0]!.id ?? '(none)'}` : ''}`)
        }
      }
    } else if (!NO_OWN_PATCH.includes(dir) && !rows.some((r) => r.name === json.name)) {
      add(patchRel, 'identity', `no row named ${json.name} — patch id, invariant PACKAGE_NAME and tsdown id must move together`)
    }
    for (const svc of parsePatchInjects(patch)) {
      const why = checkInjectName(dir, svc)
      if (why) add(patchRel, 'inject', why)
    }
  }
  const invariantPath = join(path, 'src/invariant.ts')
  if (existsSync(invariantPath)) {
    const text = readFileSync(invariantPath, 'utf8')
    if (!text.includes(`'${json.name}'`) && !text.includes(`"${json.name}"`)) {
      add('src/invariant.ts', 'identity', `PACKAGE_NAME does not equal the package name ${json.name}`)
    }
  }
  if (json.dsh?.client) {
    const tsdownPath = join(path, 'tsdown.config.ts')
    const tsdown = existsSync(tsdownPath) ? readFileSync(tsdownPath, 'utf8') : ''
    const m = /clientBundle\(\s*['"]([^'"]+)['"]/.exec(tsdown)
    if (!m) {
      add('tsdown.config.ts', 'identity', 'browser half must build through the shared clientBundle helper — never hand-roll a client bundle')
    } else if (m[1] !== json.name) {
      add('tsdown.config.ts', 'identity', `clientBundle id ${m[1]} does not equal the package name ${json.name}`)
    }
    for (const svc of json.dsh.client.inject ?? []) {
      const why = checkInjectName(dir, svc)
      if (why) add('package.json', 'inject', why)
    }
  }

  // 3./4. cross-plugin imports and dependency edges
  for (const src of listSources(path)) {
    const text = readFileSync(src, 'utf8')
    for (const target of findCrossImports(text)) {
      if (target === json.name) continue
      if (!allNames.includes(target)) continue // not one of ours — nothing to police
      if (!isAllowedEdge(dir, target)) {
        add(src.slice(path.length + 1), 'cross-plugin import', `imports ${target} — no inter-plugin dependencies outside the sanctioned pairs`)
      }
    }
    for (const svc of findInjects(text)) {
      const why = checkInjectName(dir, svc)
      if (why) add(src.slice(path.length + 1), 'inject', why)
    }
    for (const provider of findBareSkillProviders(text)) {
      add(src.slice(path.length + 1), 'skill attribution', `runtime skill provider '${provider}' — the catalog shows it verbatim; use the full package name (@khorsheed/dsh-…)`)
    }
  }
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    for (const [name, spec] of Object.entries(json[field] ?? {})) {
      if (!name.startsWith('@khorsheed/')) continue
      // A family bundle's edges onto its declared members ARE the install
      // contract (npm brings the family along); the manifest sanctions them.
      if (!isAllowedEdge(dir, name) && !isFamilyMember(name)) {
        add('package.json', 'cross-plugin dependency', `${field}.${name} — not one of the sanctioned pairs`)
      }
      if (spec.startsWith('workspace:') && spec !== 'workspace:*') {
        add('package.json', 'cross-plugin dependency', `${field}.${name} is ${spec} — intra-repo deps use workspace:*`)
      }
    }
  }

  // 5. foreign-scope self references in docs/patches
  for (const doc of ['README.md', 'README.zh.md', 'cordis.patch.yml']) {
    const docPath = join(path, doc)
    if (!existsSync(docPath)) continue
    const text = readFileSync(docPath, 'utf8')
    for (const name of allNames) {
      const foreign = name.replace('@khorsheed/', '@deepseek-ai/')
      if (text.includes(foreign)) {
        add(doc, 'foreign scope', `references ${foreign} — this repo's packages are @khorsheed/*`)
      }
    }
  }

  // 6. family data references. A package may mention a sibling by name as DATA
  // — the preset-visibility probe whose companion-row constant rides the client
  // bundle — without depending on it. That mention still looks like an edge to
  // npm and to pack-dist's family-edge gate, so it must be declared in
  // `dsh.references`; the alternative (a reverse dependency edge) closes a
  // core↔companion cycle that pnpm's sequencer schedules into one concurrent
  // chunk, which raced cold builds. Both directions are checked so neither can
  // drift: every declared reference must name a real sibling and must not
  // duplicate an edge, and every sibling name the code carries must be declared
  // (an edge or a reference). No central list of "packages that must declare
  // something" — the package's own sources are the evidence, so a core that
  // drops its declaration fails here instead of only at pack time.
  const references = json.dsh?.references ?? []
  const edgeNames = new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
    ...Object.keys(json.devDependencies ?? {}),
  ])
  for (const ref of references) {
    if (!allNames.includes(ref)) {
      add('package.json', 'data reference', `dsh.references names ${ref}, which is not a package in this repo`)
    }
    // A family bundle's members are deliberately BOTH: the dependency edge
    // installs them, the reference registers the roster as data.
    if (edgeNames.has(ref) && !isFamilyMember(ref)) {
      add('package.json', 'data reference', `dsh.references names ${ref}, which is also a dependency edge — a sibling is an edge or data, never both`)
    }
  }
  for (const src of listSources(path)) {
    const text = stripCodeComments(readFileSync(src, 'utf8'))
    for (const m of text.matchAll(/@khorsheed\/[a-z0-9-]+/g)) {
      const target = m[0]
      if (target === json.name || !allNames.includes(target)) continue
      if (edgeNames.has(target) || references.includes(target)) continue
      add(src.slice(path.length + 1), 'data reference', `names ${target} in code but declares neither a dependency edge nor dsh.references — a sibling named as data belongs in dsh.references`)
    }
  }

  // 7. publish metadata (private packages are deliberately not published)
  if (!json.private) {
    if (json.repository?.url !== MONOREPO_URL || json.repository?.directory !== `packages/${dir}`) {
      add('package.json', 'publish metadata', `repository must point at this monorepo with directory packages/${dir}`)
    }
    if (!(json.keywords ?? []).includes('dsh-plugin')) {
      add('package.json', 'publish metadata', `keywords must include 'dsh-plugin'`)
    }
    // Payload directories the runtime reads must be covered by `files` —
    // a missing entry means the tarball ships without them (the skills loss
    // reached prod because nothing checked this at commit time).
    for (const payloadDir of ['scripts', 'skills', 'assets']) {
      const dirPath = join(path, payloadDir)
      if (!existsSync(dirPath)) continue
      const covered = (json.files ?? []).some(f => f === payloadDir || f.startsWith(`${payloadDir}/`))
      if (!covered) {
        add('package.json', 'publish metadata', `${payloadDir}/ exists but is not covered by files — the tarball would ship without it`)
      }
    }
  }

  return findings
}

/**
 * Cross-package checks the per-package scan cannot see.
 *
 * Two composition-level namespaces are shared by every plugin and owned by
 * none, so a collision only surfaces at boot (loader row ids) or as a subtly
 * wrong UI (chain-slot priorities). Both are cheap to detect here.
 * @param pkgs - every package under the scanned root.
 * @returns findings plus the chain-slot ledger for the report.
 */
function scanCrossPackage(pkgs: Pkg[]): { findings: Finding[]; ledger: string[] } {
  const findings: Finding[] = []

  // Loader row ids: a duplicate id fails boot outright, so this is an error.
  // Only TOP-LEVEL rows collide — nested `config.plugins` entries compose in
  // their own preset's scope (a community preset legitimately reuses the
  // official ids `persona`/`compaction`/… and the family tool-row ids there).
  // A family-like bundle's rows are skipped: the member rows ARE the members'
  // canonical rows (the row-id owner stays the member), and installing the
  // bundle never applies the members' own patches alongside — `dsh plugin add`
  // reconciles only the profile's direct dependencies. A mode bundle's preset
  // row rides the same exemption; its collision safety comes from the
  // mode-uniqueness check below instead of this map.
  const rowOwners = new Map<string, string[]>()
  for (const pkg of pkgs) {
    const kind = pkg.json.dsh?.bundle?.kind
    if (kind !== undefined && FAMILY_LIKE_KINDS.includes(kind)) continue
    const patch = pkg.json.dsh?.bundle?.patch
    if (patch === undefined) continue
    const file = join(pkg.path, patch)
    if (!existsSync(file)) continue
    for (const row of parseTopLevelPatchRows(readFileSync(file, 'utf8'))) {
      if (row.id === undefined) continue
      rowOwners.set(row.id, [...(rowOwners.get(row.id) ?? []), pkg.json.name])
    }
  }
  for (const [id, owners] of rowOwners) {
    if (owners.length > 1) {
      findings.push({
        path: 'packages/*/cordis.patch.yml',
        kind: 'loader row id',
        detail: `row id "${id}" is mounted by ${owners.join(' and ')} — a duplicate loader entry id fails boot`,
      })
    }
  }

  // Mode bundles: the `dsh.bundle.mode` namespace is unique — two mode bundles
  // carrying the same mode would mount the same `preset-<mode>` row id, and
  // the family-like exemption above keeps this map from seeing it.
  {
    const modeOwners = new Map<string, string[]>()
    for (const pkg of pkgs) {
      const mode = pkg.json.dsh?.bundle?.kind === 'mode' ? pkg.json.dsh?.bundle?.mode : undefined
      if (mode === undefined) continue
      modeOwners.set(mode, [...(modeOwners.get(mode) ?? []), pkg.json.name])
    }
    for (const [mode, owners] of modeOwners) {
      if (owners.length > 1) {
        findings.push({
          path: 'packages/*/package.json',
          kind: 'bundle kind',
          detail: `dsh.bundle.mode "${mode}" is claimed by ${owners.join(' and ')} — mode bundles share no preset; the row id preset-${mode} would mount twice`,
        })
      }
    }
  }

  // Plugin-card titles: the plugin manager lists every installed
  // self-mounting package by its locale meta.title, so two cards sharing a zh
  // (or en) title are indistinguishable — bundle-eval's 评测 collided with
  // eval's 评测 until 2026-10-12. A bundle's title must read as a collection,
  // never a member's name. Missing/unreadable locale files are reported by
  // scanPackage's display-metadata check; here only collisions.
  for (const lang of ['en', 'zh']) {
    const titleOwners = new Map<string, string[]>()
    for (const pkg of pkgs) {
      if (pkg.json.dsh?.bundle?.patch === undefined) continue
      const file = join(pkg.path, 'locale', `${lang}.json`)
      if (!existsSync(file)) continue
      let title: unknown
      try {
        title = (JSON.parse(readFileSync(file, 'utf8')) as { meta?: { title?: unknown } }).meta?.title
      } catch {
        continue
      }
      if (typeof title !== 'string' || title.trim() === '') continue
      titleOwners.set(title, [...(titleOwners.get(title) ?? []), pkg.json.name])
    }
    for (const [title, owners] of titleOwners) {
      if (owners.length > 1) {
        findings.push({
          path: `packages/*/locale/${lang}.json`,
          kind: 'display metadata',
          detail: `${lang} card title "${title}" is shared by ${owners.join(' and ')} — plugin cards must be distinguishable; a bundle's title reads as a collection, never a member's name`,
        })
      }
    }
  }

  // Patch row ownership: one package's bundle patch may insert its own row plus
  // rows for packages that do NOT self-mount (the companion `-tool` rows, which
  // have no patch of their own), but never a row for another self-mounting
  // package — install both and that package's row is mounted twice, which
  // either fails boot on the duplicate loader id or silently shadows a config.
  // Mechanically covers the whole tree, so a future provider cannot re-insert
  // the core row that its own package name resolves to (the incident the
  // local-agent family documented but nothing froze). Top-level rows only, for
  // the same scope reason as the row-id ledger above.
  //
  // Sanctioned exception: a family bundle re-mounts its DECLARED members'
  // canonical rows — that is the kind's whole job. The exemption is exact: a
  // row must BE one of those canonical rows (same id, same name when named),
  // so a bundle poaching a non-member row still fails here.
  const byName = new Map(pkgs.map((p) => [p.json.name, p]))
  const ownRowsOf = (pkg: Pkg): PatchRow[] => {
    const patch = pkg.json.dsh?.bundle?.patch
    if (patch === undefined) return []
    const file = join(pkg.path, patch)
    return existsSync(file) ? parseTopLevelPatchRows(readFileSync(file, 'utf8')) : []
  }
  /**
   * The exact allowlist of one family-like bundle's patch: the union of its
   * declared members' own top-level rows, minus the companion composition rows
   * (a name with a subpath beyond the package — those live in a preset's grant
   * list, never at a pack's profile root).
   */
  const familyCanonicalRows = (pkg: Pkg): PatchRow[] => {
    const kind = pkg.json.dsh?.bundle?.kind
    if (kind === undefined || !FAMILY_LIKE_KINDS.includes(kind)) return []
    return (pkg.json.dsh.bundle.members ?? []).flatMap((member) => {
      const owner = byName.get(member)
      return owner === undefined ? [] : ownRowsOf(owner)
    }).filter((row) => !isCompanionRow(row))
  }
  const isCanonicalRow = (canonical: PatchRow[], row: PatchRow): boolean =>
    canonical.some((r) => r.id === row.id && (row.name === undefined || r.name === row.name))
  const selfMounting = new Set(
    pkgs.filter((p) => p.json.dsh?.bundle?.patch !== undefined).map((p) => p.json.name),
  )
  for (const pkg of pkgs) {
    const patch = pkg.json.dsh?.bundle?.patch
      ?? (existsSync(join(pkg.path, 'cordis.patch.yml')) ? 'cordis.patch.yml' : undefined)
    if (patch === undefined) continue
    const canonical = familyCanonicalRows(pkg)
    const file = join(pkg.path, patch)
    if (!existsSync(file)) continue
    for (const row of parseTopLevelPatchRows(readFileSync(file, 'utf8'))) {
      if (row.name === undefined) continue
      if (row.name === pkg.json.name || !selfMounting.has(row.name)) continue
      if (canonical.length > 0 && isCanonicalRow(canonical, row)) continue
      findings.push({
        path: `packages/${pkg.dir}/${patch}`,
        kind: 'patch row ownership',
        detail: `patch inserts a row for ${row.name}, which self-mounts — a package must not mount another self-mounting package's row (both installed mounts it twice)`,
      })
    }
  }

  // Family-like bundles (dsh.bundle.kind: 'family' | 'mode'), the strict half
  // of the sanction the two exemptions above open: members must be real
  // self-mounting packages; every bundle row must come from the exact
  // allowlist — the union of the members' own top-level rows MINUS the
  // companion composition rows (a member row whose name carries a subpath
  // beyond the package, like `@khorsheed/dsh-game/agent`: those belong to a
  // preset's grant list, never to a pack's profile root) — so an invented id,
  // a row named outside the declared members, an override no member patch
  // carries, or a companion row mounted here anyway all fail — and every
  // member must contribute at least one row, so the manifest roster and the
  // patch cannot drift apart. A mode bundle's one preset row (its own
  // declaration, pinned per-package) is the single allowed non-member row.
  //
  // A mode bundle must keep the grant semantics of every subtracted companion
  // row: its inline preset row's composition names the same id with the same
  // name. And every `@khorsheed/*` module the preset composition names must
  // belong to one of the declared members — a preset granting a stranger
  // module would smuggle a cross-package edge past the roster.
  for (const pkg of pkgs) {
    const pkgKind = pkg.json.dsh?.bundle?.kind
    if (pkgKind === undefined || !FAMILY_LIKE_KINDS.includes(pkgKind)) continue
    const modePresetRowId = pkgKind === 'mode' ? `preset-${pkg.json.dsh?.bundle?.mode ?? ''}` : undefined
    const pkgLabel = pkgKind === 'mode' ? 'mode bundle' : 'family bundle'
    const patch = pkg.json.dsh?.bundle?.patch
    const members = pkg.json.dsh?.bundle?.members ?? []
    const memberRows = new Map<string, PatchRow[]>()
    for (const member of members) {
      const owner = byName.get(member)
      if (owner === undefined) continue // scanPackage reports the ghost
      if (owner.json.dsh?.bundle?.patch === undefined) {
        findings.push({
          path: `packages/${pkg.dir}/package.json`,
          kind: pkgLabel,
          detail: `member ${member} does not self-mount (no dsh.bundle.patch) — family members must be real self-mounting packages`,
        })
        continue
      }
      memberRows.set(member, ownRowsOf(owner))
    }
    if (patch === undefined || !existsSync(join(pkg.path, patch))) continue
    const patchText = readFileSync(join(pkg.path, patch), 'utf8')
    const canonical = [...memberRows.values()].flat()
    const allowed = canonical.filter((row) => !isCompanionRow(row))
    const companions = canonical.filter(isCompanionRow)
    const covered = new Set<string>()
    for (const row of parseTopLevelPatchRows(patchText)) {
      if (modePresetRowId !== undefined && row.id === modePresetRowId && row.name === AGENT_PRESET_ROW_NAME) continue
      if (isCanonicalRow(allowed, row)) {
        for (const [member, rows] of memberRows) {
          if (rows.some((r) => !isCompanionRow(r) && r.id === row.id && r.name === row.name)) covered.add(member)
        }
        continue
      }
      if (isCanonicalRow(companions, row)) {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: pkgLabel,
          detail: `row ${row.id ?? '(no id)'} (${row.name ?? 'no name'}) is a member's companion composition row — those live in the preset row's grant list, never at a pack's profile root`,
        })
      } else if (row.name === undefined) {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: pkgLabel,
          detail: `override row ${row.id ?? '(no id)'} matches no top-level row of any member's own patch — a family bundle re-mounts canonical rows verbatim`,
        })
      } else if (memberRows.has(row.name)) {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: pkgLabel,
          detail: `row ${row.id ?? '(no id)'} (${row.name}) is not a top-level row of that member's own patch — a family bundle re-mounts canonical rows verbatim`,
        })
      } else {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: pkgLabel,
          detail: `row ${row.id ?? '(no id)'} is named ${row.name} — the kind mounts only the canonical rows of its declared dsh.bundle.members`,
        })
      }
    }
    for (const member of members) {
      if (memberRows.has(member) && !covered.has(member)) {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: pkgLabel,
          detail: `member ${member} contributes no row to the bundle patch (a companion composition row granted by the preset does not count) — every declared member must be mounted (or dropped from dsh.bundle.members)`,
        })
      }
    }
    if (pkgKind === 'mode' && modePresetRowId !== undefined) {
      const grants = parsePresetGrantRows(patchText, modePresetRowId)
      for (const companion of companions) {
        if (!grants.some((g) => g.id === companion.id && g.name === companion.name)) {
          findings.push({
            path: `packages/${pkg.dir}/${patch}`,
            kind: pkgLabel,
            detail: `companion row ${companion.id ?? '(no id)'} (${companion.name}) is dropped from the pack patch but never granted by the preset row ${modePresetRowId} — the grant semantics would be lost`,
          })
        }
      }
      for (const grant of grants) {
        if (grant.name === undefined || !grant.name.startsWith('@khorsheed/')) continue
        const owner = packageNameOf(grant.name)
        if (!members.includes(owner)) {
          findings.push({
            path: `packages/${pkg.dir}/${patch}`,
            kind: pkgLabel,
            detail: `preset row ${modePresetRowId} names ${grant.name} (row ${grant.id ?? 'no id'}) — not one of the declared dsh.bundle.members`,
          })
        }
      }
    }
  }

  // Cross-bundle row parity: a row id shared by several bundle patches must
  // carry the same YAML item content in every one (dev / bundle-eval /
  // bundle-local-agent all re-mount the local-agent family rows; dev and
  // bundle-local-agent share the room row). Compared as YAML
  // content — comment and blank lines dropped, scalar quoting normalized (the
  // parity specs' convention) — everything else must match byte for byte.
  // Preset rows are exempt: their cross-copy parity is composition-level and
  // owned by scripts/eval-preset-parity.spec.ts (each mode pack's preset row
  // is otherwise the only copy).
  {
    const rowCopies = new Map<string, Array<{ readonly owner: string; readonly block: string }>>()
    for (const pkg of pkgs) {
      const kind = pkg.json.dsh?.bundle?.kind
      if (kind === undefined || !BUNDLE_KINDS.includes(kind)) continue
      const patch = pkg.json.dsh?.bundle?.patch
      if (patch === undefined) continue
      const file = join(pkg.path, patch)
      if (!existsSync(file)) continue
      for (const row of parseTopLevelPatchRowBlocks(readFileSync(file, 'utf8'))) {
        if (row.id === undefined) continue
        if (row.name === AGENT_PRESET_ROW_NAME) continue
        rowCopies.set(row.id, [...(rowCopies.get(row.id) ?? []), { owner: pkg.json.name, block: row.block }])
      }
    }
    for (const [id, copies] of rowCopies) {
      if (new Set(copies.map((c) => c.block)).size <= 1) continue
      findings.push({
        path: 'packages/*/cordis.patch.yml',
        kind: 'bundle row parity',
        detail: `row id "${id}" is mounted by ${copies.map((c) => c.owner).join(' and ')} with different content — a row shared by bundle patches must be copied verbatim`,
      })
    }
  }

  // Composition metadata: the manifest is the source of truth for "this package
  // deliberately does not self-mount", and NO_OWN_PATCH is kept as a
  // cross-check so metadata and the historical list cannot drift apart while
  // the list is retired.
  const noOwn = new Set(NO_OWN_PATCH)
  for (const pkg of pkgs) {
    const component = pkg.json.dsh?.composition?.component
    const selfMounts = pkg.json.dsh?.bundle?.patch !== undefined
    const path = `packages/${pkg.dir}/package.json`
    if (component !== undefined && !COMPOSITION_COMPONENTS.includes(component)) {
      findings.push({
        path,
        kind: 'composition component',
        detail: `dsh.composition.component "${component}" is not one of ${COMPOSITION_COMPONENTS.join(' / ')}`,
      })
    }
    if (component === undefined && !selfMounts) {
      findings.push({
        path,
        kind: 'composition component',
        detail: 'neither self-mounts nor declares dsh.composition.component — the package map cannot tell a deliberate row from a missing patch',
      })
    }
    if (component !== undefined && !noOwn.has(pkg.dir)) {
      findings.push({
        path,
        kind: 'composition component',
        detail: 'declares a composition component but is not listed in NO_OWN_PATCH — the metadata and the list must agree',
      })
    }
    if (noOwn.has(pkg.dir) && component === undefined) {
      findings.push({
        path,
        kind: 'composition component',
        detail: 'listed in NO_OWN_PATCH but declares no dsh.composition.component — mirror the metadata, do not let the list lead',
      })
    }
  }

  // Chain-slot priorities: election is ascending and the first non-null entry
  // wins, so two entries sharing a priority resolve by registration order —
  // a composition-tree detail, not a stable contract. Coexistence is legitimate
  // when their conditions never overlap, so this warns rather than fails, and
  // prints the ledger so the next plugin can pick a free number instead of
  // reading five packages' sources to guess one.
  const chain = new Map<string, { priority: number; owner: string }[]>()
  for (const pkg of pkgs) {
    for (const file of listSources(pkg.path)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/name:\s*'([a-z][a-zA-Z.]+)',([\s\S]{0,240}?)priority:\s*(-?\d+)/g)) {
        // A `key` makes it a keyed slot: entries are isolated by key and never
        // compete, so priority there is ordering within one key, not election.
        if (/\bkey:\s*'/.test(m[2]!)) continue
        const slot = m[1]!
        chain.set(slot, [...(chain.get(slot) ?? []), { priority: Number(m[3]), owner: pkg.json.name }])
      }
    }
  }
  const ledger: string[] = []
  for (const [slot, entries] of [...chain].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...entries].sort((a, b) => a.priority - b.priority)
    ledger.push(`  ${slot}`)
    for (const e of sorted) ledger.push(`    ${String(e.priority).padStart(5)}  ${e.owner}`)
    // Only a CROSS-package clash matters: one package registering two entries
    // at the same priority orders them itself and knows its own intent.
    const byPriority = new Map<number, Set<string>>()
    for (const e of sorted) byPriority.set(e.priority, (byPriority.get(e.priority) ?? new Set()).add(e.owner))
    for (const [priority, owners] of byPriority) {
      if (owners.size < 2) continue
      findings.push({
        path: slot,
        kind: 'chain slot priority',
        detail: `${[...owners].join(' and ')} both register priority ${priority} — election falls back to registration order, which is a composition-tree detail rather than a stable contract`,
        severity: 'warn',
      })
    }
  }
  return { findings, ledger }
}

/** Scan every package under a packages/ root. */
export function scanTree(
  packagesRoot: string,
): { readonly count: number; readonly findings: Finding[]; readonly ledger: string[] } {
  const pkgs = listPackages(packagesRoot)
  const allNames = pkgs.map((p) => p.json.name)
  const cross = scanCrossPackage(pkgs)
  return {
    count: pkgs.length,
    findings: [...pkgs.flatMap((p) => scanPackage(p, allNames)), ...cross.findings],
    ledger: cross.ledger,
  }
}

function main(): void {
  const { count, findings, ledger } = scanTree(join(import.meta.dirname!, '..', 'packages'))
  const errors = findings.filter((f) => f.severity !== 'warn')
  const warnings = findings.filter((f) => f.severity === 'warn')
  for (const f of errors) {
    process.stderr.write(`independence: ${f.path}: ${f.kind} — ${f.detail}\n`)
  }
  for (const f of warnings) {
    process.stderr.write(`independence: warning: ${f.path}: ${f.kind} — ${f.detail}\n`)
  }
  if (process.argv.includes('--ledger') && ledger.length > 0) {
    process.stdout.write(`independence: chain-slot ledger\n${ledger.join('\n')}\n`)
  }
  const warned = warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''
  process.stdout.write(`independence: scanned ${count} package(s), ${errors.length} finding(s)${warned}\n`)
  process.exit(errors.length > 0 ? 1 : 0)
}

// Only run the CLI when invoked directly; importing (e.g. from the spec)
// must not exit the host process.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
