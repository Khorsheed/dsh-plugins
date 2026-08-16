/**
 * Package-local tsdown config: node half + client bundle via the official
 * clientBundle helper (generates the __ModuleLoader__.load registration the
 * web shell requires, plus the client.js bundle).
 */
import { clientBundle } from '../../build/tsdown.client.ts'

export default clientBundle('@khorsheed/dsh-client-message-tools', ['lib/types/index.js'])
