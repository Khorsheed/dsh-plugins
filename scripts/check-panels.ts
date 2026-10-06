#!/usr/bin/env node
/**
 * Panel responsive checker — the machine-checkable half of
 * docs/panel-design.md (one layout per plugin, adapted by panel width).
 *
 * Scans every plugin package carrying `dsh.client` (only its `src/client`
 * .css / .ts / .tsx). A package is ADOPTED once it depends on
 * `@khorsheed/dsh-client-ui-panel-kit` (a source-plane library, so usually a
 * devDependency inlined at build); an adopted package's errors fail the
 * run, while a not-yet-adopted package is reported as one line of hints and
 * never fails it — so the tree is green today and a package becomes enforced
 * the moment it adopts the kit.
 *
 * Rules (id — severity — what it checks):
 *
 *   panel-root        error  the panel declares a width container: `PanelRoot`
 *                            (or the kit-based `ContentPane`, which carries
 *                            one) in TS, or `container-type: inline-size` /
 *                            the `container: <name> / inline-size` shorthand
 *                            in CSS
 *   compact-layout    error  a compact layout exists: `PanelHeader` (or
 *                            `ContentPane`) in TS, or an
 *                            `@container … (max-width: 560px)` rule in CSS
 *   token-fallback    error  every `var(--dsh-panel-…)` carries a fallback
 *                            (TS spelling it through `panelVar()` is fine)
 *   no-mobile-import  error  nothing imports `@khorsheed/dsh-mobile` and no
 *                            dependency field names it — plugins never depend
 *                            on the mobile package
 *   container-match   error  in the BUILT `lib/client.js`, every container name
 *                            an `@container <name>` query uses is declared
 *                            (`container: <name>/…`, `container-name: <name>`)
 *                            somewhere in that same bundle. Guards the
 *                            2026-10-06 incident: the CSS Modules transform
 *                            hashed container names per file, so a plugin's
 *                            `@container dsh-panel` never met the container
 *                            PanelRoot declares and every compact rule was
 *                            dead in production while source-level checks and
 *                            vite-served examples looked fine. A missing build
 *                            — or one older than the package's sources or the
 *                            shared build config — is an `info` (rebuild,
 *                            then re-run), never a pass or a failure.
 *   literal-color     warn   CSS colour literals (#hex, rgb()/rgba()/hsl())
 *                            outside a `var(--x, literal)` fallback
 *   hover-only        warn   a `:hover` rule revealing something hidden
 *                            (opacity 0 / visibility hidden / display none)
 *                            with no `(hover: none)` / `(pointer: coarse)`
 *                            handling in the same file — a heuristic, it can
 *                            misfire on reveals that also open on focus
 *   small-touch-text  warn   a `font-size` literal under 13px inside a
 *                            `(pointer: coarse)` or 560px container block
 *   fixed-overlay     warn   `position: fixed` — a panel overlay should be
 *                            positioned in the panel; fixed pushes it past the
 *                            phone shell's edge
 *   desktop-font      warn   a `font` / `font-size` declaration reading a host
 *                            desktop size token (`--dsw-font-xs-*`,
 *                            `--dsw-font-xxs-*`, `--dsw-font-xxxs-*`) — those
 *                            never grow on a phone; read `--dsh-panel-*`
 *                            instead (2026-10-06: the canvas switch row was
 *                            pinned at xxs-12 on the phone)
 *
 * A warn rule is silenced for one line by a `panel-check: allow-<what>`
 * comment on that line or the one above (`allow-color`, `allow-hover`,
 * `allow-small-text`, `allow-fixed`, `allow-desktop-font`).
 *
 * Usage:
 *   pnpm check:panels                              every dsh.client package
 *   pnpm check:panels --package packages/canvas    one package (repeatable),
 *                                                  every finding listed
 *   pnpm check:panels --json                       machine-readable report
 *
 * Counting: errors and warnings are counted ONCE per report
 * ({@link countReport}); the per-package line, the summary line and the
 * JSON all read those counts. Only an adopted package's errors are
 * ENFORCED (the exit code and the summary's error total); a not-yet-adopted
 * package's findings are hints, counted separately. `info` lines (e.g. "build
 * first") are never counted.
 *
 * Exit code 0 = no error in an adopted package; 1 otherwise.
 * @module scripts/check-panels
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PANEL_KIT = '@khorsheed/dsh-client-ui-panel-kit'
const MOBILE = '@khorsheed/dsh-mobile'
const DOC = 'docs/panel-design.md'

export type RuleId =
  | 'panel-root' | 'compact-layout' | 'token-fallback' | 'no-mobile-import'
  | 'literal-color' | 'hover-only' | 'small-touch-text' | 'fixed-overlay'
  | 'container-match' | 'desktop-font'

export interface PanelFinding {
  readonly rule: RuleId
  readonly severity: 'error' | 'warn' | 'info'
  /** Repo-relative path, with `:line` when the finding has one. */
  readonly where: string
  readonly detail: string
}

