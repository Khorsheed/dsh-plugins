#!/usr/bin/env node
// scan-plugin.mjs — mechanized breakage-surface scan: run the parts of
// reference/breakage-checklist.md that reduce to probes, so Phase 2 starts
// from a deterministic hit list instead of hand grep.
//
//   node scan-plugin.mjs --plugin <plugin source dir> --host <host checkout/staging dir> [--json]
//
// The host dir is the NEW host's install (a staging dir or checkout with
// node_modules in place). Every check PROBES the target host — package
// presence, exports subpaths, declared types — rather than matching a
// hardcoded list of removed symbols, so the scanner does not rot as the host
// evolves. What cannot be probed is reported as "uncertain" (needs human
// judgement), never silently passed: zero false positives outranks recall.
//
// Checks (checklist item in brackets):
//   [1]  externalized value imports — every require("<pkg>[/sub]") in the
//        built client bundle must resolve to a package + export the host
//        still ships (the frozen module table answers these at load time)
//   [3]  deleted host packages — every @deepseek-ai/* specifier imported or
//        peer-depended on must exist in the host's node_modules
//   [2]  type-only imports of deleted packages are SKIPPED on purpose — they
//        are erased at build and are a compile-time-only, mechanical migration
//   [13] hardcoded browser-asset URLs — a literal /plugins/<id>/client.js in
//        sources breaks when the host changes its serving shape
//
// Exit code: 0 = no hits, 1 = hits found, 2 = usage error.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
function opt(name) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const PLUGIN = opt('plugin')
const HOST = opt('host')
const JSON_OUT = args.includes('--json')
if (!PLUGIN || !HOST || !existsSync(PLUGIN) || !existsSync(HOST)) {
  console.error('usage: scan-plugin.mjs --plugin <dir> --host <dir> [--json]')
  process.exit(2)
}

const hostModules = join(HOST, 'node_modules')
const findings = []
const hit = (file, line, surface, detail, fix) =>
  findings.push({ severity: 'hit', file, line, surface, detail, fix })
const uncertain = (file, line, surface, detail, fix) =>
  findings.push({ severity: 'uncertain', file, line, surface, detail, fix })

// ---- host probes ------------------------------------------------------------

