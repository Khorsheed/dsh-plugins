/**
 * CSS modules scope `@container` names per file: a query naming a container
 * declared in ANOTHER module compiles to a different hashed name and silently
 * never matches (T90's review page stayed two-column at phone width that way).
 * Every named container query must name a container its own file declares.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(import.meta.dirname, '..', 'src', 'client')
const modules = readdirSync(dir).filter(file => file.endsWith('.module.css'))

describe('container queries', () => {
  it.each(modules)('%s queries only containers it declares', (file) => {
    const css = readFileSync(join(dir, file), 'utf8')
    const declared = new Set([...css.matchAll(/container(?:-name)?\s*:\s*([A-Za-z][\w-]*)/g)].map(match => match[1]))
    const queried = [...css.matchAll(/@container\s+([A-Za-z][\w-]*)\s*\(/g)].map(match => match[1])
    expect(queried.filter(name => !declared.has(name))).toEqual([])
  })
})
