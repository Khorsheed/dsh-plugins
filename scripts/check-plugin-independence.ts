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
 *                        ui-file-preview client/host pair); intra-repo specs
 *                        are always `workspace:*`
 *   5. inject discipline nothing injects a `@khorsheed/*` package; injecting a
 *                        community-provided service (`localAgent`, …) is
 *                        limited to the family that owns it — everyone else
 *                        probes with `ctx.get` and degrades
 *   6. publish metadata  non-private packages point `repository` at this
 *                        monorepo with the right `directory`, and carry
 *                        `dsh-plugin` in `keywords`
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
 *                        `dsh.bundle.members` — the official "one bundle card,
 *                        many rows" shape. Members are real self-mounting
 *                        packages carried as npm dependencies (installing the
 *                        bundle brings the family along; `dsh plugin add`
 *                        reconciles only the profile's DIRECT dependencies, so
 *                        the members' own patches stay inert and no row mounts
 *                        twice). The bundle registers nothing itself: no own
 *                        runtime row, no client half, no service/tool/slot
 *                        registrations in src. Added 2026-09-24 with
 *                        `bundle-local-agent` / `bundle-conversation-toolbox`.
 */
export const BUNDLE_KINDS: ReadonlyArray<string> = ['preset-declarations', 'family']

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
 * composition is mounted on their behalf — provider patches mount
 * config-bearing rows (tool-subagent), and the local-agent-dsh provisioner
 * copies the headless patch into the provisioned sub-profile's own patch
 * layer (a `dsh.bundle` declaration there would hand the host's `dsh plugin`
 * reconcile a mount trigger for a sub-dsh-only composition; see AGENTS.md
 * "Package conventions" and the two packages' README "Install" sections).
 */
export const NO_OWN_PATCH: ReadonlyArray<string> = [
  'local-agent-tool-subagent',
  'local-agent-dsh-headless',
  // worktrees-tool is the worktrees core's preset-composed companion row:
  // it only makes the tool module resolvable; agent presets name the row
  // (a `dsh.bundle` declaration would auto-mount the tool at the profile
  // root — exactly what the split removes).
  'worktrees-tool',
  // room-tool is the room core's preset-composed companion row (same shape as
  // worktrees-tool): it only makes the tool module resolvable; agent presets
  // name the row — a dsh.bundle declaration would auto-mount the tools at
  // the profile root, exactly what the split removes.
  'room-tool',
  // mission-tool / datasets-tool / eval-tool are the same shape for the
  // mission / datasets / eval cores (M4'③): each only makes its tool module
  // resolvable, and an agent preset names its row — a dsh.bundle declaration
  // would auto-mount the tools (and their guidance sections) at the profile
  // root, exactly what the split removes.
  'mission-tool',
  'datasets-tool',
  'eval-tool',
  // typesafe-tool is the same shape for the typesafe core: the core publishes
  // the `ctx.typesafe` service at the profile root and stays surface-free; this
  // row only makes the tool module resolvable, and an agent preset names the
  // row — a dsh.bundle declaration would auto-mount typesafe_judge at the
  // profile root, exactly what the split removes.
  'typesafe-tool',
  // ui-content-preview is NOT a row and NOT a companion: it is the
  // source-plane library whose `dsh.composition.component` is
  // 'source-plane-library'. Listed here because the checker pairs the
  // manifest metadata with this historical list; there is nothing for any
  // patch to mount on its behalf.
  'ui-content-preview',
]

/**
 * Sanctioned cross-package edges (AGENTS.md: the local-agent core/companion
 * family, and the ui-file-preview client/host pair). Keyed by package
 * directory; values are the allowed `@khorsheed/*` targets. Any new
 * cross-package need must follow the same declare-and-degrade pattern and be
 * added here deliberately.
 */
export const ALLOWED_EDGES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'local-agent-claude-code': ['@khorsheed/dsh-local-agent', '@khorsheed/dsh-local-agent-tool-subagent'],
  'local-agent-codex': ['@khorsheed/dsh-local-agent', '@khorsheed/dsh-local-agent-tool-subagent'],
  'local-agent-kimi': ['@khorsheed/dsh-local-agent', '@khorsheed/dsh-local-agent-tool-subagent'],
  'local-agent-dsh': [
    '@khorsheed/dsh-local-agent',
    '@khorsheed/dsh-local-agent-tool-subagent',
    '@khorsheed/dsh-local-agent-dsh-headless',
  ],
  'local-agent-tool-subagent': ['@khorsheed/dsh-local-agent'],
  // bundle-local-agent (family meta package): edges onto its declared
  // `dsh.bundle.members` are sanctioned by the manifest itself; this entry
  // covers only the family's DEPS-ONLY libraries it also installs (card-less,
  // no patch rows of their own beyond what the members' canonical rows name).
  'bundle-local-agent': ['@khorsheed/dsh-local-agent-tool-subagent', '@khorsheed/dsh-local-agent-dsh-headless'],
  // The worktrees core/companion pair: the companion consumes the core's
  // tool-definition factory and probes its global service (declare-and-degrade
  // — the probe is `ctx.get`, the peer dep keeps the module resolvable).
  'worktrees-tool': ['@khorsheed/dsh-worktrees'],
  // The core's reverse mention is DATA, not an edge: the badge lights up when
  // the preset names the companion row (its module name rides the gate
  // constant in the client bundle) and is invisible without it. It is declared
  // in the core manifest's `dsh.references` (pack-dist's family-edge check
  // honors it) — never in a dependency field: a core↔companion pair declared
  // in both directions forms a cycle that pnpm's run sequencer schedules into
  // one concurrent chunk, which raced cold builds (the companion's tsc started
  // before the core's lib existed).
  // The room core/companion pair (same declare-and-degrade pattern).
  'room-tool': ['@khorsheed/dsh-room'],
  // The mission / datasets / eval core/companion pairs (M4'③, same pattern,
  // zero deviations): each companion consumes its core's `./tool` definition
  // factory and probes the core's global service.
  'mission-tool': ['@khorsheed/dsh-mission'],
  'datasets-tool': ['@khorsheed/dsh-datasets'],
  'eval-tool': ['@khorsheed/dsh-eval'],
  'ui-file-preview': ['@khorsheed/dsh-file-preview', '@khorsheed/dsh-client-ui-content-preview'],
  // canvas → inline-html-render: the card detail renders HTML cards through
  // inline-html-render's SOURCE-plane helpers (buildCardSrcDoc/attachBridge),
  // bundled by tsdown — a compile-time edge with zero runtime coupling (the
  // renderer package need not be installed for canvas to work).
  'canvas': ['@khorsheed/dsh-inline-html-render'],
  // local-files / worktrees → ui-content-preview: the two file surfaces render
  // through ONE shared content pane (proposal preview-kernel). Same shape as
  // the canvas edge above — a compile-time SOURCE-plane import
  // (`.../src/client/*`) that tsdown inlines into each plugin's own client
  // bundle, so the kernel needs no runtime install and the two plugins stay
  // independently installable and uninstallable.
  'local-files': ['@khorsheed/dsh-client-ui-content-preview'],
  'worktrees': ['@khorsheed/dsh-client-ui-content-preview'],
  // room consumes the local-agent delegation facade as an OPTIONAL capability:
  // type-only imports, an optional peer dep, a runtime probe, and tested
  // degradation when the family is absent (the room works with the main agent
  // as its only member). Sanctioned per the declare-and-degrade pattern.
  // ...plus the same data-only reverse mention as worktrees (the self-hide
  // criterion names the companion — declared via `dsh.references`, see above).
  'room': ['@khorsheed/dsh-local-agent'],
}

