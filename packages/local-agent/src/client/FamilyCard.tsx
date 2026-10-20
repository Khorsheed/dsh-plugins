/**
 * The「本机 Agent 委派」family card: the core's single `plugins.item` entry on
 * the Plugins page, replacing the four per-harness cards. Each delegation
 * companion registers one section through the localAgentUi service's
 * `registerHarnessCard`; the page view renders the sections in their retired
 * standalone-card order, each under the collapsible chrome those cards used
 * (header button with aria-expanded, the credential dot, a chevron), plus a
 * grey「未检测到 CLI」tag when the harness's status probe answers without a
 * cliVersion. Sections mount their bodies only while expanded, exactly like
 * the standalone cards did.
 * @module @khorsheed/dsh-local-agent/client — family card
 */

import { useMemo, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the plugins.item list-slot SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import { AuthStatusDot } from './AuthStatusDot.tsx'
import { useHarnessAuthStatus } from './auth-status.ts'
import type { HarnessCardRegistration, HarnessCardRegistry, HarnessCardRenderProps } from './harness-cards.ts'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import { NS } from './locales.ts'
import css from './FamilyCard.module.css'

/** Injected face of the family card. */
export interface FamilyCardInjected {
  /** The registry the companions' sections live in (the localAgentUi service's registerHarnessCard writes here). */
  readonly harnessCards: HarnessCardRegistry
  /**
   * Per-harness status probe over the read-only gateway Remote. The Remote
   * declares `status(name, scope?)` and the api-gateway client enforces exact
   * arity, so the default scope is passed explicitly at the call site.
   */
  readonly harnessStatus: (name: string) => Promise<LocalAgentStatus | undefined>
}

/** Full props of the family card entry (owner prop `view`). */
export type LocalAgentFamilyCardProps =
  PropsRuntime<'plugins.item'>
  & InjectFace<FamilyCardInjected>
  & PropsLocale<typeof NS>

/** One registered harness's collapsible section: the header row plus its body. */
function HarnessSection({ entry, harnessStatus, useSessions, t }: {
  readonly entry: HarnessCardRegistration
  readonly harnessStatus: FamilyCardInjected['harnessStatus']
  readonly useSessions: HarnessCardRenderProps['useSessions']
  readonly t: PropsLocale<typeof NS>['t']
}) {
  const [open, setOpen] = useState(false)
  // One mount probe feeds both the header dot and the CLI-missing tag: the
  // wrapper keeps the answered payload (its effectiveSettings.cliVersion)
  // while the bus hook publishes the kind the dot reads — the same single
  // probe the retired standalone card headers ran.
  const [answered, setAnswered] = useState<LocalAgentStatus | undefined | null>(null)
  const probe = useMemo(() => async (name: string) => {
    const status = await harnessStatus(name)
    setAnswered(status ?? undefined)
    return status
  }, [harnessStatus])
  const authStatus = useHarnessAuthStatus(entry.name, probe)
  const dotLabel = t(
    authStatus === 'authenticated' ? 'settings.authenticated'
      : authStatus === 'anonymous' ? 'settings.notAuthenticated'
        : authStatus === 'checking' ? 'loading' : 'error',
  )
  const label = entry.label()
  // The tag fires only on an answered probe: an unanswered one (the harness
  // is absent host-side) already reads as the dot's unavailable state, and
  // "CLI not detected" would misreport it.
  const cliMissing = answered !== null && answered !== undefined && answered.effectiveSettings?.cliVersion === undefined
  return (
    <section className={open ? `${css.section} ${css.sectionOpen}` : css.section}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'family.collapse' : 'family.expand')}: ${label}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.nameRow}>
            <span className={css.name}>{label}</span>
            <AuthStatusDot status={authStatus} label={dotLabel} />
            {cliMissing && <span className={css.cliMissing}>{t('family.cliMissing')}</span>}
          </span>
        </span>
        <IconChevronDownOutlineMedium className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && entry.render({ active: true, useSessions })}
    </section>
  )
}

/**
 * The family card entry: the one-liner for the `summary` view, the section
 * stack for `page`.
 * @param props - the owner view, the injected registry/status faces, and copy.
 * @returns the entry.
 */
export function LocalAgentFamilyCard({ view, harnessCards, harnessStatus, useSessions, t }: LocalAgentFamilyCardProps) {
  useSyncExternalStore(harnessCards.subscribe, harnessCards.snapshotVersion)
  const sections = harnessCards.cards()
  if (view === 'summary') return <span className={css.description}>{t('family.description')}</span>
  return (
    <div className={css.sections}>
      {sections.length === 0 && <span className={css.empty}>{t('family.empty')}</span>}
      {sections.map(entry => (
        <HarnessSection key={entry.name} entry={entry} harnessStatus={harnessStatus} useSessions={useSessions} t={t} />
      ))}
    </div>
  )
}
