import { useEffect, useRef, useState } from 'react'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** The official owner validates and adopts the Host path; no Mac chooser is opened. */
export function DirectoryFlow({ open, busy, onPicked, onCancel, t }: DirectoryFlowOwnerProps & PropsLocale<'mobile'>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [path, setPath] = useState('')
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else { dialog.current?.close(); setPath('') }
  }, [open])
  return <dialog ref={dialog} data-mobile-dialog aria-label={t('workspace')} onCancel={onCancel}>
    <form onSubmit={event => { event.preventDefault(); if (!busy && path.trim()) onPicked(path.trim()) }}>
      <h2>{t('workspace')}</h2>
      <p>{t('hostPathHelp')}</p>
      <label>{t('hostPath')}<input autoFocus aria-label={t('hostPath')} value={path} onChange={event => { setPath(event.target.value) }} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="/path/to/project" /></label>
      <button type="submit" data-mobile-done disabled={busy || !path.trim()}>{t('openWorkspace')}</button>
      <button type="button" onClick={onCancel} disabled={busy}>{t('cancel')}</button>
    </form>
  </dialog>
}
