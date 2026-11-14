import { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import { resolveLaunchAccountToken } from './account-env.ts'

/**
 * Official account service scoped to a delegated launch. Model and web providers
 * keep their official authentication protocol; only token storage is replaced
 * by the parent's private launch grant. No child credential store is written.
 */
export default class DelegatedDeepSeekAccount extends DeepSeekAccount {
  override async resolveToken(url: string): Promise<string | undefined> {
    return resolveLaunchAccountToken(url)
  }

  /** The child cannot revoke the parent's grant; the next launch resolves it again. */
  override async rejectToken(_token: string): Promise<void> {}
}
