import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

/** Composition lines only (comments stripped) — row content assertions read these. */
const composition = patch.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')

describe('local-agent-kimi bundle patch', () => {
  it('mounts exactly one row: the provider itself', () => {
    // Since the family fold, the `subagent_kimi` delegation tool is no longer
    // a profile-root row — it ships as this package's `./tool` composition
    // entry, granted per session by an agent preset that names
    // `@khorsheed/dsh-local-agent-kimi/tool` (the dev preset's
    // `tool-subagent-kimi` row). One provider = one card.
    expect(composition).toContain("- id: local-agent-kimi\n      name: '@khorsheed/dsh-local-agent-kimi'")
    expect(composition).not.toContain('tool-subagent')
    expect(composition).not.toContain('toolName')
  })

  it('never names the retired shared tool package', () => {
    // @khorsheed/dsh-local-agent-tool-subagent folded into the family core's
    // ./tool-factory export; scripts/retired-packages.ts bars the name from
    // every in-repo composition.
    expect(patch).not.toContain('local-agent-tool-subagent')
  })

  it('no longer references the official tool-subagent row or its config keys', () => {
    expect(patch).not.toContain('@deepseek-ai/dsh-tool-subagent')
    expect(patch).not.toContain('enableRunInBackground')
    expect(patch).not.toContain('maxDepth')
  })

  it('does not re-insert the family core row the framework bundle owns', () => {
    // The local-agent family core row (homesRoot config) ships in the
    // framework bundle @khorsheed/dsh-local-agent's own patch (a dependency
    // of this bundle); inserting a duplicate id here would mount two rows.
    expect(patch).not.toMatch(/- id: local-agent\n/)
  })
})
