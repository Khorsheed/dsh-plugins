import { homedir } from 'node:os'
import { join } from 'node:path'
import { mergeConfig } from 'vitest/config'
import { dshTestConfig } from '../../build/vitest.ts'

// Exercise the host's actual history continuity check across member restore.
// The host does not path-map this internal class in its public source aliases.
export default mergeConfig(dshTestConfig(), {
  resolve: { alias: {
    '@deepseek-ai/dsh-api-session-controller/src/history.ts': join(
      process.env['DSH_HARNESS'] ?? join(homedir(), 'code/deepseek-harness'),
      'packages/api/session-controller/src/history.ts',
    ),
  } },
})
