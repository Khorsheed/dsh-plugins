import { clientBundle } from '../../build/tsdown.client.ts'

/**
 * Whalesong client-only bundle. The node half (lib/index.js + lib/invariant.js)
 * is a no-op mount anchor whose Loader entry row lets the client-modules scan
 * discover the browser half; the browser client bundle (lib/client.js) is
 * served by the web GUI at /plugins/@deepseek-ai/dsh-whalesong/client.js. The
 * bundle id must equal the cordis entry name (client-modules/system.ts rejects
 * mismatched handoffs).
 */
export default clientBundle('@deepseek-ai/dsh-whalesong', ['lib/types/index.js', 'lib/types/invariant.js'])
