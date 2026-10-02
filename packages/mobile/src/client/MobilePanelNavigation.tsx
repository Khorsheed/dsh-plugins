import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MobileIcon } from './MobileIcon.tsx'
import type { MobilePanels } from './panels.ts'

export function MobilePanelNavigation({ panels, active, prepareNavigation, t }: { panels: MobilePanels; active: boolean; prepareNavigation: () => void } & PropsLocale<'mobile'>) {
  const state = useSyncExternalStore(panels.subscribe, panels.getSnapshot)
  const managed = active && state.managed
  const navigation = useRef<HTMLElement>(null)
  const prepare = useRef(prepareNavigation)
  prepare.current = prepareNavigation
  useEffect(() => {
    document.documentElement.toggleAttribute('data-mobile-panel-managed', managed)
    document.documentElement.toggleAttribute('data-mobile-panel-open', managed && state.expanded)
    return () => { document.documentElement.removeAttribute('data-mobile-panel-managed'); document.documentElement.removeAttribute('data-mobile-panel-open') }
  }, [managed, state.expanded])
  useEffect(() => {
    if (!managed || !state.expanded) return
    const main = document.querySelector<HTMLElement>('[data-mobile-frame] > div:has(> [data-slot="main"])')
    const previous = main?.inert
    if (main) main.inert = true
    const nav = navigation.current
    nav?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open],[role=dialog],[role=menu]') || document.activeElement?.tagName === 'SELECT') return
      prepare.current(); panels.hide()
    }
    window.addEventListener('keydown', escape)
    return () => {
      if (main) main.inert = previous ?? false
      window.removeEventListener('keydown', escape)
      if (document.activeElement === document.body || (document.activeElement && nav?.contains(document.activeElement))) {
        document.querySelector<HTMLButtonElement>('[data-mobile-panel-entry]')?.focus({ preventScroll: true })
      }
    }
  }, [managed, state.expanded, panels])
  useEffect(() => {
    if (!managed || !state.expanded) return
    navigation.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [managed, state.expanded, state.activeId])
  if (!managed || !state.expanded) return null
  return <nav ref={navigation} data-mobile-panel-navigation aria-label={t('panels')}>
    <button type="button" aria-label={t('backToChat')} onClick={() => { prepareNavigation(); panels.hide() }}><MobileIcon name="back"/></button>
    <div role="tablist" aria-label={t('switchPanel')} data-mobile-panel-tabs onKeyDown={event => {
      const index = state.tabs.findIndex(tab => tab.id === state.activeId)
      const next = event.key === 'ArrowRight' ? (index + 1) % state.tabs.length
        : event.key === 'ArrowLeft' ? (index + state.tabs.length - 1) % state.tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? state.tabs.length - 1 : -1
      const target = state.tabs[next]
      if (!target) return
      event.preventDefault(); panels.select(target.id)
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus({ preventScroll: true })
    }}>
      {state.tabs.map(tab => <button key={tab.id} type="button" role="tab" title={tab.title || tab.kind}
        aria-selected={tab.id === state.activeId} tabIndex={tab.id === state.activeId ? 0 : -1}
        onClick={() => panels.select(tab.id)}>{tab.title || tab.kind}</button>)}
    </div>
    <button type="button" aria-label={t('addPanel')} onClick={panels.add}><MobileIcon name="plus"/></button>
    <button type="button" aria-label={t('closePanel')} disabled={state.tabs.length === 1 && state.tabs[0]?.kind === 'guide'} onClick={panels.close}><MobileIcon name="close"/></button>
    {state.failed && <span role="alert" data-mobile-panel-error>{t('panelError')}</span>}
  </nav>
}

export function MobilePanelEntry({ panels, beforeOpen, t }: { panels: MobilePanels; beforeOpen: () => void } & PropsLocale<'mobile'>) {
  const state = useSyncExternalStore(panels.subscribe, panels.getSnapshot)
  if (!state.available) return null
  return <button type="button" data-mobile-panel-entry aria-label={t('panels')} aria-expanded={state.expanded}
    onClick={() => { beforeOpen(); panels.toggle() }}><MobileIcon name="panel"/></button>
}
