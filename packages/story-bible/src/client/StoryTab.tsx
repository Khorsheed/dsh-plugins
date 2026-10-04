/**
 * The story tab (F1-4): ONE host tab kind holding the whole surface — the
 * work strip once, the internal 灵感碎片/章节阅读 switcher, and the active
 * pane. The two panes keep their M3 components (FragmentsBody/ReaderBody);
 * the shell (registry/focus/counts + toast + fatal) is shared by
 * construction, so switching panes never re-reads the registry.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { ReactNode } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StoryTabProps } from './contract.ts'
import { useWorkShell } from './data.ts'
import { WorkStrip } from './WorkStrip.tsx'
import { FragmentsBody } from './FragmentsTab.tsx'
import { ReaderBody } from './ReaderTab.tsx'
import css from './storytab.module.css'
import rootCss from './workstrip.module.css'

/** The story tab body. */
export function StoryTab(props: StoryTabProps): ReactNode {
  const { t } = props
  const shell = useWorkShell(props)
  const tabView = props.useStory(current => current.tabView)
  const useWorkspaces = props.useWorkspaces
  const workspaces = useWorkspaces === undefined
    ? []
    : useWorkspaces(snapshot => snapshot.items.map(item => ({
      workspaceId: (item as { workspaceId: string }).workspaceId,
      path: (item as { path: string }).path,
      title: (item as { title?: string }).title ?? (item as { path: string }).path,
    })))
  // The session's own cwd is the create form's default workspace (F1-1).
  const sessionCwd = props.useSessions?.(snapshot => {
    const id = props.sessionId
    const row = id === undefined ? undefined : (snapshot as { byId?: Record<string, { cwd?: string } | undefined> }).byId?.[id]
    return row?.cwd
  }) as string | undefined

  return (
    <div className={rootCss.root}>
      <WorkStrip
        t={t}
        sessionId={props.sessionId}
        works={shell.works}
        focus={shell.focus}
        counts={shell.info === null ? null : { chapters: shell.info.counts.chapters, pending: shell.info.counts.pending }}
        workspaces={workspaces}
        sessionCwd={sessionCwd}
        pickDirectory={props.pickDirectory}
        onSwitch={shell.switchWork}
        onCreate={shell.createWork}
        statWorkspace={async (path) => {
          const result = await props.statWorkspace({ path })
          return result.ok ? result.value : null
        }}
      />
      {shell.fatal !== null && (
        <div className={rootCss.notice} onClick={() => { shell.setFatal(null) }}>{shell.fatal}</div>
      )}
      {shell.focus === null ? (
        <div className={rootCss.notice}>
          {shell.works === null ? t('state.loading') : (
            <>
              <span>{t('state.noFocus')}</span>
              <span>{t('state.noFocusHint')}</span>
            </>
          )}
        </div>
      ) : (
        <>
          <div className={css.paneSwitch} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tabView === 'fragments'}
              className={css.paneChip}
              data-on={tabView === 'fragments' || undefined}
              onClick={() => { props.setTabView('fragments') }}
            >
              {t('tab.fragments')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tabView === 'reader'}
              className={css.paneChip}
              data-on={tabView === 'reader' || undefined}
              onClick={() => { props.setTabView('reader') }}
            >
              {t('tab.reader')}
            </button>
          </div>
          <div className={css.paneBody}>
            {tabView === 'fragments' ? <FragmentsBody props={props} shell={shell} /> : <ReaderBody props={props} shell={shell} />}
          </div>
        </>
      )}
      {shell.toast !== null && (
        <Toast key={shell.toast.seq} text={shell.toast.text} onDone={shell.dismissToast} />
      )}
    </div>
  )
}
