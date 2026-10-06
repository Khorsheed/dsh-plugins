import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  PANEL_KIT,
  countReport,
  desktopFonts,
  fixedPositions,
  formatReport,
  formatSummary,
  jsonReport,
  hoverOnlyReveals,
  listClientPackages,
  literalColors,
  scanPanelPackage,
  scanPanels,
  smallTouchText,
  stripCssComments,
  tokensWithoutFallback,
  totalsOf,
  unmatchedContainers,
} from './check-panels.ts'

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

/** A throwaway package: package.json plus src/client files. */
function fixture(files: Record<string, string>, json: Record<string, unknown> = {}): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'check-panels-'))
  roots.push(root)
  const dir = join(root, 'packages', 'demo')
  const manifest = { name: '@khorsheed/dsh-demo', dsh: { client: { platform: 'web' } }, ...json }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, 'src', 'client', path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return { root, dir }
}

const adoptedJson = { devDependencies: { [PANEL_KIT]: 'workspace:*' } }
const goodTsx = "import { PanelRoot, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'\nexport const View = () => <PanelRoot><PanelHeader title=\"x\" moreLabel=\"more\" /></PanelRoot>\n"

function rules(files: Record<string, string>, json: Record<string, unknown> = adoptedJson) {
  const { root, dir } = fixture(files, json)
  // `info` lines (e.g. container-match's "build first" on a fixture with no
  // lib/) are never findings to fix; the container-match tests read them.
  return scanPanelPackage({ dir, json: { name: '@khorsheed/dsh-demo', ...json } }, root).findings.filter((f) => f.severity !== 'info')
}

describe('structure rules', () => {
  it('panel-root and compact-layout pass with PanelRoot + PanelHeader, or with the CSS equivalents', () => {
    expect(rules({ 'View.tsx': goodTsx })).toEqual([])
    const css = '.root { container-type: inline-size; }\n@container pane (max-width: 560px) { .a { gap: 0; } }\n'
    expect(rules({ 'View.tsx': 'export {}\n', 'view.module.css': css })).toEqual([])
  })

  it('panel-root and compact-layout fire when neither form is present', () => {
    const ids = rules({ 'View.tsx': 'export const View = () => null\n' }).map((f) => f.rule)
    expect(ids).toEqual(['panel-root', 'compact-layout'])
  })

  it('panel-root accepts the `container: <name> / inline-size` shorthand', () => {
    const css = '.root { container: pane / inline-size; }\n@container pane (max-width: 560px) { .a { gap: 0; } }\n'
    expect(rules({ 'View.tsx': 'export {}\n', 'view.module.css': css })).toEqual([])
    const ids = rules({ 'View.tsx': 'export {}\n', 'view.module.css': '.root { container: pane; }\n@container pane (max-width: 560px) { .a { gap: 0 } }' }).map((f) => f.rule)
    expect(ids).toEqual(['panel-root'])
  })

  it('a 480px container query is not the compact layout', () => {
    const ids = rules({ 'View.tsx': '<PanelRoot />', 'a.css': '@container (max-width: 480px) { .a { gap: 0 } }' }).map((f) => f.rule)
    expect(ids).toEqual(['compact-layout'])
  })
})

describe('token-fallback', () => {
  it('flags a --dsh-panel-* var without a fallback, in CSS and in TS strings', () => {
    expect(tokensWithoutFallback('a { font-size: var(--dsh-panel-text-body); }')).toHaveLength(1)
    expect(tokensWithoutFallback('a { font-size: var(--dsh-panel-text-body, 13px); }')).toEqual([])
    expect(tokensWithoutFallback('a { color: var(--dsw-alias-label-primary); }')).toEqual([])
    const findings = rules({ 'View.tsx': `${goodTsx}const s = { fontSize: 'var(--dsh-panel-text-meta)' }\n` })
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([['token-fallback', 'error']])
    expect(findings[0]!.where).toMatch(/View\.tsx:3$/)
  })

  it('ignores a commented-out CSS token', () => {
    expect(rules({ 'View.tsx': goodTsx, 'a.css': '/* var(--dsh-panel-text-body) */ .a { gap: 0 }' })).toEqual([])
  })
})

describe('no-mobile-import', () => {
  it('flags a source import of the mobile package (any subpath) and a dependency on it', () => {
    const findings = rules(
      { 'View.tsx': `${goodTsx}import { x } from '@khorsheed/dsh-mobile/src/client/styles.ts'\n` },
      { ...adoptedJson, dependencies: { '@khorsheed/dsh-mobile': 'workspace:*' } },
    )
    expect(findings.map((f) => f.rule)).toEqual(['no-mobile-import', 'no-mobile-import'])
    expect(rules({ 'View.tsx': `${goodTsx}import { x } from '@khorsheed/dsh-mobile-extra'\n` })).toEqual([])
  })
})

