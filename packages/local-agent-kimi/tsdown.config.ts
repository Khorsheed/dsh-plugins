import { clientBundle } from '../../build/tsdown.client.ts'

export default clientBundle('@khorsheed/dsh-local-agent-kimi', ['lib/types/index.js', 'lib/types/invariant.js'], {
  // pack-dist removes ordinary dependencies; native config parsing must ship
  // with the provider rather than resolve from a developer's workspace.
  lib: { deps: { alwaysBundle: ['smol-toml'] } },
})
