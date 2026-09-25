import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'

/**
 * Guard the bundle patch against the entry-list dialect's sharpest edge:
 * `!!js` is a SCALAR tag (harness `vendor/include/src/index.ts` — the same
 * definition is mirrored below), so tagging a flow/block sequence throws at
 * profile BOOT, before any plugin code runs. A patch that boots nothing must
 * fail here first: parse with the same scalar-only rule.
 *
 * Incident pinned: 2026-08-20, the member-bridge row shipped
 * `args: !!js [...]` (tag on a flow sequence) and took down the whole profile
 * on boot; the fix wraps each expression in a block-sequence entry instead.
 * This spec fails on any regression of that class.
 */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

interface PatchEntry {
  id?: string
  name?: string
  disabled?: unknown
  config?: Record<string, unknown>
}
interface PatchRow {
  id?: string
  config?: Record<string, unknown>
  disabled?: unknown
  insert?: PatchEntry[]
}

function loadPatch(): PatchRow[] {
  return yaml.load(readFileSync(patchPath, 'utf8'), { schema }) as PatchRow[]
}

describe('dsh-local-agent-dsh-headless bundle patch', () => {
  it('parses under the entry-list dialect (!!js on scalars only)', () => {
    expect(() => loadPatch()).not.toThrow()
  })

  it('mounts the member bridge with its per-run env contract intact', () => {
    const rows = loadPatch()
    const inserted = rows.flatMap(row => row.insert ?? [])
    const bridge = inserted.find(entry => entry.id === 'member-bridge')
    expect(bridge?.name).toBe('@deepseek-ai/dsh-mcp-client')
    const config = bridge?.config
    expect(config?.failOnStartupError).toBe(false)
    // Every dynamic value is a tagged SCALAR expression — the flow-sequence
    // form (`args: !!js [...]`) never reaches the loader again.
    for (const arg of config?.args as unknown[]) {
      expect(arg).toHaveProperty('__jsExpr')
    }
    const env = config?.env as Record<string, unknown>
    expect(env.DSH_MEMBER_SOCKET).toHaveProperty('__jsExpr')
    expect(env.DSH_MEMBER_TOKEN).toHaveProperty('__jsExpr')
  })

  it('pins the ptc-runtime insert row id — the documented web-composition collision', () => {
    // 2026-08-23 P0: mounted into the prod web profile (reconcilePlugins
    // auto-mounts dsh.bundle direct deps), this row hit the web-app bundle's
    // same-id row and the duplicate entry id failed the whole instance's
    // boot. (The row tracked the official code-runtime → ptc-runtime rename;
    // the collision semantics are unchanged.) The id is pinned so a rename or
    // removal is a conscious act that revisits docs/upstream-seam-registry.md
    // S9, never a silent edit.
    const inserted = loadPatch().flatMap(row => row.insert ?? [])
    const ptcRuntime = inserted.find(entry => entry.id === 'ptc-runtime')
    expect(ptcRuntime?.name).toBe('@deepseek-ai/dsh-ptc-runtime-node')
  })
})
