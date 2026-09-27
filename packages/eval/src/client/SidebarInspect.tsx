/**
 * 查看 in the host's right sidebar (T85 §三 / T86 step 2): the body of the
 * `eval-inspect` page tab and its live chip title.
 *
 * The host opens one tab of this kind per pane and re-navigates it on every
 * further `openTab`, bumping `navigation.revision`; the pane keeps its own back
 * stack over those navigations. The stack is remembered per session in this
 * browser's storage, because 0.1.7 restores the tab after a reload but not its
 * params — without the memory a reload would leave an empty tab.
 *
 * This package does not depend on `@deepseek-ai/dsh-client-ui-sidebar-right`
 * (a profile without it must still load the lab), so the host's tab info is
 * read through the structural {@link TabInfoLike}.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { LabViewProps } from './contract.ts'
import { InspectPane, inspectTitle, type InspectReads } from './InspectPane.tsx'
import {
  isInspectTarget, pushTarget, readInspectMemory, rememberTarget, stackForNavigation, targetKey, writeInspectMemory,
  type InspectTarget,
} from './inspect-target.ts'

type T = LabViewProps['t']

/** The part of the host's `SidebarRightTabInfo` this body reads. */
export interface TabInfoLike {
  tab: {
    id: string
    title: string
    navigation: { params?: unknown; revision: number }
    actions: { close(): void }
  }
}

/** The chip titles the bodies report, keyed by host tab id. */
export interface InspectTitles {
  set(tabId: string, title: string): void
  use(tabId: string): string | undefined
}

/** A small external store for {@link InspectTitles}. */
export function createInspectTitles(): InspectTitles {
  const titles = new Map<string, string>()
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    set(tabId, title) {
      if (titles.get(tabId) === title) return
      titles.set(tabId, title)
      for (const listener of listeners) listener()
    },
    use(tabId) {
      return useSyncExternalStore(subscribe, () => titles.get(tabId))
    },
  }
}

/** The target a navigation carries, or null (none given, or a shape this build cannot draw). */
function navigationTarget(params: unknown): InspectTarget | null {
  if (typeof params !== 'object' || params === null) return null
  const target = (params as { target?: unknown }).target
  return isInspectTarget(target) ? target : null
}

/** What the slot hands the body, plus this package's inject. */
export interface SidebarInspectProps {
  sessionId: SessionId
  useTabInfo: () => TabInfoLike
  t: T
  reads: InspectReads
  titles: InspectTitles
}

/**
 * The sidebar body: the pane over a stack that follows the host's navigations.
 * @param props - the slot props.
 */
export function SidebarInspect(props: SidebarInspectProps): ReactNode {
  const { sessionId, useTabInfo, t, reads, titles } = props
  const { tab } = useTabInfo()
  const tabId = tab.id
  const revision = tab.navigation.revision
  const target = navigationTarget(tab.navigation.params)
  const key = target === null ? null : targetKey(target)
  const [view, setView] = useState(() => {
    const memory = readInspectMemory(sessionId)
    return { stack: stackForNavigation(memory, tabId, revision, target), recent: memory?.recent ?? [] }
  })
  // The navigation the state last applied; the first render already did.
  const applied = useRef({ tabId, revision, key })

  const save = useCallback((stack: InspectTarget[], recent: InspectTarget[]) => {
    writeInspectMemory(sessionId, { tabId, revision: applied.current.revision, applied: applied.current.key, stack, recent })
  }, [sessionId, tabId])

  useEffect(() => {
    const last = applied.current
    if (last.tabId === tabId && last.revision === revision && last.key === key) return
    applied.current = { tabId, revision, key }
    const memory = readInspectMemory(sessionId)
    setView(view => ({
      stack: stackForNavigation(
        memory ?? { tabId: last.tabId, revision: last.revision, applied: last.key, stack: view.stack, recent: view.recent },
        tabId, revision, target,
      ),
      recent: view.recent,
    }))
    // `target` is read through `key`; its identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, tabId, revision, key])

  const top = view.stack.at(-1)
  const title = inspectTitle(top, t)
  useEffect(() => { titles.set(tabId, title) }, [titles, tabId, title])
  // Every view the pane settles on is remembered, and so is the stack.
  const topKey = top === undefined ? null : targetKey(top)
  useEffect(() => {
    setView(view => {
      const current = view.stack.at(-1)
      const recent = current === undefined ? view.recent : rememberTarget(view.recent, current)
      save(view.stack, recent)
      return recent === view.recent ? view : { stack: view.stack, recent }
    })
  }, [topKey, view.stack, save])

  return (
    <InspectPane
      stack={view.stack}
      recent={view.recent}
      reads={reads}
      sessionId={sessionId}
      onPush={(next) => { setView(view => ({ ...view, stack: pushTarget(view.stack, next) })) }}
      onReplace={(next) => { setView(view => ({ ...view, stack: [...view.stack.slice(0, -1), next] })) }}
      onBack={() => { setView(view => ({ ...view, stack: view.stack.slice(0, -1) })) }}
      onClose={() => { tab.actions.close() }}
      t={t}
    />
  )
}

/** The props of the chip title seat. */
export interface SidebarInspectTitleProps {
  useTabInfo: () => TabInfoLike
  titles: InspectTitles
}

/**
 * The chip: the page on top, once the body has drawn it; the captured type title until then.
 * @param props - the slot props.
 */
export function SidebarInspectTitle(props: SidebarInspectTitleProps): ReactNode {
  const { tab } = props.useTabInfo()
  return <>{props.titles.use(tab.id) ?? tab.title}</>
}
