import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Brand-seat replacement only. The official hero picker and editor retain ownership. */
export function MobileWelcome({ t }: PropsLocale<'mobile'>) {
  return <div data-mobile-welcome><small>DSH</small><h2>{t('welcome')}</h2><p>{t('welcomeHint')}</p></div>
}
