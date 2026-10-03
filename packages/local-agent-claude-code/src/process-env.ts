import { userInfo } from 'node:os'
import { delegationEnv } from '@khorsheed/dsh-local-agent'

/** Keep macOS login and native credential reads on the same keychain account. */
export function claudeKeychainEnv(): NodeJS.ProcessEnv {
  if (process.platform !== 'darwin') return {}
  try { return { USER: process.env.USER || userInfo().username } }
  catch { return {} }
}

/** Host Claude only: retain the family allowlist, explicitly restoring its keychain identity. */
export function claudeProcessEnv(extra: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return delegationEnv({ ...extra, ...claudeKeychainEnv() })
}
