/**
 * The work strip both tabs share at their top: the registry dropdown (the
 * bookshelf), the live counts, the focus echo, and the inline create form
 * (title + one mounted workspace). Switching IS the focus gesture — the
 * session's story_* tools and the pointer follow it — so the dropdown reads
 * the session's focus, not a local preference.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { WorkIndexEntry } from '../types.ts'
import type {} from './locales.ts'
import { IconPlusOutlineMedium } from './icons.tsx'
import css from './workstrip.module.css'

/** The work strip's props: the tab's session, data, and the toast reporter. */
export interface WorkStripProps {
  readonly t: TranslateNS<'story'>
  /** The tab's session (undefined = read-only). */
  readonly sessionId: SessionId | undefined
  /** The work registry (null until loaded). */
  readonly works: readonly WorkIndexEntry[] | null
  /** The session's focus mirror. */
  readonly focus: { workId: string; title: string } | null
  /** The focused work's counts (chapters/pending), null before load or without focus. */
  readonly counts: { chapters: number; pending: number } | null
  /** The deployment's registered workspaces (the create form's picker). */
  readonly workspaces: readonly { workspaceId: string; path: string; title: string }[]
  /** The session's own cwd — the create form's DEFAULT workspace (F1-1). */
  readonly sessionCwd: string | undefined
  /** The host's directory picker (probed; null = the fallback text input shows). */
  readonly pickDirectory: (() => Promise<string | null>) | null
  /** Path existence validation for the fallback text input (the statWorkspace Remote). */
  readonly statWorkspace: (path: string) => Promise<{ exists?: boolean; directory?: boolean } | null>
  /** Switch the focus (the Remote verb; the parent toasts failures). */
  onSwitch: (workId: string) => Promise<boolean>
  /** Create one work (title + workspace path); the parent toasts and focuses. */
  onCreate: (title: string, workspace: string) => Promise<boolean>
}

/** The work strip. */
export function WorkStrip({ t, sessionId, works, focus, counts, workspaces, sessionCwd, pickDirectory, statWorkspace, onSwitch, onCreate }: WorkStripProps): ReactNode {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** The create form's default workspace: the SESSION's own cwd (F1-1), then the first registered one. */
  useEffect(() => {
    if (creating && workspace === '') setWorkspace(sessionCwd ?? workspaces[0]?.path ?? '')
  }, [creating, workspaces, workspace, sessionCwd])

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (trimmed.length === 0) {
      setError(t('works.needTitle'))
      return
    }
    if (workspace === '') {
      setError(t('works.needWorkspace'))
      return
    }
    setBusy(true)
    try {
      const probe = await statWorkspace(workspace)
      if (probe !== null && (probe.exists !== true || probe.directory !== true)) {
        setError(t('works.badWorkspace'))
        return
      }
      if (await onCreate(trimmed, workspace)) {
        setCreating(false)
        setTitle('')
        setError(null)
      }
    } finally {
      setBusy(false)
    }
  }, [title, workspace, onCreate, statWorkspace, t])

  const countsText = useMemo(() => counts === null
    ? null
    : t('works.counts', { chapters: String(counts.chapters), pending: String(counts.pending) }), [counts, t])

  return (
    <>
      <div className={css.workstrip}>
        <IconBook />
        <select
          className={css.workSelect}
          aria-label={t('works.switch')}
          title={t('works.switch')}
          disabled={sessionId === undefined || works === null || works.length === 0}
          value={focus?.workId ?? ''}
          onChange={event => { if (event.target.value !== '') void onSwitch(event.target.value) }}
        >
          {focus === null && <option value="" disabled>{t('state.noFocus')}</option>}
          {(works ?? []).map(work => (
            <option key={work.id} value={work.id}>{work.title}</option>
          ))}
        </select>
        {countsText !== null && <span className={css.workCounts}>{countsText}</span>}
        {sessionId !== undefined && (
          <button
            type="button"
            className={css.iconButton}
            title={t('works.new')}
            aria-label={t('works.new')}
            aria-expanded={creating}
            onClick={() => { setCreating(value => !value) }}
          >
            <IconPlusOutlineMedium size={13} />
          </button>
        )}
      </div>
      {creating && (
        <form className={css.createForm} onSubmit={event => { void submit(event) }}>
          <input
            type="text"
            autoFocus
            value={title}
            placeholder={t('works.newTitle')}
            onChange={event => { setTitle(event.target.value) }}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              setCreating(false)
            }}
          />
          <span className={css.formLabel}>{t('works.newWorkspace')}</span>
          <div className={css.workspaceRow}>
            {workspaces.length > 0 && workspaces.some(row => row.path === workspace) ? (
              <select
                aria-label={t('works.newWorkspace')}
                value={workspace}
                onChange={event => { setWorkspace(event.target.value) }}
              >
                {workspaces.map(row => (
                  <option key={row.workspaceId} value={row.path}>{row.title}（{row.path}）</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                aria-label={t('works.newWorkspace')}
                value={workspace}
                placeholder="/abs/path"
                onChange={event => { setWorkspace(event.target.value) }}
              />
            )}
            {pickDirectory !== null && (
              <button
                type="button"
                className={css.ghostButton}
                onClick={() => {
                  void pickDirectory().then(chosen => { if (chosen !== null) setWorkspace(chosen) })
                }}
              >
                {t('works.browse')}
              </button>
            )}
          </div>
          {sessionCwd !== undefined && workspace !== '' && workspace !== sessionCwd && (
            <span className={css.formWarn}>{t('works.crossWorkspace')}</span>
          )}
          {error !== null && <span className={css.formNote}>{error}</span>}
          <div className={css.formActions}>
            <button type="submit" className={css.primaryButton} disabled={busy || workspaces.length === 0}>
              {t('works.create')}
            </button>
            <button type="button" className={css.ghostButton} onClick={() => { setCreating(false) }}>
              {t('works.cancel')}
            </button>
          </div>
        </form>
      )}
    </>
  )
}

/** The strip's leading book glyph. */
function IconBook(): ReactNode {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth={1.3}>
      <path d="M2.5 3C2.5 2.44772 2.94772 2 3.5 2H13.5V11.5H4C3.17157 11.5 2.5 12.1716 2.5 13V3Z" stroke="var(--dsw-alias-brand-primary)" />
      <path d="M2.5 13C2.5 13.8284 3.17157 14.5 4 14.5H13.5V11.5" stroke="var(--dsw-alias-brand-primary)" />
    </svg>
  )
}
