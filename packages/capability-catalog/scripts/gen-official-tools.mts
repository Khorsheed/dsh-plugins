#!/usr/bin/env node
/** Generate official-tools.ts by scanning the pinned harness checkout. */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HARNESS = process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness')
const PACKAGES = join(HARNESS, 'packages')
const OUT = new URL('../src/official-tools.ts', import.meta.url)

function toolNamesFromSource(source: string): string[] {
  const names: string[] = []
  const re = /ctx\.tools\.register\(\s*defineTool\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const start = m.index + m[0].length
    let depth = 1
    let i = start
    for (; i < source.length && depth > 0; i++) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    const block = source.slice(start, i)
    const nm = /name:\s*'([^']+)'/.exec(block)
    if (nm?.[1]) names.push(nm[1])
  }
  return names
}

function collect(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'lib' || entry === 'tests') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collect(full))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

const names = new Set<string>()
for (const p of collect(PACKAGES)) {
  for (const n of toolNamesFromSource(readFileSync(p, 'utf8'))) names.add(n)
}
const sorted = [...names].sort()
const content = '/** Generated from the pinned harness checkout — do not edit by hand. Run scripts/gen-official-tools.mts. */\nexport const OFFICIAL_TOOLS: readonly string[] = ' + JSON.stringify(sorted, null, 2) + '\n'
writeFileSync(OUT, content)
console.log(`official-tools: ${sorted.length} names -> ${OUT.pathname}`)
