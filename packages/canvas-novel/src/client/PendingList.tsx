/**
 * The pending queue (medium/low-confidence findings, missed plans, open
 * questions), item by item with the person's two answers — folded under its
 * count on the 章节 face — plus the two helpers the chapter surfaces share:
 * the chapter to pick up at, and a chapter's heading.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { ChapterRow, PendingView } from '../types.ts'
import type { NovelNavigate, NovelRemote } from './contract.ts'
import { errorKey } from './use-novel.ts'
import css from './novel.module.css'

/**
 * The chapter to pick up at: the earliest one with something to review, else
 * the latest. Undefined for a work without chapters.
 */
export function currentChapter(rows: readonly ChapterRow[], pending: Readonly<Record<number, number>>): ChapterRow | undefined {
  return rows.find(row => (pending[row.chapter.n] ?? 0) > 0) ?? rows.at(-1)
}

/** A chapter page's heading: `第3章 · 回声`. */
export function chapterHeading(t: TranslateNS<'novel'>, n: number, title: string): string {
  const label = t('strip.chapter', { n })
  // Titles often carry the number already (`第1章 门与假门`).
  return title === '' ? label : title.startsWith(label) ? title : `${label} · ${title}`
}

/** The queue, item by item, each with the person's two answers. */
export function PendingList({ canvasId, items, navigate, sessionId, remote, t }: {
  readonly canvasId: string
  readonly items: readonly PendingView[]
  readonly navigate: NovelNavigate
  readonly sessionId: SessionId | undefined
  readonly remote: NovelRemote
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ id: string; text: string } | null>(null)
  const decide = async (item: PendingView, action: 'accept' | 'discard'): Promise<void> => {
    if (sessionId === undefined) return
    setBusy(item.id)
    setFailure(null)
    try {
      const result = await remote.decidePending(sessionId, { canvasId, id: item.id, action })
      if (!result.ok) setFailure({ id: item.id, text: t('error.generic', { message: result.error.message }) })
      else if (!result.value.ok) setFailure({ id: item.id, text: t(errorKey(result.value.error)) })
      navigate.refresh()
    } finally {
      setBusy(null)
    }
  }
  return (
    <ul className={css.pendingList}>
      {sessionId === undefined && <li className={css.muted}>{t('pending.readOnly')}</li>}
      {items.map(item => (
        <li key={item.id} className={css.pendingItem}>
          <div className={css.pendingHead}>
            <span className={css.kindTag} data-kind={item.kind}>{t(`pending.kind.${item.kind}`)}</span>
            {item.confidence !== undefined && (
              <span className={css.confidence} data-confidence={item.confidence}>{t(`pending.confidence.${item.confidence}`)}</span>
            )}
            {item.chapter !== undefined && <span className={css.muted}>{t('pending.chapter', { n: item.chapter })}</span>}
            {item.subject !== undefined && (
              <button
                type="button"
                className={css.subject}
                title={t('pending.openCard')}
                onClick={() => { if (item.subjectCardId !== undefined) navigate.openCard(item.subjectCardId, item.subject!) }}
              >
                {item.subject}
              </button>
            )}
            {item.kind === 'mention' && isMentionKind(item.payload.kind) && (
              <span className={css.muted}>{t(`pending.mention.${item.payload.kind}`)}</span>
            )}
          </div>
          <div className={css.pendingReason}>{pendingText(item)}</div>
          {item.evidenceInText !== undefined && item.evidenceInText !== '' && (
            <blockquote className={css.evidence}>{item.evidenceInText}</blockquote>
          )}
          {failure?.id === item.id && <div className={css.warn}>{failure.text}</div>}
          {sessionId !== undefined && (
            <div className={css.pendingActions}>
              {item.kind === 'plan-missed' ? (
                <button type="button" className={css.button} disabled={busy !== null} onClick={() => { void decide(item, 'accept') }}>
                  {t('pending.ack')}
                </button>
              ) : (
                <>
                  <button type="button" className={css.buttonPrimary} disabled={busy !== null} onClick={() => { void decide(item, 'accept') }}>
                    {t(item.kind === 'setting' ? 'pending.setting.accept' : 'pending.accept')}
                  </button>
                  <button type="button" className={css.button} disabled={busy !== null} onClick={() => { void decide(item, 'discard') }}>
                    {t(item.kind === 'setting' ? 'pending.setting.discard' : 'pending.discard')}
                  </button>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

const MENTION_KINDS = ['planted', 'advanced', 'hinted', 'resolved'] as const

function isMentionKind(kind: string | undefined): kind is (typeof MENTION_KINDS)[number] {
  return (MENTION_KINDS as readonly (string | undefined)[]).includes(kind)
}

/** What the item says: the experience line or the note, then the reviewer's reason. */
function pendingText(item: PendingView): string {
  const said = item.payload.entry ?? item.payload.note ?? item.payload.question ?? (item.kind === 'setting' ? item.payload.content : undefined)
  return said === undefined || said === item.reason ? item.reason : `${said} — ${item.reason}`
}
