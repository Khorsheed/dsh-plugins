/**
 * 待对齐 (2026-11-02 改版稿): what changed since the book was last aligned.
 * One item per changed thing — a setting edited, an event deleted, a
 * chapter's text rewritten — however many times it changed. Each item draws
 * its one-step graph (the changed thing on the left, what points at it on the
 * right) and the passages the agent would read. The rules' own fixes sit
 * folded under 已自动处理. 让 Agent 对齐 sends one message; the agent reads
 * this list (novel_read(what=changes)) and ticks items off as it goes; 忽略
 * ticks one off by hand.
 *
 * `AlignBadge` is the door on the other faces: nothing while the list is empty.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, type AlignItemView } from '../types.ts'
import { ALIGN_PAGE, type NovelSurfaceProps } from './contract.ts'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './align.module.css'

type T = NovelSurfaceProps['t']

/** The 待对齐 page (keyed `novel:align`). */
export function AlignPage(props: NovelSurfaceProps): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <AlignRead {...props} />
}

/** 「待对齐 N」 on a face's toolbar; nothing while the list is empty. */
export function AlignBadge(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t, navigate } = props
  const read = useNovelRead(remote(), r => r.align({ canvasId }), `align:${canvasId}`, rev)
  const count = read.state === 'ready' && read.value.ok ? (read.value.items ?? []).length : 0
  if (count === 0) return null
  return <button type="button" className={css.badge} onClick={() => { navigate.openPage(ALIGN_PAGE, t('align.title')) }}><i />{t('align.badge', { count })}</button>
}

function AlignRead(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t, sessionId, navigate } = props
  const api = remote()
  const read = useNovelRead(api, r => r.align({ canvasId }), `align:${canvasId}`, rev)
  const [busy, setBusy] = useState(false)
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.page}><p className={css.muted}>{t('state.loading')}</p></div>
  if (read.state === 'error') return <div className={css.page}><p className={css.warn}>{t('error.generic', { message: read.message })}</p></div>
  if (!read.value.ok) return <div className={css.page}><p className={css.warn}>{t(errorKey(read.value.error))}</p></div>
  const { items = [], auto = [], cost } = read.value
  const ack = (ids: readonly string[] | 'all'): void => {
    if (sessionId === undefined) return
    setBusy(true)
    void api.alignAck(sessionId, { canvasId, ids }).then(() => { setBusy(false); navigate.refresh() })
  }
  const canSend = sessionId !== undefined && props.sendToConversation !== undefined
  const costLine = cost === undefined || cost.chapters.length === 0 ? '' : t('align.cost', {
    list: cost.chapters.map(row => t('align.costChapter', { n: row.n, count: row.passages })).join('、'),
    chars: cost.chars.toLocaleString(),
  })
  return (
    <div className={css.page} data-canvas-scroll="novel-align">
      {items.length === 0 ? (
        <div className={css.sum}><b>{t('align.empty')}</b><span className={css.muted}>{t('align.emptyHint')}</span></div>
      ) : (
        <div className={css.sum}>
          <b>{t('align.head', { count: items.length })}</b>
          {costLine !== '' && <span className={css.cost}>{costLine}</span>}
          {canSend && (
            <button type="button" className={css.primary} onClick={() => { props.sendToConversation?.(sessionId!, t('align.ask', { count: items.length })) }}>
              {t('align.go', { count: items.length })}
            </button>
          )}
        </div>
      )}
      <div className={css.items}>
        {items.map(item => <Item key={item.node} item={item} busy={busy} onIgnore={sessionId === undefined ? undefined : () => { ack([item.node]) }} t={t} />)}
      </div>
      {auto.length > 0 && (
        <details className={css.done}>
          <summary>{t('align.auto', { count: auto.length })}</summary>
          <ul>{auto.map(row => <li key={row.node}>{t(row.change === 'removed' ? 'align.autoRemoved' : 'align.autoChanged', { kind: t(`align.kind.${row.kind}` as 'align.kind.setting'), name: bare(row.name) })}</li>)}</ul>
          {sessionId !== undefined && <button type="button" className={css.link} disabled={busy} onClick={() => { ack(auto.map(row => row.node)) }}>{t('align.clearAuto')}</button>}
        </details>
      )}
      <p className={css.muted}>{t('align.how')}</p>
    </div>
  )
}

const bare = (name: string): string => name.replace(/[（(](?:工作稿|暂定|待定|草稿)[）)]/g, '').trim() || name

function Item({ item, busy, onIgnore, t }: { readonly item: AlignItemView; readonly busy: boolean; readonly onIgnore: (() => void) | undefined; readonly t: T }): ReactNode {
  const kind = t(`align.kind.${item.kind}` as 'align.kind.setting')
  const title = item.change === 'text'
    ? t('align.text', { n: item.chapters[0] ?? 0 })
    : t(item.change === 'removed' ? 'align.removed' : 'align.changed', { kind, name: bare(item.name) })
  const sub = item.change === 'text'
    ? t('align.textSub', { count: item.paragraphs ?? 0, share: Math.round((item.share ?? 0) * 100) })
    : item.change === 'removed' ? t('align.removedSub', { list: item.chapters.join('、') }) : t('align.changedSub', { list: item.chapters.join('、') })
  const targets = item.near.length > 0 ? item.near : [{ label: t('align.writtenIn'), names: item.chapters.map(n => t('align.chapter', { n })) }]
  return (
    <section className={css.item}>
      <header className={css.itemHead}>
        <b>{title}</b>
        {onIgnore !== undefined && <button type="button" className={css.ghost} disabled={busy} onClick={onIgnore}>{t('align.ignore')}</button>}
        <span className={css.itemSub}>{sub}</span>
      </header>
      <div className={css.ask}>
        <div className={css.graph}>
          <span className={css.src} data-removed={item.change === 'removed' || undefined}>{item.change === 'text' ? t('align.chapter', { n: item.chapters[0] ?? 0 }) : bare(item.name)}</span>
          <span className={css.edge} aria-hidden="true" />
          <div className={css.targets}>
            {targets.map(group => (
              <div key={group.label} className={css.target}>
                <span className={css.label}>{group.label}</span>
                <span className={css.tags}>{group.names.map((name, index) => <span key={index}>{bare(name)}</span>)}</span>
              </div>
            ))}
          </div>
        </div>
        {item.passages.map((passage, index) => (
          <blockquote key={index} className={css.snip}><span>{t('align.chapter', { n: passage.chapter })}</span>{passage.text}</blockquote>
        ))}
      </div>
    </section>
  )
}
