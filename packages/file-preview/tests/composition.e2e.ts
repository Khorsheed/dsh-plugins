import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { FilePreviewList, FilePreviewRead } from '@deepseek-ai/dsh-file-preview/types'

const driver = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/file-preview-driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/file-preview/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('file-preview through a real cordis.yml', () => {
  it('lists the session files and reads current content through the Loader-mounted service', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'file-preview',
      tempDirPrefix: 'file-preview-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).not.toContain('UNHANDLED')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as {
      list: FilePreviewList
      read: FilePreviewRead
    }
    expect(result.list.entries).toEqual([
      {
        path: 'notes.md',
        op: 'read',
        seq: 3,
        turn: 2,
        step: 1,
        lastDiff: { oldText: 'hi', newText: 'hello' },
      },
    ])
    expect(result.read).toMatchObject({ path: 'notes.md', kind: 'text', content: 'hello world', truncated: false })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
