import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { MembersViewProps, RoomInviteInjected } from './slots.ts'
import css from './InviteDialog.module.css'

export function RoomDirectoryBrowser({ listDirectory, onPicked, onClose, t }: {
  readonly listDirectory: NonNullable<RoomInviteInjected['listDirectory']>
  readonly onPicked: (path: string) => void
  readonly onClose: () => void
  readonly t: MembersViewProps['t']
}): ReactNode {
  const request = useRef<AbortController | undefined>(undefined)
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (target?: string): Promise<void> => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setFailed(false)
    setListing(null)
    setPath(target ?? '')
    try {
      const next = await listDirectory(target, controller.signal)
      if (controller.signal.aborted) return
      setListing(next)
      setPath(next.path)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (request.current === controller) setLoading(false)
    }
  }, [listDirectory])

  useEffect(() => {
    void load()
    return () => { request.current?.abort() }
  }, [load])

  const submitPath = (event: FormEvent): void => {
    event.preventDefault()
    const target = path.trim()
    if (target !== '' && !loading) void load(target)
  }
  const title = t('directory.title')

  return (
    <Modal open headless title={title} onClose={onClose} className={`${css.card ?? ''} ${css.cardEdit ?? ''}`}>
      <div className={css.sheet}>
        <div className={css.title}>{title}</div>
        <form className={css.directoryPath} onSubmit={submitPath}>
          <label className={css.field}>
            <span className={css.label}>{t('directory.path')}</span>
            <input
              className={css.input}
              value={path}
              aria-label={t('directory.path')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-modal-autofocus
              onChange={event => { setPath(event.target.value) }}
            />
          </label>
          <button type="submit" className={css.browse} disabled={loading || path.trim() === ''}>{t('directory.go')}</button>
        </form>
        {listing !== null && listing.crumbs.length > 0 && (
          <nav className={css.directoryCrumbs} aria-label={t('directory.breadcrumbs')}>
            {listing.crumbs.map((crumb, index) => (
              <span key={crumb.path} className={css.directoryCrumb}>
                {index > 0 && <span aria-hidden>›</span>}
                <button type="button" className={css.browse} disabled={loading} onClick={() => { void load(crumb.path) }}>
                  {crumb.name || crumb.path}
                </button>
              </span>
            ))}
          </nav>
        )}
        <div className={css.directoryList} aria-busy={loading}>
          {loading && <span className={css.hint} role="status">{t('directory.loading')}</span>}
          {failed && !loading && (
            <div className={css.directoryMessage}>
              <span className={css.error} role="alert">{t('directory.failed')}</span>
              <button type="button" className={css.browse} onClick={() => { void load(path.trim() || undefined) }}>{t('directory.retry')}</button>
            </div>
          )}
          {!loading && !failed && listing?.entries.map(entry => (
            <button key={entry.path} type="button" className={css.directoryEntry} onClick={() => { void load(entry.path) }}>
              <span>{entry.name}</span><span aria-hidden>›</span>
            </button>
          ))}
          {!loading && !failed && listing !== null && listing.entries.length === 0 && (
            <span className={css.hint}>{t('directory.empty')}</span>
          )}
        </div>
        {listing?.truncated === true && <span className={css.hint}>{t('directory.truncated')}</span>}
        <div className={css.buttons}>
          <button type="button" className={css.button} onClick={onClose}>{t('invite.cancel')}</button>
          <button type="button" className={css.primary} disabled={loading || listing === null} onClick={() => { if (listing !== null) onPicked(listing.path) }}>
            {t('directory.select')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
