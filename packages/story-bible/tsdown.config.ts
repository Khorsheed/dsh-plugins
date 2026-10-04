import { clientBundle } from '../../build/tsdown.client.ts'

// The M3 browser half joins the identity triangle: the client bundle builds
// through the shared helper with the package's own id (the cordis.patch.yml
// row name and src/invariant.ts's PACKAGE_NAME say the same).
export default clientBundle('@khorsheed/dsh-story-bible', ['lib/types/index.js', 'lib/types/invariant.js'])