export interface PackageReport {
  readonly dir: string
  readonly name: string
  readonly adopted: boolean
  readonly findings: PanelFinding[]
}

/** The one-line fix per rule, each pointing at its section of the doc. */
const HINTS: Record<RuleId, string> = {
  'panel-root': `用 PanelRoot 包住面板根节点（${DOC}#面板根与紧凑排版）`,
  'compact-layout': `用 PanelHeader，或写一段 @container (max-width: 560px) 紧凑排版（${DOC}#面板根与紧凑排版）`,
  'token-fallback': `写成 var(--dsh-panel-…, 桌面默认值)，或在 TS 里用 panelVar()（${DOC}#字号）`,
  'no-mobile-import': `插件不能依赖 mobile 包；字号读 --dsh-panel-* 变量（${DOC}#字号）`,
  'literal-color': `改用 var(--dsw-alias-…)；确需字面量就加 /* panel-check: allow-color */（${DOC}#颜色）`,
  'hover-only': `触屏没有悬停：改成常显、放进「…」，或补 (hover: none) 的处理（${DOC}#触屏）`,
  'small-touch-text': `触屏下文字不小于 13px，用 --dsh-panel-text-meta（${DOC}#字号）`,
  'fixed-overlay': `弹层在面板内绝对定位；确需 fixed 就加 /* panel-check: allow-fixed */（${DOC}#弹层与溢出）`,
  'desktop-font': `面板文字改读 var(--dsh-panel-text-…, 桌面默认值)，桌面字号变量在手机上不会放大；确需保留就加 /* panel-check: allow-desktop-font */（${DOC}#字号）`,
  'container-match': `构建产物里容器名对不上：检查 build/tsdown.client.ts 的 cssModules 是否保持容器名全局，重新 build（${DOC}#自查）`,
}

const ALLOW: Partial<Record<RuleId, string>> = {
  'literal-color': 'allow-color',
  'hover-only': 'allow-hover',
  'small-touch-text': 'allow-small-text',
  'fixed-overlay': 'allow-fixed',
  'desktop-font': 'allow-desktop-font',
}

/** Recursively list a directory's files with one of the extensions. */
function filesUnder(dir: string, exts: readonly string[]): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, exts))
    else if (exts.some((ext) => entry.endsWith(ext)) && !entry.endsWith('.d.ts')) out.push(path)
  }
  return out.sort()
}

/** Blank out CSS comments, keeping line numbers (newlines survive). */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

/** Whether a `panel-check: allow-…` marker sits on this line or the one above. */
function allowed(lines: readonly string[], line: number, marker: string): boolean {
  return [lines[line - 1], lines[line - 2]].some((l) => l !== undefined && l.includes(`panel-check: ${marker}`))
}

/**
 * Index ranges of each `var(` call's fallback argument (after its first
 * top-level comma), so a literal sitting there is recognised as a default.
 */
