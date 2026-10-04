/**
 * The fragments body: the five-view switcher and the active view, with the
 * pending queue pinned at the bottom. The work strip, the shell and the
 * toast live in the enclosing StoryTab (F1-4: one host tab, internal
 * switcher). All five views read through the same story Remote (同源).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { ReactNode } from 'react'
import type { StoryTabProps } from './contract.ts'
import type { WorkShell } from './data.ts'
import { WallView } from './fragments/WallView.tsx'
import { SetsView } from './fragments/SetsView.tsx'
import { CharactersView } from './fragments/CharactersView.tsx'
import { WorldView } from './fragments/WorldView.tsx'
import { InfoView } from './fragments/InfoView.tsx'
import { PendingQueue } from './fragments/PendingQueue.tsx'
import css from './fragments.module.css'

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

/** The fragments body. */
export function FragmentsBody({ props, shell }: { props: StoryTabProps; shell: WorkShell }): ReactNode {
  const { t } = props
  const view = props.useStory(current => current.fragmentsView)
  const focus = shell.focus
  if (focus === null) return null
  return (
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
  )
}
