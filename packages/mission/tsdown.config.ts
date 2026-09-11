/**
 * Package-local tsdown config via the shared helper: the host lib half
 * (index/invariant/cli/tool entries — `tool` is the definition factory the
 * companion row imports) plus the browser client bundle (lib/client.js, the
 * missions tab) through clientBundle — never hand-rolled.
 */
import { clientBundle } from '../../build/tsdown.client.ts'

export default clientBundle('@khorsheed/dsh-mission', ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/cli.js', 'lib/types/tool.js'])
