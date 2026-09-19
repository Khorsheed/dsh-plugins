// @vitest-environment node
/**
 * I5·T63 — the copy gate: every dictionary key the browser half asks for
 * exists in BOTH locales.
 *
 * The client specs render with an identity `t` (it echoes the key), which is
 * exactly what a MISSING key renders as — so those tests are blind to the one
 * failure ui-spec §九 is about: a page showing `bucket.done` to a person
 * instead of a word. This one reads the sources, collects every literal key
 * they pass to `t(...)`, and checks it against both dictionaries. The keys that are NOT literals come from
 * `slotKey` / `roleKey` and from this tab's copy of the word table, whose
 * totality the 实验室 tab's `vocab.spec.ts` pins.
 *
 * Node environment on purpose: it reads files, renders nothing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

const CLIENT_DIR = new URL('../src/client/', import.meta.url).pathname

/** `t('some.key'` and `t(\`some.key\`` — the literal call sites, nothing computed. */
const CALL = /\bt\(\s*['`]([a-zA-Z][\w.-]*)['`]/g

/** Keys built from a template the caller controls (`slotKey` / `roleKey`). */
const COMPUTED = /^(?:slot|role)\./

function keysOf(file: string): string[] {
  // Comments hold example call sites (`{t('x.error')}: {message}` in the error
  // seat's own rationale), and an example is not a page.
  const source = readFileSync(join(CLIENT_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [...source.matchAll(CALL)].map(match => match[1] as string)
}

describe('every key the pages ask for is in both dictionaries', () => {
  const files = readdirSync(CLIENT_DIR).filter(name => name.endsWith('.tsx'))

  it('finds the call sites at all (a regex that matched nothing would pass vacuously)', () => {
    expect(files.length).toBeGreaterThan(5)
    expect(files.flatMap(keysOf).length).toBeGreaterThan(100)
  })

  for (const [name, dict] of [['zh', zh], ['en', en]] as const) {
    it(`${name}: no page asks for a key it lacks`, () => {
      const missing = new Set<string>()
      for (const file of files) {
        for (const key of keysOf(file)) {
          if (COMPUTED.test(key)) continue
          if (!(key in (dict as Record<string, string>))) missing.add(`${file}: ${key}`)
        }
      }
      expect([...missing]).toEqual([])
    })
  }

  it('the two dictionaries carry exactly the same key set', () => {
    // A key present in one locale and not the other is the same defect seen
    // from the other side: the page renders its key to half the readers.
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('every parameter a dictionary entry names is filled by both locales', () => {
    // `{count}` in zh and `{n}` in en is a blank in one of the two renderings.
    const params = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1] as string).sort()
    const drift: string[] = []
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      const a = params(zh[key])
      const b = params(en[key])
      if (a.join(',') !== b.join(',')) drift.push(`${String(key)}: zh {${a.join(',')}} vs en {${b.join(',')}}`)
    }
    expect(drift).toEqual([])
  })
})
