/**
 * 一页纸 on 设定 · 总览 (2026-11-02 改版稿): the logline leads in the book's
 * own voice, the other fields follow as label / text rows — the first three
 * two lines each, 展开全部 for the rest. A proposal waiting on the person is
 * the same block with its decision on top (采用 / 不采用) and the adopted
 * text struck through where it changes; there is no separate 「一页纸 · 还没有」.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import { volumeNumeral, type NovelOutlineResult, type OutlineSheet } from '../types.ts'
import type { NovelRemote, NovelSurfaceProps } from './contract.ts'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './codex.module.css'

const TEXT_KEYS = ['conflict', 'arc', 'theme', 'tone', 'ending'] as const
/** Rows shown before 展开全部. */
const FOLDED = 3

/** The 一页纸 block; nothing while the outline reads. */
export function OnePage(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.outline({ canvasId }), `outline:${canvasId}`, rev)
  const [open, setOpen] = useState(false)
  if (api === undefined || read.state !== 'ready' || !read.value.ok) return null
  const data = read.value
  const { outline } = data
  const proposal = outline.proposal
  if (outline.revision === 0 && proposal === undefined) {
    return (
      <section className={css.section}>
        <h3 className={css.h3}>{t('outline.sheet')}</h3>
        <p className={css.empty}>{t('outline.empty')}</p>
      </section>
    )
  }
  const adopted = outline.sheet
  const shown: OutlineSheet = { ...adopted, ...(proposal?.sheet ?? {}) }
  const heroName = (proposal?.sheet?.protagonist !== undefined ? data.proposedHero?.name : undefined) ?? data.hero?.name
  const volumes = proposal?.volumes ?? outline.volumes
  const rows: { key: string; label: string; text: string; was?: string }[] = []
  if (heroName !== undefined) rows.push({ key: 'protagonist', label: t('outline.f.protagonist'), text: heroName })
  for (const key of TEXT_KEYS) {
    const text = shown[key]
    if (text === undefined) continue
    const was = proposal?.sheet?.[key] !== undefined && adopted[key] !== undefined && adopted[key] !== text ? adopted[key] : undefined
    rows.push({ key, label: t(`outline.f.${key}`), text, ...(was === undefined ? {} : { was }) })
  }
  if (volumes.length > 0) {
    rows.push({ key: 'volumes', label: t('onepage.volumes'), text: volumes.map((volume, index) => `${t('outline.volume', { vol: volumeNumeral(index + 1), title: volume.title.replace(/^第[一二三四五六七八九十\d]+卷\s*[·・:：]?\s*/, '') })}${volume.chapters === undefined ? '' : ` · ${t('outline.volumeEst', { n: volume.chapters })}`}`).join('；') })
  }
  const visible = open ? rows : rows.slice(0, FOLDED)
  return (
    <section className={css.section}>
      <h3 className={css.h3}>{t('outline.sheet')}{outline.revision > 0 && <span className={css.h3Meta}>{t('outline.adopted', { revision: outline.revision })}</span>}</h3>
      <div className={css.onePage}>
        {proposal !== undefined && <Decision {...props} api={api} data={data} />}
        {shown.logline !== undefined && <p className={css.logline}>{shown.logline}</p>}
        <dl className={css.sheetRows} data-folded={!open || undefined}>
          {visible.map(row => (
            <div key={row.key} className={css.sheetRow}>
              <dt>{row.label}</dt>
              <dd>{row.was !== undefined && <del className={css.was}>{row.was}</del>}<span>{row.text}</span></dd>
            </div>
          ))}
        </dl>
        <div className={css.sheetFoot}>
          {rows.length > FOLDED && (
            <button type="button" className={css.link} onClick={() => { setOpen(value => !value) }}>
              {open ? t('onepage.fold') : t('onepage.unfold', { count: rows.length })}
            </button>
          )}
          {proposal !== undefined && <span>{t('outline.proposalHint')}</span>}
        </div>
      </div>
    </section>
  )
}

/** The proposal's head: who proposed what, when, and 采用 / 不采用. */
function Decision(props: NovelSurfaceProps & { readonly api: NovelRemote; readonly data: NovelOutlineResult }): ReactNode {
  const { api, data, canvasId, sessionId, navigate, t } = props
  const proposal = data.outline.proposal!
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const decide = async (action: 'accept' | 'discard'): Promise<void> => {
    if (sessionId === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await api.decideOutline(sessionId, { canvasId, action })
      if (!result.ok) setFailure(t('error.generic', { message: result.error.message }))
      else if (!result.value.ok) setFailure(t(errorKey(result.value.error)))
      else navigate.refresh()
    } finally {
      setBusy(false)
    }
  }
  const day = proposal.at.slice(5, 10).replace('-', '/')
  return (
    <div className={css.decision}>
      <b>{data.outline.revision > 0 ? t('onepage.revised') : t('onepage.proposed')}</b>
      <span className={css.decisionWhy}>{[day, proposal.rationale].filter(Boolean).join(' · ')}</span>
      {sessionId !== undefined && (
        <span className={css.decisionActs}>
          <button type="button" className={css.primary} disabled={busy} onClick={() => { void decide('accept') }}>{t('outline.adopt')}</button>
          <button type="button" className={css.button} disabled={busy} onClick={() => { void decide('discard') }}>{t('outline.discard')}</button>
        </span>
      )}
      {failure !== null && <span className={css.warn}>{failure}</span>}
    </div>
  )
}
