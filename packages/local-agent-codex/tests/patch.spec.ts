import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

describe('local-agent-codex bundle patch', () => {
  it('mounts the family-owned tool at the profile root under the model-facing name', () => {
    // The tool row sits at the profile root (top-level insert), so every
    // agent preset — including minimal — delegates without per-preset
    // variants. The family takes the official toolName: the official row
    // ships disabled in the presets, and this patch disables it too.
    expect(patch).toContain('- id: tool-subagent-codex-local')
    expect(patch).toContain("name: '@khorsheed/dsh-local-agent-tool-subagent'")
    expect(patch).toContain('provider: codex-local')
    expect(patch).toContain('toolName: subagent_codex\n')
  })

  it('disables the official tool row so a community install never collides', () => {
    expect(patch).toContain('- id: tool-subagent-codex\n  disabled: true')
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