function hostPackage(pkg) {
  const file = join(hostModules, pkg, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Hosts serve shared client modules two ways across lines: as installed
 * packages with a client half (the module table materializes their factory),
 * and as shell-seeded rows bundled into the web-frontend dist (0.1.2 moved
 * react-dom, dsh-client-ui-primitives, dsh-client-ui-slots there — they are
 * NOT in the host's node_modules anymore). Probe both seats.
 */
let distAssets
function shellSeeds() {
  if (distAssets === undefined) {
    distAssets = []
    for (const dir of [
      join(hostModules, '@deepseek-ai/dsh-web-frontend/dist/assets'),
      join(hostModules, '@deepseek-ai/dsh-web-frontend/dist'),
    ]) {
      let entries
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of entries) {
        if (name.endsWith('.js')) distAssets.push(readFileSync(join(dir, name), 'utf8'))
      }
      if (distAssets.length > 0) break
    }
  }
  return distAssets
}

/** Is this exact specifier a shell-seeded module-table row? */
function seededInShell(spec) {
  const quoted = `"${spec}"`
  return shellSeeds().some((text) => text.includes(quoted))
}

/** Does the host package still serve this subpath import? */
function hostServesSubpath(pkg, subpath) {
  const json = hostPackage(pkg)
  if (json === undefined) return false
  if (!subpath) return true
  const key = `./${subpath}`
  const exportsField = json.exports
  if (exportsField === undefined) {
    // No exports map: fall back to file existence for common layouts.
    return ['lib', 'src'].some((dir) =>
      ['js', 'mjs', 'ts', 'd.ts'].some((ext) => existsSync(join(hostModules, pkg, dir, `${subpath}.${ext}`))),
    )
  }
  if (typeof exportsField === 'string') return false
  return Object.keys(exportsField).includes(key)
}

/** Can the new host answer this client-module specifier at load time? */
function hostAnswers(spec) {
  const { pkg, subpath } = splitSpecifier(spec)
  if (hostPackage(pkg) !== undefined && hostServesSubpath(pkg, subpath)) return true
  // Shell-seeded rows: the seed map keys are exact specifiers; a trailing
  // /client normalizes away (the loader strips it), so probe both spellings.
  if (seededInShell(spec)) return true
  if (spec.endsWith('/client') && seededInShell(spec.slice(0, -7))) return true
  return false
}

/** Specifiers the browser will ask the frozen module table for. */
function externalizedRequires(bundleSource) {
  const out = new Map()
  const re = /require\("([^".][^"]*)"\)/g
  for (const m of bundleSource.matchAll(re)) if (!out.has(m[1])) out.set(m[1], m.index)
  return out
}

function splitSpecifier(spec) {
  const parts = spec.split('/')
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const subpath = spec.startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/')
  return { pkg, subpath }
}

// ---- plugin surfaces ----------------------------------------------------------

const pluginJson = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'))
const pluginName = pluginJson.name ?? PLUGIN

function* walkSources(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walkSources(p)
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) yield p
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

// [1] externalized value imports in the built client bundle
const clientDecl = pluginJson.dsh?.client
const clientExport = pluginJson.exports?.['./client']
const clientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default
const bundleRequires = new Set()
if (clientDecl !== undefined || clientPath !== undefined) {
  const bundle = (clientPath ?? 'lib/client.js').replace(/^\.\//, '')
  const bundlePath = join(PLUGIN, bundle)
  if (existsSync(bundlePath)) {
    const source = readFileSync(bundlePath, 'utf8')
    for (const [spec, index] of externalizedRequires(source)) {
      bundleRequires.add(spec)
      if (!hostAnswers(spec)) {
        hit(bundle, lineOf(source, index), 'externalized value import',
          `require("${spec}"): the new host answers this from neither node_modules nor the frontend shell's seed table — the bundle throws at load`,
          'checklist #1; fix per dual-host-fix-patterns (inline the value, or probe both seats)')
      }
    }
  } else {
    uncertain(bundle, 0, 'externalized value import',
      'package declares a browser half but the bundle is not built here — build it, or scan the packed artifact',
      'run the package build, then re-scan')
  }
}

// [3]/[2] host-package references in sources. Type-only imports are erased at
// build (checklist #2 — mechanical, compile-time-only) and are skipped; a
// `declare module` augmentation is type-only too. For VALUE imports the seat
// matters: the browser half is answered by the module table (node_modules OR
// shell seed), the node half resolves from node_modules only.
const HOST_SCOPE = /^@deepseek-ai\//
const importRe = /(^|\n)[ \t]*import\s+(type\s+)?([^'"]*?)from\s*['"](@deepseek-ai\/[^'"]+)['"]|(^|\n)[ \t]*(?:import\s*|require\()\s*['"](@deepseek-ai\/[^'"]+)['"]/g
const declareModuleRe = /declare\s+module\s+['"](@deepseek-ai\/[^'"]+)['"]/g
const seen = new Set()
for (const file of walkSources(join(PLUGIN, 'src'))) {
  const source = readFileSync(file, 'utf8')
  const rel = file.slice(PLUGIN.length + 1)
  const clientFace = /(^|\/)client\//.test(rel)
  for (const m of source.matchAll(declareModuleRe)) seen.add(`declare:${m[1]}:${rel}`)
  for (const m of source.matchAll(importRe)) {
    // Type-only iff `import type ...`, or a braces-only clause whose every
    // specifier is type-marked (`import { type A, type B }` erases at build;
    // a mixed `import { type A, b }` keeps a runtime binding and counts).
    const clause = m[3] ?? ''
    const typeOnly = m[2] !== undefined
      || (clause.trim().startsWith('{')
        && clause.trim().slice(1, -1).split(',').every((sp) => sp.trim().startsWith('type ')))
    const spec = m[4] ?? m[6]
    if (typeOnly) continue // checklist #2: compile-time-only migration
    if (seen.has(`${spec}:${rel}`)) continue
    seen.add(`${spec}:${rel}`)
    const { pkg, subpath } = splitSpecifier(spec)
    const line = lineOf(source, m.index)
    if (hostPackage(pkg) !== undefined) {
      if (hostServesSubpath(pkg, subpath)) continue
      uncertain(rel, line, 'host export subpath',
        `imports ${spec}; the host ships ${pkg} but ./${subpath} is not in its exports map`,
        'checklist #1/#2; confirm against the new host source — may be a moved entry point')
      continue
    }
    // Package gone from the host's node_modules.
    if (clientFace) {
      if (bundleRequires.has(spec)) continue // already a [1] hit on the bundle
      if (hostAnswers(spec)) continue // shell-seeded row still answers it
      uncertain(rel, line, 'deleted host package (client face)',
        `value-imports ${spec}, gone from the new host's node_modules and not shell-seeded; the import is absent from the built bundle — confirm it is inlined or tree-shaken, not silently broken`,
        'checklist #1/#3; if the value is actually used, inline it per dual-host-fix-patterns')
    } else {
      hit(rel, line, 'deleted host package',
        `value-imports ${spec}, which the target host no longer ships — the node half resolves this from node_modules and will throw at apply/load`,
        'checklist #3; grep the whole repo for this name — one leftover is a load-time crash')
    }
  }
}

// [3] peerDependencies on host packages. A peer whose package vanished from
// the host is an install-time hazard, not a proof of breakage: npm may still
// drag the OLD line's published copy from the registry, and runtime impact
// depends on whether the import was type-only — so: uncertain, human confirms.
for (const [dep, range] of Object.entries(pluginJson.peerDependencies ?? {})) {
  if (!HOST_SCOPE.test(dep)) continue
  if (hostPackage(dep) !== undefined) continue
  if (seededInShell(dep)) {
    uncertain('package.json', 0, 'host package moved into the shell',
      `peerDependencies."${dep}": "${range}" — no longer installed standalone on the target host; its module-table row moved into the frontend shell`,
      'checklist #3; the runtime row still answers, but re-target or drop the peer for the new line')
  } else {
    uncertain('package.json', 0, 'deleted host package (peer dependency)',
      `peerDependencies."${dep}": "${range}" — the target host no longer ships this package; install will drag the OLD line's registry copy (or fail on a private registry)`,
      'checklist #3; if every import of it is type-only, drop or re-target the peer for the new line')
  }
}

// [13] hardcoded browser-asset URLs
const urlRe = /["'`]\/plugins\/[^"'`]*client\.js/
for (const dir of ['src', 'lib']) {
  for (const file of walkSources(join(PLUGIN, dir))) {
    const source = readFileSync(file, 'utf8')
    const m = urlRe.exec(source)
    if (m) {
      hit(file.slice(PLUGIN.length + 1), lineOf(source, m.index), 'browser asset URL',
        `hardcoded bundle URL "${m[0]}" — the serving shape is host contract and differs across lines`,
        'checklist #13; take bundle URLs from the boot manifest, never hardcode')
    }
  }
}

// ---- report -------------------------------------------------------------------

const hostVersion = (() => {
  for (const pkg of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base']) {
    const json = hostPackage(pkg)
    if (json?.version) return json.version
  }
  return 'unknown'
})()

if (JSON_OUT) {
  console.log(JSON.stringify({ plugin: pluginName, host: HOST, hostVersion, findings }, null, 2))
} else {
  console.log(`# scan: ${pluginName} → ${HOST} (host ${hostVersion})`)
  const hits = findings.filter((f) => f.severity === 'hit')
  const unsure = findings.filter((f) => f.severity === 'uncertain')
  for (const f of [...hits, ...unsure]) {
    console.log(`${f.severity.toUpperCase()}  ${f.file}:${f.line} — ${f.surface}\n  ${f.detail}\n  fix: ${f.fix}`)
  }
  console.log(`\n${hits.length} hit(s), ${unsure.length} uncertain — surfaces not probeable statically (slots, remotes, settings schemas, DOM anchors, prompt orders) still need the manual checklist in reference/breakage-checklist.md`)
}

process.exit(findings.some((f) => f.severity === 'hit') ? 1 : 0)
