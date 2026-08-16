import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/whalesong-driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/whalesong/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('whalesong through a real cordis.yml', () => {
  it('serves the resolved config over the Loader-mounted webserver route', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'whalesong',
      tempDirPrefix: 'whalesong-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).not.toContain('UNHANDLED')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as {
      type: string
      status: number
      body: { enabled: boolean; volume: number }
    }
    expect(result).toEqual({ type: 'result', status: 200, body: { enabled: false, volume: 0.5 } })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