function fallbackRanges(css: string): [number, number][] {
  const ranges: [number, number][] = []
  const re = /var\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    let depth = 1
    let comma = -1
    let i = m.index + 4
    for (; i < css.length && depth > 0; i++) {
      const c = css[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ',' && depth === 1 && comma < 0) comma = i
    }
    if (comma >= 0) ranges.push([comma, i])
  }
  return ranges
}

/** `var(--dsh-panel-…)` calls lacking a fallback, as match indexes. */
export function tokensWithoutFallback(text: string): number[] {
  const out: number[] = []
  const re = /var\(\s*--dsh-panel-[\w-]+\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m.index)
  return out
}

/** Colour literals outside a var() fallback, as match indexes (comments stripped). */
export function literalColors(css: string): number[] {
  const ranges = fallbackRanges(css)
  const out: number[] = []
  const re = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    // `#id` selectors and url(#frag) are not colours: a colour literal is a
    // declaration value, so it follows a `:` on its own declaration.
    const before = css.slice(Math.max(css.lastIndexOf('{', m.index), css.lastIndexOf(';', m.index), css.lastIndexOf('}', m.index)) + 1, m.index)
    if (!before.includes(':')) continue
    if (/url\(\s*$/.test(before)) continue
    if (ranges.some(([a, b]) => m!.index > a && m!.index < b)) continue
    out.push(m.index)
  }
  return out
}

/** Top-level-ish CSS blocks: `{ selector, body, start }` for every rule with declarations. */
function cssRules(css: string): { selector: string; body: string; start: number }[] {
  const out: { selector: string; body: string; start: number }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) out.push({ selector: m[1]!.trim(), body: m[2]!, start: m.index + m[0].indexOf(m[1]!.trim()) })
  return out
}

/** `:hover` rules that reveal something hidden, absent a touch counterpart in the file. */
export function hoverOnlyReveals(css: string): number[] {
  if (/\(\s*hover\s*:\s*none\s*\)|\(\s*pointer\s*:\s*coarse\s*\)/.test(css)) return []
  const reveal = /opacity\s*:\s*(?:1|0?\.[5-9]\d*)\b|visibility\s*:\s*visible|display\s*:\s*(?!none)[a-z-]+/
  const hidden = /opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|visibility\s*:\s*hidden|display\s*:\s*none/
  const rules = cssRules(css)
  const hiddenSelectors = rules.filter((r) => hidden.test(r.body)).map((r) => r.selector)
  return rules
    .filter((r) => r.selector.includes(':hover') && reveal.test(r.body))
    .filter((r) => {
      // The revealed element: the selector after its last :hover compound.
      const target = r.selector.split(',').map((s) => s.trim().split(/:hover/).pop()!.trim()).filter(Boolean)
      return target.some((t) => hiddenSelectors.some((h) => h.split(',').some((s) => s.trim().endsWith(t.split(/\s+/).pop()!))))
    })
    .map((r) => r.start)
}

/**
 * Bodies of `@media (pointer: coarse)` and 560px `@container` blocks, as
 * [start, end) ranges (one nesting level is enough for this repo's CSS).
 */
function touchBlocks(css: string): [number, number][] {
  const out: [number, number][] = []
  const re = /@(?:media[^{]*\(\s*pointer\s*:\s*coarse\s*\)|container[^{]*\(\s*max-width\s*:\s*560px\s*\))[^{]*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
    }
    out.push([m.index, i])
  }
  return out
}

/** `font-size` literals under 13px inside touch / compact blocks. */
export function smallTouchText(css: string): number[] {
  const blocks = touchBlocks(css)
  const out: number[] = []
  const re = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    if (Number(m[1]) < 13 && blocks.some(([a, b]) => m!.index > a && m!.index < b)) out.push(m.index)
  }
  return out
}

/** Desktop size tokens read by a `font` / `font-size` declaration, as indexes. */
export function desktopFonts(css: string): number[] {
  const out: number[] = []
  const decl = /\bfont(?:-size)?\s*:([^;{}]*)/g
  let m: RegExpExecArray | null
  while ((m = decl.exec(css)) !== null) {
    const token = /var\(\s*--dsw-font-x{1,3}s-/.exec(m[1]!)
    if (token) out.push(m.index + m[0].length - m[1]!.length + token.index)
  }
  return out
}

/** `position: fixed` declarations. */
export function fixedPositions(css: string): number[] {
  const out: number[] = []
  const re = /position\s*:\s*fixed\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) out.push(m.index)
  return out
}

