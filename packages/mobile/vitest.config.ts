import { dshTestConfig } from '../../build/vitest.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'

const config = dshTestConfig()
const harness = process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness')
export default {
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...config.resolve?.alias,
      '@deepseek-ai/dsh-client-connection/src/rpc-host': join(harness, 'packages/client/connection/src/rpc-host.ts'),
    },
  },
}