describe('literal-color', () => {
  it('flags literals in declarations, not in var() fallbacks, selectors or url(#frag)', () => {
    const css = stripCssComments([
      '#app .a { color: #1f2329; }',
      '.b { background: var(--dsw-x, #fff); border-color: rgba(0, 0, 0, .1); }',
      '.c { fill: url(#grad); }',
      '.d { color: var(--y, rgb(1 2 3)); }',
    ].join('\n'))
    expect(literalColors(css).length).toBe(2)
  })

  it('is a warn and honours the allow-color marker on the line or the one above', () => {
    const findings = rules({ 'View.tsx': goodTsx, 'a.css': '.a { color: #123456; }\n/* panel-check: allow-color */\n.b { color: #abcdef; }\n.c { color: #000; } /* panel-check: allow-color */\n' })
    expect(findings.map((f) => [f.rule, f.severity, f.where.split(':').pop()])).toEqual([['literal-color', 'warn', '1']])
  })
})

describe('hover-only', () => {
  const hidden = '.row .tool { opacity: 0; }\n.row:hover .tool { opacity: 1; }\n'
  it('flags a hover-only reveal', () => {
    expect(hoverOnlyReveals(hidden)).toHaveLength(1)
  })
  it('stays quiet when the file handles touch', () => {
    expect(hoverOnlyReveals(`${hidden}@media (hover: none) { .tool { opacity: 1; } }`)).toEqual([])
    expect(hoverOnlyReveals(`${hidden}@media (pointer: coarse) { .tool { opacity: 1; } }`)).toEqual([])
  })
  it('ignores hover rules that reveal nothing hidden', () => {
    expect(hoverOnlyReveals('.a:hover { background: red; }\n.b:hover .c { opacity: 1; }')).toEqual([])
  })
})

describe('small-touch-text', () => {
  it('flags sub-13px literals only inside coarse-pointer or 560px blocks', () => {
    const css = [
      '.a { font-size: 11px; }',
      '@media (pointer: coarse) { .b { font-size: 12px; } .c { font-size: 13px; } }',
      '@container dsh-panel (max-width: 560px) { .d { font-size: 10.5px; } }',
      '@container (max-width: 800px) { .e { font-size: 9px; } }',
    ].join('\n')
    expect(smallTouchText(css)).toHaveLength(2)
  })
})

describe('fixed-overlay', () => {
  it('flags position: fixed unless allowed', () => {
    expect(fixedPositions('.a { position: fixed; }\n.b { position: absolute; }')).toHaveLength(1)
    const findings = rules({ 'View.tsx': goodTsx, 'a.css': '.a { position: fixed; } /* panel-check: allow-fixed */\n\n.b { position:fixed }\n' })
    expect(findings.map((f) => [f.rule, f.where.split(':').pop()])).toEqual([['fixed-overlay', '3']])
  })
})

describe('desktop-font', () => {
  it('flags font / font-size reading a host desktop size token, unless allowed', () => {
    const css = [
      '.a { font: var(--dsw-font-xxs-12); }',
      '.b { font-size: var(--dsw-font-xs-13-font-size, 13px); }',
      '.c { font: var(--dsw-font-xxxs-11); } /* panel-check: allow-desktop-font */',
      '.d { font-size: var(--dsh-panel-text-body, 13px); font-family: var(--dsw-font-family); }',
    ].join('\n')
    expect(desktopFonts(stripCssComments(css))).toHaveLength(3)
    const findings = rules({ 'View.tsx': goodTsx, 'a.css': css })
    expect(findings.map((f) => [f.rule, f.severity, f.where.split(':').pop()])).toEqual([['desktop-font', 'warn', '1'], ['desktop-font', 'warn', '2']])
  })
})

describe('container-match (built output)', () => {
  it('finds queried container names no declaration provides', () => {
    expect(unmatchedContainers('.a{container:dsh-panel/inline-size}@container dsh-panel (max-width:560px){.b{gap:0}}')).toEqual([])
    expect(unmatchedContainers('.a{container:Ab12_dsh-panel/inline-size}@container Cd34_dsh-panel (max-width:560px){.b{gap:0}}')).toEqual(['Cd34_dsh-panel'])
    expect(unmatchedContainers('.a{container-name:pane;container-type:inline-size}@container pane (width<560px){}')).toEqual([])
    expect(unmatchedContainers('@container (max-width:560px){.b{gap:0}}@container not (width>1px){}')).toEqual([])
    expect(unmatchedContainers('const s={containerName:"pane"};const c=`@container pane (max-width:560px){}`')).toEqual([])
  })

  function built(bundle: string | null, bundleAge: 'fresh' | 'stale' = 'fresh') {
    const { root, dir } = fixture({ 'View.tsx': goodTsx }, adoptedJson)
    if (bundle !== null) {
      mkdirSync(join(dir, 'lib'), { recursive: true })
      writeFileSync(join(dir, 'lib', 'client.js'), bundle)
      const at = bundleAge === 'stale' ? new Date(Date.now() - 3_600_000) : new Date(Date.now() + 3_600_000)
      utimesSync(join(dir, 'lib', 'client.js'), at, at)
    }
    return scanPanelPackage({ dir, json: { name: '@khorsheed/dsh-demo', ...adoptedJson } }, root).findings.filter((f) => f.rule === 'container-match')
  }

  it('is an error on a fresh bundle whose query names never meet a declaration', () => {
    const findings = built('.a{container:X_dsh-panel/inline-size}@container Y_dsh-panel (max-width:560px){}')
    expect(findings.map((f) => [f.severity, f.detail.includes('Y_dsh-panel')])).toEqual([['error', true]])
    expect(built('.a{container:dsh-panel/inline-size}@container dsh-panel (max-width:560px){}')).toEqual([])
  })

  it('is only an info with no bundle or a bundle older than the sources', () => {
    expect(built(null).map((f) => f.severity)).toEqual(['info'])
    expect(built('@container Y (max-width:560px){}', 'stale').map((f) => f.severity)).toEqual(['info'])
  })

  it('skips a not-yet-adopted package', () => {
    const { root, dir } = fixture({ 'View.tsx': goodTsx })
    expect(scanPanelPackage({ dir, json: { name: 'n' } }, root).findings.filter((f) => f.rule === 'container-match')).toEqual([])
  })
})