interface Pkg { readonly dir: string; readonly json: Record<string, unknown> }

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

function depends(json: Record<string, unknown>, name: string, fields: readonly string[] = DEP_FIELDS): boolean {
  return fields.some((f) => typeof json[f] === 'object' && json[f] !== null && name in (json[f] as object))
}

/** Scan one package. `root` makes paths repo-relative. */
export function scanPanelPackage(pkg: Pkg, root: string): PackageReport {
  const name = String(pkg.json.name ?? pkg.dir)
  const adopted = depends(pkg.json, PANEL_KIT, ['dependencies', 'devDependencies'])
  const client = join(pkg.dir, 'src', 'client')
  const cssFiles = filesUnder(client, ['.css'])
  const tsFiles = filesUnder(client, ['.ts', '.tsx'])
  const findings: PanelFinding[] = []
  const rel = (p: string) => relative(root, p)
  const add = (rule: RuleId, severity: 'error' | 'warn' | 'info', where: string, detail: string) => {
    findings.push({ rule, severity, where, detail: severity === 'info' ? detail : `${detail} — ${HINTS[rule]}` })
  }

  const css = cssFiles.map((path) => ({ path, raw: readFileSync(path, 'utf8') }))
  const ts = tsFiles.map((path) => ({ path, raw: readFileSync(path, 'utf8') }))
  const strippedCss = css.map((f) => ({ ...f, text: stripCssComments(f.raw) }))

  // Structure rules (package-level).
  const usesTs = (re: RegExp) => ts.some((f) => re.test(f.raw))
  const hasRoot = usesTs(/\bPanelRoot\b|\bContentPane\b/) || strippedCss.some((f) => /container-type\s*:\s*inline-size|container\s*:[^;{}]*\/\s*inline-size/.test(f.text))
  if (!hasRoot) add('panel-root', 'error', rel(client), '面板根没有声明宽度容器')
  const hasCompact = usesTs(/\bPanelHeader\b|\bContentPane\b/) || strippedCss.some((f) => /@container[^{]*\(\s*max-width\s*:\s*560px\s*\)/.test(f.text))
  if (!hasCompact) add('compact-layout', 'error', rel(client), '没有紧凑排版（≤ 560px）')

  // no-mobile-import: source and manifest.
  for (const f of ts) {
    const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](@khorsheed\/dsh-mobile)(?:\/[^'"]*)?['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(f.raw)) !== null) add('no-mobile-import', 'error', `${rel(f.path)}:${lineOf(f.raw, m.index)}`, `导入了 ${MOBILE}`)
  }
  if (depends(pkg.json, MOBILE)) add('no-mobile-import', 'error', rel(join(pkg.dir, 'package.json')), `依赖字段里有 ${MOBILE}`)

  // token-fallback: CSS and TS string spellings.
  for (const f of [...strippedCss.map((c) => ({ path: c.path, text: c.text })), ...ts.map((t) => ({ path: t.path, text: t.raw }))]) {
    for (const i of tokensWithoutFallback(f.text)) add('token-fallback', 'error', `${rel(f.path)}:${lineOf(f.text, i)}`, '--dsh-panel-* 变量没有默认值')
  }

  // Warn rules (CSS, line-level, each with its allow marker).
  for (const f of strippedCss) {
    const lines = f.raw.split('\n')
    const report = (rule: RuleId, indexes: number[], detail: string) => {
      for (const i of indexes) {
        const line = lineOf(f.text, i)
        if (allowed(lines, line, ALLOW[rule]!)) continue
        add(rule, 'warn', `${rel(f.path)}:${line}`, detail)
      }
    }
    report('literal-color', literalColors(f.text), '写死的颜色')
    report('hover-only', hoverOnlyReveals(f.text), '只有悬停才显示')
    report('small-touch-text', smallTouchText(f.text), '触屏/紧凑下文字小于 13px')
    report('fixed-overlay', fixedPositions(f.text), 'position: fixed')
    report('desktop-font', desktopFonts(f.text), '直接用了桌面字号变量')
  }
  // container-match: the built bundle, only once the package adopted the kit
  // (a not-yet-adopted package has no shared container to miss).
  if (adopted) {
    const bundle = join(pkg.dir, 'lib', 'client.js')
    if (!existsSync(bundle)) {
      add('container-match', 'info', rel(bundle), '还没有构建产物，跳过容器名核对（先 pnpm build 再跑）')
    } else if (staleBundle(bundle, [...cssFiles, ...tsFiles, buildConfig(root)])) {
      add('container-match', 'info', rel(bundle), '构建产物早于源码或共享构建配置，跳过容器名核对（先 pnpm build 再跑）')
    } else {
      for (const name of unmatchedContainers(readFileSync(bundle, 'utf8'))) {
        add('container-match', 'error', rel(bundle), `查询了容器 ${name}，产物里没有任何声明`)
      }
    }
  }
  return { dir: rel(pkg.dir), name, adopted, findings }
}

