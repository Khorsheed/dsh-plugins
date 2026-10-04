/**
 * The fragments tab: the work strip, the five-view switcher and the active
 * view, with the pending queue pinned at the bottom. All five views read
 * through the same story Remote (同源) and share the shell's
 * registry/focus/counts; the tab holds nothing but the composition.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { ReactNode } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StoryTabProps } from './contract.ts'
import { useWorkShell } from './data.ts'
import { WorkStrip } from './WorkStrip.tsx'
import { WallView } from './fragments/WallView.tsx'
import { SetsView } from './fragments/SetsView.tsx'
import { CharactersView } from './fragments/CharactersView.tsx'
import { WorldView } from './fragments/WorldView.tsx'
import { InfoView } from './fragments/InfoView.tsx'
import { PendingQueue } from './fragments/PendingQueue.tsx'
import css from './fragments.module.css'
import rootCss from './workstrip.module.css'

/** The five views' ids, in switcher order. */
const VIEWS = ['wall', 'sets', 'characters', 'world', 'info'] as const

/** The view switcher's labels ride the same keys the views use. */
const VIEW_LABEL = {
  wall: 'view.wall',
  sets: 'view.sets',
  characters: 'view.characters',
  world: 'view.world',
  info: 'view.info',
} as const

/** The fragments tab body. */
export function FragmentsTab(props: StoryTabProps): ReactNode {
  const { t } = props
  const shell = useWorkShell(props)
  const view = props.useStory(current => current.fragmentsView)
  const focus = shell.focus
  const useWorkspaces = props.useWorkspaces
  const workspaces = useWorkspaces === undefined
    ? []
    : useWorkspaces(snapshot => snapshot.items.map(item => ({
      workspaceId: item.workspaceId as string,
      path: item.path as string,
      title: (item as { title?: string }).title ?? (item.path as string),
    })))

  return (
    <div className={rootCss.root}>
      <WorkStrip
        t={t}
        sessionId={props.sessionId}
        works={shell.works}
        focus={focus}
        counts={shell.info === null ? null : { chapters: shell.info.counts.chapters, pending: shell.info.counts.pending }}
        workspaces={workspaces}
        onSwitch={shell.switchWork}
        onCreate={shell.createWork}
      />
      {shell.fatal !== null && (
        <div className={rootCss.notice} onClick={() => { shell.setFatal(null) }}>{shell.fatal}</div>
      )}
      {focus === null ? (
        <div className={rootCss.notice}>
          {shell.works === null ? t('state.loading') : (
            <>
              <span>{t('state.noFocus')}</span>
              <span>{t('state.noFocusHint')}</span>
            </>
          )}
        </div>
      ) : (
        <div className={css.fragRoot}>
          <div className={css.viewSwitch} role="tablist">
            {VIEWS.map(id => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={css.viewChip}
                data-on={view === id || undefined}
                onClick={() => { props.setFragmentsView(id) }}
              >
                {t(VIEW_LABEL[id])}
              </button>
            ))}
          </div>
          {view === 'wall' && <div className={css.viewNote}>{t('wall.note')}</div>}
          {view === 'sets' && <div className={css.viewNote}>{t('sets.note')}</div>}
          {view === 'wall' && (
            <div className={css.viewBody} data-view={view}>
              <WallView props={props} shell={shell} workId={focus.workId} />
            </div>
          )}
          {view === 'sets' && <SetsView props={props} shell={shell} workId={focus.workId} />}
          {view === 'characters' && <CharactersView props={props} shell={shell} workId={focus.workId} />}
          {view === 'world' && <WorldView props={props} shell={shell} workId={focus.workId} />}
          {view === 'info' && (
            <div className={css.viewBody} data-view={view}>
              <InfoView props={props} shell={shell} />
            </div>
          )}
          <PendingQueue props={props} shell={shell} workId={focus.workId} />
        </div>
      )}
      {shell.toast !== null && (
        <Toast key={shell.toast.seq} text={shell.toast.text} onDone={shell.dismissToast} />
      )}
    </div>
  )
}
