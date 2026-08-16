import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

describe('local-agent-codex bundle patch', () => {
  it('mounts the subagent_codex_local tool at the profile root', () => {
    // The tool row sits at the profile root (top-level insert), so every
    // agent preset — including minimal — delegates without per-preset
    // variants.
    expect(patch).toContain('- id: tool-subagent-codex-local')
    expect(patch).toContain('provider: codex-local')
    expect(patch).toContain('toolName: subagent_codex_local')
    expect(patch).toContain('enableRunInBackground: false')
  })

  it('does not re-insert the family core row the kimi bundle owns', () => {
    // The local-agent family core row (homesRoot config) ships in the kimi
    // bundle's patch; inserting a duplicate id here would mount two rows.
    expect(patch).not.toMatch(/- id: local-agent\n/)
  })
})
