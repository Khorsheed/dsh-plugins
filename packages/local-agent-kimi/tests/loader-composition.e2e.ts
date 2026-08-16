import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LOADER_SMOKE_TEST_TIMEOUT_MS,
  runLoaderSmoke,
} from '@deepseek-ai/dsh-loader-smoke'

const fixtureDir = fileURLToPath(new URL(
  '../../../../examples/acp-agent/tests/fixtures/subagent/subagent-kimi/',
  import.meta.url,
))
const driver = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'cordis.yml')
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('local-agent-kimi public Loader composition', () => {
  it('loads the family rows and the foreground tool without starting Kimi', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'local-agent-kimi Loader composition',
      tempDirPrefix: 'local-agent-kimi-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: {
        // Loading the bundle must not probe or start the Kimi binary.
        PATH: '',
      },
    })

    expect(stderr).toBe('')
    const parsed = JSON.parse(stdout) as { minimalTools?: string[] }
    // The tool row mounts at the profile root, so a minimal-preset agent's
    // tool view carries subagent_kimi — the cross-preset visibility the
    // variant removal guarantees.
    expect(parsed.minimalTools).toContain('subagent_kimi')
    expect(parsed).toEqual({
      registeredProviders: ['kimi-cli'],
      provider: {
        name: 'kimi-cli',
        capabilities: {
          outputSchema: false,
          depthLimit: false,
          toolFilter: false,
          persona: false,
        },
        inheritsParentContext: false,
      },
      harnesses: ['kimi'],
      kimiHome: join('.local-agent-homes', 'kimi'),
      tool: {
        name: 'subagent_kimi',
        parameterNames: ['description', 'prompt'],
        required: ['description', 'prompt'],
      },
      starts: 0,
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
