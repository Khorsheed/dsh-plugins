/**
 * The session header's library chip: which project — or which of its books —
 * this learning session works on. The tools default `project` / `book` to it,
 * the per-turn context names it, and the sidebar's gestures bind it too, so
 * the chip mostly SHOWS the binding; its menu changes it.
 *
 * Shown only in sessions that hold the library tools (the strict half of the
 * visibility criterion), and it re-reads the binding while visible: the coach
 * binds through `library_binding` and nothing announces that here.
 *
 * @module @khorsheed/dsh-library/client/bind
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { LibraryBinding, LibraryOutcome, LibraryProjectSummary } from '../../types.ts'
import type {} from '../locales.ts'
import { IconChevronDownOutlineMedium } from '../icons.tsx'
import css from './BindChip.module.css'

/** One session's chip face (the header slot injects it per session). */
export interface LibraryBindInjected {
  offered: () => boolean
  subscribe: (listener: () => void) => () => void
  boundTarget: () => Promise<RemoteResult<LibraryBinding | null>>
  bindTarget: (binding: LibraryBinding | null) => Promise<RemoteResult<LibraryOutcome<{ binding: LibraryBinding | null }>>>
  listProjects: () => Promise<RemoteResult<{ projects: LibraryProjectSummary[] }>>
}

export interface LibraryBindChipProps extends LibraryBindInjected {
  readonly t: TranslateNS<'library'>
}

/** How often the chip re-reads a binding the coach may have moved. */
const BIND_POLL_MS = 4000

/** A binding's menu id. */
function idOf(binding: LibraryBinding): string {
  return binding.resourceId === undefined ? `project:${binding.projectId}` : `resource:${binding.projectId}:${binding.resourceId}`
}

export function LibraryBindChip(props: LibraryBindChipProps): ReactNode {
  const shown = useSyncExternalStore(props.subscribe, props.offered)
  return shown ? <BindMenu {...props} /> : null
}

function BindMenu({ t, boundTarget, bindTarget, listProjects }: LibraryBindChipProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [bound, setBound] = useState<LibraryBinding | null>(null)
  const [projects, setProjects] = useState<readonly LibraryProjectSummary[]>([])
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    const [current, list] = await Promise.all([boundTarget(), listProjects()])
    if (current.ok) setBound(current.value)
    if (list.ok) setProjects(list.value.projects)
  }, [boundTarget, listProjects])

  useEffect(() => { void reload().catch(() => {}) }, [reload])
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void boundTarget().then(current => { if (current.ok) setBound(current.value) }).catch(() => {})
    }, BIND_POLL_MS)
    return () => { clearInterval(timer) }
  }, [boundTarget])
  // A binding to something the chip has not listed yet (the coach just made it): list again.
  const unseen = bound !== null && !projects.some(project => project.id === bound.projectId
    && (bound.resourceId === undefined || project.resources.some(resource => resource.id === bound.resourceId)))
  useEffect(() => {
    if (!unseen) return
    void listProjects().then(list => { if (list.ok) setProjects(list.value.projects) }).catch(() => {})
  }, [unseen, listProjects])

  const pick = async (binding: LibraryBinding | null): Promise<void> => {
    const result = await bindTarget(binding)
    if (result.ok && result.value.ok) {
      setBound(result.value.binding)
      setFailed(false)
    } else {
      setFailed(true)
    }
  }

  const project = bound === null ? undefined : projects.find(candidate => candidate.id === bound.projectId)
  const resource = bound?.resourceId === undefined ? undefined : project?.resources.find(candidate => candidate.id === bound.resourceId)
  const title = resource?.title ?? project?.name
  const items: MenuEntry[] = [
    { type: 'label', id: 'heading', text: t('bind.heading') },
    ...projects.length === 0
      ? [{ id: 'empty', label: t('bind.empty'), disabled: true }]
      : projects.flatMap((entry): MenuEntry[] => [
        { id: `project:${entry.id}`, label: t('bind.wholeProject', { project: entry.name }) },
        // Only a thick entry (a book, a course) is bindable — a thin link carries no path.
        ...entry.resources.filter(entryResource => entryResource.kind === 'book' || entryResource.kind === 'course').map(entryResource => ({ id: `resource:${entry.id}:${entryResource.id}`, label: `　${entryResource.title}` })),
      ]),
    ...bound === null ? [] : [
      { type: 'separator' as const, id: 'sep' },
      { id: 'unbind', label: t('bind.unbind') },
    ],
  ]

  return (
    <Menu
      open={open}
      portal
      dense
      items={items}
      {...bound === null ? {} : { selectedId: idOf(bound) }}
      onSelect={id => {
        setOpen(false)
        if (id === 'unbind') void pick(null)
        else if (id.startsWith('project:')) void pick({ projectId: id.slice('project:'.length) })
        else if (id.startsWith('resource:')) {
          const [, projectId, resourceId] = id.split(':')
          if (projectId !== undefined && resourceId !== undefined) void pick({ projectId, resourceId })
        }
      }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <button
          type="button"
          className={css.trigger}
          data-bound={bound !== null}
          aria-label={t('bind.aria')}
          aria-haspopup="menu"
          aria-expanded={open}
          title={failed ? t('bind.failed') : undefined}
          onClick={() => {
            if (!open) void reload().catch(() => {})
            setOpen(value => !value)
          }}
        >
          <span className={css.label}>
            {failed ? t('bind.failed') : title === undefined ? t('bind.unbound') : t('bind.bound', { title })}
          </span>
          <IconChevronDownOutlineMedium size={12} />
        </button>
      )}
    />
  )
}