/**
 * Community-provided cordis services and which package directories may inject
 * them. Anything not listed is assumed to be an official host service.
 */
export const COMMUNITY_SERVICE_INJECTORS: Readonly<Record<string, RegExp>> = {
  localAgent: /^local-agent/,
  localAgentDshHeadlessStartup: /^local-agent-dsh-headless$/,
  shortcuts: /^ui-shortcuts$/,
  // The preset-composed tool companions inject their owning core: a one-shot
  // apply-time probe lost the rc.1 boot-order race (the standing scope mounts
  // before the profile's later bundle rows provide the core), so the row
  // pends on the core instead (2026-09-27 3080 incident).
  typesafe: /^typesafe-tool$/,
  worktrees: /^worktrees-tool$/,
  room: /^room-tool$/,
  datasets: /^datasets-tool$/,
  dshEval: /^eval-tool$/,
  mission: /^mission-tool$/,
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
      readonly bundle?: { readonly patch?: string; readonly kind?: string; readonly members?: readonly string[] }
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
export function parseTopLevelPatchRows(patch: string): PatchRow[] {
  const lines = patch.split(/\r?\n/)
  const isContent = (line: string): boolean => line.trim() !== '' && !line.trimStart().startsWith('#')
  const indentOf = (line: string): number => line.length - line.trimStart().length
  const unquote = (raw: string): string => raw.trim().replace(/^['"]|['"]$/g, '')

  /** Read the id/name fields of the row whose item line is `start`. */
  const readRow = (start: number, itemIndent: number): { row: PatchRow; end: number } => {
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
    return { row, end: j }
  }

  const rows: PatchRow[] = []
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
  const familyMembers = bundleKind === 'family' ? (json.dsh?.bundle?.members ?? []) : []
  const isFamilyMember = (name: string): boolean => familyMembers.includes(name)
  if (bundleKind === 'family') {
    const members = json.dsh?.bundle?.members
    if (members === undefined || members.length === 0) {
      add('package.json', 'family bundle', 'dsh.bundle.kind family requires a non-empty dsh.bundle.members list')
    } else {
      if (members.includes(json.name)) {
        add('package.json', 'family bundle', 'dsh.bundle.members names the bundle itself')
      }
      for (const member of members) {
        if (!allNames.includes(member)) {
          add('package.json', 'family bundle', `dsh.bundle.members names ${member}, which is not a package in this repo`)
        }
        if (json.dependencies?.[member] === undefined) {
          add('package.json', 'family bundle', `member ${member} is not in dependencies — installing the bundle must bring the whole family along`)
        }
        if (!(json.dsh?.references ?? []).includes(member)) {
          add('package.json', 'family bundle', `member ${member} is not registered in dsh.references — the family roster is data every pack-time and catalog check reads`)
        }
      }
    }
    if (json.dsh?.client) {
      add('package.json', 'family bundle', 'a family bundle is pure composition — it declares no dsh.client browser half')
    }
    for (const src of listSources(path)) {
      const text = stripCodeComments(readFileSync(src, 'utf8'))
      const hit = FAMILY_REGISTRATION_RE.exec(text)
      if (hit !== null) {
        add(src.slice(path.length + 1), 'family bundle', `registers runtime surface (${hit[0]}) — a family bundle is pure composition: no services, tools, slots, commands, or apply entry of its own`)
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
    } else if (bundleKind === 'family') {
      // The row whitelist itself is a TREE-level check: the exact allowlist is
      // the union of the members' canonical patch rows (a provider's own row
      // legitimately names the family's deps-only tool package), which this
      // per-package scan cannot see. Here only the own-row rule is replaced.
      if (rows.length === 0) {
        add(patchRel, 'identity', 'declares dsh.bundle.kind family but mounts no rows')
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
  // A family bundle's rows are skipped: they ARE the members' canonical rows
  // (the row-id owner stays the member), and installing the bundle never
  // applies the members' own patches alongside — `dsh plugin add` reconciles
  // only the profile's direct dependencies.
  const rowOwners = new Map<string, string[]>()
  for (const pkg of pkgs) {
    if (pkg.json.dsh?.bundle?.kind === 'family') continue
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
  // row must BE one of those canonical rows (same id, same name when named;
  // a provider's row naming the family's deps-only tool package rides along
  // this way), so a bundle poaching a non-member row still fails here.
  const byName = new Map(pkgs.map((p) => [p.json.name, p]))
  const ownRowsOf = (pkg: Pkg): PatchRow[] => {
    const patch = pkg.json.dsh?.bundle?.patch
    if (patch === undefined) return []
    const file = join(pkg.path, patch)
    return existsSync(file) ? parseTopLevelPatchRows(readFileSync(file, 'utf8')) : []
  }
  /** The exact allowlist of one family bundle's patch: the union of its declared members' own top-level rows. */
  const familyCanonicalRows = (pkg: Pkg): PatchRow[] => {
    if (pkg.json.dsh?.bundle?.kind !== 'family') return []
    return (pkg.json.dsh.bundle.members ?? []).flatMap((member) => {
      const owner = byName.get(member)
      return owner === undefined ? [] : ownRowsOf(owner)
    })
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

  // Family bundles (dsh.bundle.kind: 'family'), the strict half of the
  // sanction the two exemptions above open: members must be real self-mounting
  // packages; every bundle row must come from the exact allowlist above — a
  // row named outside the declared members, an invented id, or an override no
  // member patch carries all fail — and every member must contribute at least
  // one row, so the manifest roster and the patch cannot drift apart.
  for (const pkg of pkgs) {
    if (pkg.json.dsh?.bundle?.kind !== 'family') continue
    const patch = pkg.json.dsh?.bundle?.patch
    const members = pkg.json.dsh?.bundle?.members ?? []
    const memberRows = new Map<string, PatchRow[]>()
    for (const member of members) {
      const owner = byName.get(member)
      if (owner === undefined) continue // scanPackage reports the ghost
      if (owner.json.dsh?.bundle?.patch === undefined) {
        findings.push({
          path: `packages/${pkg.dir}/package.json`,
          kind: 'family bundle',
          detail: `member ${member} does not self-mount (no dsh.bundle.patch) — family members must be real self-mounting packages`,
        })
        continue
      }
      memberRows.set(member, ownRowsOf(owner))
    }
    if (patch === undefined || !existsSync(join(pkg.path, patch))) continue
    const canonical = [...memberRows.values()].flat()
    const covered = new Set<string>()
    for (const row of parseTopLevelPatchRows(readFileSync(join(pkg.path, patch), 'utf8'))) {
      if (isCanonicalRow(canonical, row)) {
        for (const [member, rows] of memberRows) {
          if (rows.some((r) => r.id === row.id && r.name === row.name)) covered.add(member)
        }
        continue
      }
      if (row.name === undefined) {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: 'family bundle',
          detail: `override row ${row.id ?? '(no id)'} matches no top-level row of any member's own patch — a family bundle re-mounts canonical rows verbatim`,
        })
      } else if (memberRows.has(row.name)) {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: 'family bundle',
          detail: `row ${row.id ?? '(no id)'} (${row.name}) is not a top-level row of that member's own patch — a family bundle re-mounts canonical rows verbatim`,
        })
      } else {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: 'family bundle',
          detail: `row ${row.id ?? '(no id)'} is named ${row.name} — the kind mounts only the canonical rows of its declared dsh.bundle.members`,
        })
      }
    }
    for (const member of members) {
      if (memberRows.has(member) && !covered.has(member)) {
        findings.push({
          path: `packages/${pkg.dir}/${patch}`,
          kind: 'family bundle',
          detail: `member ${member} contributes no row to the bundle patch — every declared member must be mounted (or dropped from dsh.bundle.members)`,
        })
      }
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
