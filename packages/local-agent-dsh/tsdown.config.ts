import { clientBundle } from '../../build/tsdown.client.ts'

export default clientBundle('@khorsheed/dsh-local-agent-dsh', [
  'lib/types/index.js',
  'lib/types/invariant.js',
  'lib/types/records.js',
  'lib/types/provision.js',
  'lib/types/dsh-cli-provider.js',
])
