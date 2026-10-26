/**
 * The prompt budget (Agent Note 2026-10-26-library-slimming): every library
 * tool definition and the prompt section ride every request of a session
 * that holds the library. On 10-26 they were 65% of all tool definitions; the
 * budget keeps them from growing back.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../src/service.ts'
import { libraryToolDefinitions } from '../src/tool-definition.ts'
import { LIBRARY_PROMPT } from '../src/tool.ts'

const TOOLS_BUDGET = 12_000
const PROMPT_BUDGET = 1_250

let root: string | undefined
afterEach(() => { if (root !== undefined) rmSync(root, { recursive: true, force: true }) })

describe('prompt budget', () => {
  it('the ten tool definitions and the prompt section stay inside their budgets', () => {
    root = mkdtempSync(join(tmpdir(), 'lib-size-'))
    const ctx = { get: () => undefined, effect: () => () => {} } as unknown as Context
    const tools = libraryToolDefinitions(new LibraryService(ctx, { stateRoot: root }))
    const sizes = tools.map(tool => {
      const definition = tool as unknown as { name: string; description: string; parameters?: unknown; inputSchema?: unknown }
      return { name: definition.name, size: definition.description.length + JSON.stringify(definition.parameters ?? definition.inputSchema ?? {}).length }
    })
    const total = sizes.reduce((sum, entry) => sum + entry.size, 0)
    expect(total, sizes.map(entry => `${entry.name} ${entry.size}`).join(', ')).toBeLessThanOrEqual(TOOLS_BUDGET)
    expect(LIBRARY_PROMPT.length).toBeLessThanOrEqual(PROMPT_BUDGET)
  })
})
