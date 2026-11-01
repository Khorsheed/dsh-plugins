/**
 * 删除… on any page of the novel (2026-11-02): one button, and a confirm
 * that says what happens before anything does — the fixes made at once
 * (a child setting moves up, a person's relations go too, events let go of a
 * place) and the written chapters that still carry it, which 待对齐 asks
 * about afterwards. No dialog: the confirm opens under the button.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import type { DeleteFixView, NovelDeletePreviewResult } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { errorKey } from './use-novel.ts'
import css from './delete.module.css'

type T = NovelSurfaceProps['t']

/** A name without the 「（工作稿）」 asides titles carry, as the pages show it. */
const bare = (name: string): string => name.replace(/[（(](?:工作稿|暂定|待定|草稿)[）)]/g, '').trim() || name

/** The button and its confirm; nothing on a read-only canvas. */
export function DeleteNode(props: Pick<NovelSurfaceProps, 'canvasId' | 'remote' | 'sessionId' | 'navigate' | 't'> & {
  readonly node: string
  readonly onDeleted?: () => void
}): ReactNode {
  const { canvasId, remote, sessionId, navigate, t, node } = props
  const api = remote()
  const [preview, setPreview] = useState<NovelDeletePreviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  if (api === undefined || sessionId === undefined) return null
  const open = (): void => {
    setFailure(null)
    void api.deletePreview({ canvasId, node }).then(result => {
      if (!result.ok) { setFailure(t('error.generic', { message: result.error.message })); return }
      if (!result.value.ok) { setFailure(t(errorKey(result.value.error))); return }
      setPreview(result.value)
    })
  }
  const confirm = (): void => {
    setBusy(true)
    void api.deleteNode(sessionId, { canvasId, node }).then(result => {
      setBusy(false)
      if (!result.ok) { setFailure(t('error.generic', { message: result.error.message })); return }
      if (!result.value.ok) { setFailure(t(errorKey(result.value.error))); return }
      setPreview(null)
      props.onDeleted?.()
      navigate.refresh()
    })
  }
  const lines = preview === null ? [] : [
    ...(preview.fixes ?? []).map(fix => fixLine({ ...fix, name: bare(fix.name), ...(fix.to === undefined ? {} : { to: fix.to.map(bare) }) }, t)),
    ...((preview.chapters ?? []).length > 0 ? [t('del.chapters', { list: preview.chapters!.join('、') })] : []),
  ]
  return (
    <span className={css.wrap}>
      <button type="button" className={css.door} aria-expanded={preview !== null} onClick={() => { if (preview === null) open(); else setPreview(null) }}>{t('del.button')}</button>
      {(preview !== null || failure !== null) && (
        <div className={css.confirm} role="dialog" aria-label={t('del.title', { name: bare(preview?.name ?? '') })}>
          {preview !== null && <b>{t('del.title', { name: bare(preview.name ?? '') })}</b>}
          {preview !== null && (lines.length === 0 ? <p className={css.none}>{t('del.none')}</p> : <ul>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>)}
          {failure !== null && <p className={css.fail}>{failure}</p>}
          <span className={css.acts}>
            {preview !== null && <button type="button" className={css.danger} disabled={busy} onClick={confirm}>{t('del.confirm')}</button>}
            <button type="button" className={css.cancel} onClick={() => { setPreview(null); setFailure(null) }}>{t('edit.cancel')}</button>
          </span>
        </div>
      )}
    </span>
  )
}

/** One fix, as a sentence. */
function fixLine(fix: DeleteFixView, t: T): string {
  if (fix.kind === 'move-up') return (fix.to ?? []).length === 0 ? t('del.moveTop', { name: fix.name }) : t('del.moveUp', { name: fix.name, to: fix.to!.join('、') })
  if (fix.kind === 'drop') return fix.nodeKind === 'relation' ? t('del.dropRelation', { name: fix.name }) : t('del.dropReveal')
  if (fix.kind === 'unbind') return t('del.unbind', { name: fix.name })
  switch (fix.edge) {
    case 'at': return t('del.unlinkAt', { name: fix.name })
    case 'with': return t('del.unlinkWith', { name: fix.name })
    case 'cause': return t('del.unlinkCause', { name: fix.name })
    case 'faction': return t('del.unlinkFaction', { name: fix.name })
    case 'home': return t('del.unlinkHome', { name: fix.name })
    case 'base': return t('del.unlinkBase', { name: fix.name })
    default: return t('del.unlinkPlan', { name: fix.name })
  }
}
