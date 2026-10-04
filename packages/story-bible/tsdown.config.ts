import { clientLibrary } from '../../build/tsdown.client.ts'

// M1 is host-only (no dsh.client browser half), so the shared helper's
// client-bundle arm does not apply; `clientLibrary` emits the node-half lib
// artifacts and stamps the same package id the identity triangle checks.
export default clientLibrary('@khorsheed/dsh-story-bible', ['lib/types/index.js', 'lib/types/invariant.js'])
