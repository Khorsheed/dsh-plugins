/**
 * Preset-row block helpers for the eval parity spec
 * (scripts/eval-preset-parity.spec.ts).
 *
 * A preset row is compared as COMPOSITION, not bytes: copies of the same row
 * live in profiles/eval/presets and the eval mode pack (packages/eval-suite),
 * and they differ on purpose in comments (where the provenance notes sit) and
 * in quoting (some files quote every `name:` value, `'cordis:group'` included,
 * which YAML reads as the same string). Line- and indent-based, like
 * check-plugin-independence's patch parser — the repo ships no YAML parser.
 *
 * @module scripts/preset-row-blocks
 */
import { expect } from 'vitest'

/** One top-level preset row's lines, from `    - id: <row>` up to the next top-level row or row comment. */
export function rowLines(patch: string, row: string): string[] {
  const lines = patch.split('\n')
  const start = lines.indexOf(`    - id: ${row}`)
  expect(start, `${row} present`).toBeGreaterThanOrEqual(0)
  const next = lines.findIndex((line, index) => index > start && /^ {4}[-#]/.test(line))
  return lines.slice(start, next === -1 ? lines.length : next)
}

/** Strip one YAML scalar's single/double quotes (the only quoting either file uses). */
export const unquote = (value: string): string => value.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')

/**
 * The composition the loader reads: the row's `plugins:` lines with comment
 * lines, blank lines and trailing ` # …` comments dropped and every `name:`
 * value unquoted. Indentation is kept — it IS the structure.
 */
export function composition(lines: string[]): string[] {
  const at = lines.indexOf('        plugins:')
  expect(at, 'a plugins: key at row-config depth').toBeGreaterThan(0)
  return lines.slice(at + 1)
    .filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .map(line => line.replace(/\s+#\s.*$/, ''))
    .map(line => line.replace(/^(\s*name: )(.*)$/, (_m, key: string, value: string) => key + unquote(value)))
}

/** A row-config display field (`        <key>: value`), unquoted. */
export function field(lines: string[], key: string): string | undefined {
  const line = lines.find(l => l.startsWith(`        ${key}: `))
  return line === undefined ? undefined : unquote(line.slice(`        ${key}: `.length))
}