/** The shared client build config whose change invalidates every bundle. */
function buildConfig(root: string): string {
  return join(root, 'build', 'tsdown.client.ts')
}

/** Whether the bundle predates any of the inputs (missing inputs are ignored). */
function staleBundle(bundle: string, inputs: readonly string[]): boolean {
  const built = statSync(bundle).mtimeMs
  return inputs.some((p) => existsSync(p) && statSync(p).mtimeMs > built)
}

const CONTAINER_KEYWORDS = new Set(['not', 'and', 'or', 'style', 'scroll-state'])

/**
 * Container names a bundle queries but never declares. Queries:
 * `@container <name> (…)`; declarations: `container: <name> / …` or
 * `container-name: <name>` in CSS, or `containerName` / `container` in an
 * inline style object. Unnamed queries (`@container (…)`) match the nearest
 * container of any name and are not checked.
 */
export function unmatchedContainers(bundle: string): string[] {
  const queried = new Set<string>()
  for (const m of bundle.matchAll(/@container\s+([A-Za-z_-][\w-]*)/g)) {
    if (!CONTAINER_KEYWORDS.has(m[1]!)) queried.add(m[1]!)
  }
  const declared = new Set<string>()
  for (const m of bundle.matchAll(/container(?:-name)?\s*:\s*([A-Za-z_-][\w-]*(?:\s+[A-Za-z_-][\w-]*)*)/g)) {
    for (const name of m[1]!.split(/\s+/)) declared.add(name)
  }
  for (const m of bundle.matchAll(/container(?:Name)?\s*:\s*['"`]([^'"`/]+)/g)) {
    for (const name of m[1]!.trim().split(/\s+/)) declared.add(name)
  }
  return [...queried].filter((name) => !declared.has(name)).sort()
}

/** Every package under packagesRoot carrying `dsh.client`. */
export function listClientPackages(packagesRoot: string): Pkg[] {
  return readdirSync(packagesRoot)
    .map((entry) => join(packagesRoot, entry))
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .map((dir) => ({ dir, json: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown> }))
    .filter((p) => typeof p.json.dsh === 'object' && p.json.dsh !== null && 'client' in (p.json.dsh as object))
}

/** One report's counts — the single source every output reads. */
export interface ReportCounts {
  readonly errors: number
  readonly warnings: number
  readonly infos: number
}

export function countReport(report: PackageReport): ReportCounts {
  const of = (s: PanelFinding['severity']) => report.findings.filter((f) => f.severity === s).length
  return { errors: of('error'), warnings: of('warn'), infos: of('info') }
}

/** Totals over a scan: enforced errors (adopted packages) and hints (the rest). */
export interface ScanTotals {
  /** Errors in adopted packages — the exit code. */
  readonly errors: number
  /** Warnings in adopted packages. */
  readonly warnings: number
  /** Error + warn findings in not-yet-adopted packages (hints only). */
  readonly hints: number
}

export function totalsOf(reports: readonly PackageReport[]): ScanTotals {
  let errors = 0, warnings = 0, hints = 0
  for (const r of reports) {
    const c = countReport(r)
    if (r.adopted) { errors += c.errors; warnings += c.warnings } else hints += c.errors + c.warnings
  }
  return { errors, warnings, hints }
}

/** Scan a set of packages; errors only count for adopted ones. */
export function scanPanels(pkgs: readonly Pkg[], root: string): { reports: PackageReport[]; errors: number; totals: ScanTotals } {
  const reports = pkgs.map((p) => scanPanelPackage(p, root))
  const totals = totalsOf(reports)
  return { reports, errors: totals.errors, totals }
}

/** The summary line, from the same totals the exit code uses. */
export function formatSummary(reports: readonly PackageReport[]): string {
  const t = totalsOf(reports)
  const adopted = reports.filter((r) => r.adopted).length
  return `panels: 检查 ${reports.length} 个包（已接入 ${adopted} 个）：已接入包 ${t.errors} 个错误、${t.warnings} 个提醒；未接入包 ${t.hints} 条提示`
}

/** Machine-readable report: totals plus each report with its own counts. */
export function jsonReport(reports: readonly PackageReport[]): object {
  return { ...totalsOf(reports), reports: reports.map((r) => ({ ...r, ...countReport(r) })) }
}

/** Human report: adopted packages listed in full, others as one line unless `full`. */
export function formatReport(reports: readonly PackageReport[], full: boolean, warnPreview = 5): string {
  const out: string[] = []
  for (const r of reports) {
    const errors = r.findings.filter((f) => f.severity === 'error')
    const warns = r.findings.filter((f) => f.severity === 'warn')
    const infos = r.findings.filter((f) => f.severity === 'info')
    const c = countReport(r)
    if (!r.adopted && !full) {
      out.push(`panels: ${r.name}：未接入（${c.errors + c.warnings} 条提示）`)
      continue
    }
    const state = r.adopted ? '已接入' : '未接入（以下仅为提示，不影响退出码）'
    out.push(`panels: ${r.name}：${state}，${c.errors} 个错误，${c.warnings} 个提醒`)
    for (const f of infos) out.push(`  · [${f.rule}] ${f.where}：${f.detail}`)
    for (const f of errors) out.push(`  ✗ [${f.rule}] ${f.where}：${f.detail}`)
    const shown = full ? warns : warns.slice(0, warnPreview)
    for (const f of shown) out.push(`  ! [${f.rule}] ${f.where}：${f.detail}`)
    if (shown.length < warns.length) out.push(`  … 另有 ${warns.length - shown.length} 个提醒（加 --package ${r.dir} 查看全部）`)
  }
  return out.join('\n')
}

function main(): void {
  const root = resolve(import.meta.dirname!, '..')
  const args = process.argv.slice(2)
  const picked: string[] = []
  for (let i = 0; i < args.length; i++) if (args[i] === '--package' && args[i + 1]) picked.push(resolve(root, args[++i]!))
  const all = listClientPackages(join(root, 'packages'))
  const pkgs = picked.length === 0 ? all : picked.map((dir) => {
    const found = all.find((p) => resolve(p.dir) === dir)
    if (found) return found
    if (!existsSync(join(dir, 'package.json'))) { process.stderr.write(`panels: ${relative(root, dir)} 不是包目录\n`); process.exit(2) }
    return { dir, json: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown> }
  })
  const { reports, errors } = scanPanels(pkgs, root)
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(jsonReport(reports), null, 2)}\n`)
  } else {
    process.stdout.write(`${formatReport(reports, picked.length > 0)}\n`)
    process.stdout.write(`${formatSummary(reports)}\n`)
  }
  process.exit(errors > 0 ? 1 : 0)
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