describe('one count, every output', () => {
  it('the per-package line, the summary and the JSON report the same numbers', () => {
    const bad = { 'View.tsx': 'export const View = () => null\n', 'a.css': '.a { color: #123456; position: fixed; }' }
    const a = fixture(bad, adoptedJson)
    const n = fixture(bad)
    const { reports, errors } = scanPanels([
      { dir: a.dir, json: { name: '@khorsheed/dsh-a', ...adoptedJson } },
      { dir: n.dir, json: { name: '@khorsheed/dsh-n' } },
    ], a.root)
    const totals = totalsOf(reports)
    expect(totals).toEqual({ errors: 2, warnings: 2, hints: 4 })
    expect(errors).toBe(totals.errors)
    const text = formatReport(reports, false)
    expect(text).toContain(`@khorsheed/dsh-a：已接入，${countReport(reports[0]!).errors} 个错误，${countReport(reports[0]!).warnings} 个提醒`)
    expect(text).toContain('@khorsheed/dsh-n：未接入（4 条提示）')
    expect(formatSummary(reports)).toContain('已接入包 2 个错误、2 个提醒；未接入包 4 条提示')
    const json = jsonReport(reports) as { errors: number; warnings: number; hints: number; reports: { errors: number; warnings: number }[] }
    expect([json.errors, json.warnings, json.hints]).toEqual([2, 2, 4])
    expect(json.reports.map((r) => [r.errors, r.warnings])).toEqual([[2, 2], [2, 2]])
  })
})

describe('adoption and exit semantics', () => {
  it("only an adopted package's errors count", () => {
    const bad = { 'View.tsx': 'export const View = () => null\n' }
    const a = fixture(bad, adoptedJson)
    const n = fixture(bad)
    const adopted = scanPanels([{ dir: a.dir, json: { name: 'a', ...adoptedJson } }], a.root)
    const notYet = scanPanels([{ dir: n.dir, json: { name: 'n' } }], n.root)
    expect(adopted.errors).toBe(2)
    expect(notYet.errors).toBe(0)
    expect(notYet.reports[0]!.adopted).toBe(false)
    expect(notYet.reports[0]!.findings).toHaveLength(2)
  })

  it('reports a not-yet-adopted package as one line unless asked for the full list', () => {
    const n = fixture({ 'View.tsx': 'export const View = () => null\n' })
    const { reports } = scanPanels([{ dir: n.dir, json: { name: '@khorsheed/dsh-n' } }], n.root)
    expect(formatReport(reports, false)).toBe('panels: @khorsheed/dsh-n：未接入（2 条提示）')
    expect(formatReport(reports, true)).toContain('[panel-root]')
  })

  it('lists only packages carrying dsh.client', () => {
    const { root } = fixture({ 'View.tsx': goodTsx })
    mkdirSync(join(root, 'packages', 'lib'), { recursive: true })
    writeFileSync(join(root, 'packages', 'lib', 'package.json'), JSON.stringify({ name: 'lib' }))
    expect(listClientPackages(join(root, 'packages')).map((p) => p.json.name)).toEqual(['@khorsheed/dsh-demo'])
  })
})

describe('the real tree', () => {
  it('has no error in an adopted package', () => {
    const root = join(import.meta.dirname, '..')
    const { reports, errors } = scanPanels(listClientPackages(join(root, 'packages')), root)
    const offending = reports.filter((r) => r.adopted).flatMap((r) => r.findings.filter((f) => f.severity === 'error').map((f) => `${r.name} ${f.rule} ${f.where}`))
    expect(offending).toEqual([])
    expect(errors).toBe(0)
    expect(reports.some((r) => r.adopted)).toBe(true)
  })
})
