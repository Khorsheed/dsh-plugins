import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

describe('local-agent-kimi bundle patch', () => {
  it('mounts the subagent_kimi tool at the profile root', () => {
    // The tool row sits beside the family rows (top-level insert), so every
    // agent preset — including minimal — delegates without per-preset
    // variants.
    expect(patch).toContain('- id: tool-subagent-kimi')
    expect(patch).toContain('provider: kimi-cli')
    expect(patch).toContain('toolName: subagent_kimi')
    expect(patch).toContain('enableRunInBackground: false')
  })

  it('no longer ships preset variants', () => {
    expect(patch).not.toMatch(/<.*>-kimi/)
    expect(patch).not.toContain('presets/kimi')
  })

  it('does not re-insert the family core row the framework bundle owns', () => {
    // The local-agent family core row (homesRoot config) ships in the
    // framework bundle @khorsheed/dsh-local-agent's own patch (a dependency
    // of this bundle); inserting a duplicate id here would mount two rows.
    expect(patch).not.toMatch(/- id: local-agent\n/)
  })
})
