/**
 * 规划, the novel's lead face: where the book stands, the one-page outline
 * (一页纸, the protagonist read off their character card), the roadmap —
 * only as fine as an outline can know: volumes with about how many
 * chapters, what each achieves and where it lands, the chapters already
 * there and the one or two sketched ahead — and the core suspenses (伏笔 set
 * to reveal in a volume) with the clues the text has already laid.
 *
 * The page decides nothing on its own: the agent proposes (novel_write
 * what=outline), the proposal shows as one dashed block, and only the
 * person's 采用 folds it in. Everything else is edited where it lives — the
 * protagonist on their card, a foreshadow's timing on its card.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import {
  NOVEL_GENRE_ID, volumeNumeral,
  type ChapterRow, type NovelOutlineResult, type OutlineCore, type OutlineHero, type OutlineSheet, type OutlineVolume,
} from '../types.ts'
import type { NovelRemote, NovelSurfaceProps } from './contract.ts'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './plan.module.css'

type T = NovelSurfaceProps['t']

/** The 规划 face (keyed `novel:plan`); nothing on a canvas of another genre. */
export function PlanView(props: NovelSurfaceProps): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <PlanRead {...props} />
}

function PlanRead(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.outline({ canvasId }), `outline:${canvasId}`, rev)
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.plan}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.plan}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  if (!read.value.ok) return <div className={css.plan}><div className={css.warn}>{t(errorKey(read.value.error))}</div></div>
  return <Plan {...props} api={api} data={read.value} />
}

function Plan(props: NovelSurfaceProps & { readonly api: NovelRemote; readonly data: NovelOutlineResult }): ReactNode {
  const { data, t } = props
  const { outline } = data
  const chapters = data.chapters
  // Sketches ahead sit in the volume the book is writing in: the one its newest chapter is filed under.
  const newest = [...chapters].sort((a, b) => b.chapter.seq - a.chapter.seq || b.chapter.n - a.chapter.n)[0]
  const currentVolume = newest === undefined ? outline.volumes[0]?.id : volumeOf(newest, outline.volumes)
  const ahead = outline.sketches.filter(row => row.n > (newest?.chapter.n ?? 0) && !chapters.some(c => c.chapter.n === row.n)).slice(0, 3)
  return (
    <div className={css.plan} data-canvas-scroll="novel-plan">
      <Progress t={t} data={data} />
      <section className={css.sheet}>
        <header className={css.sheetHead}>
          <h3>{t('outline.sheet')}</h3>
          <span className={outline.revision > 0 ? css.tagOk : css.tagPlain}>
            {outline.revision > 0 ? t('outline.adopted', { revision: outline.revision }) : t('outline.none')}
          </span>
          <span className={css.grow} />
          {outline.history.length > 0 && <History t={t} history={outline.history} />}
        </header>
        {outline.revision === 0 && outline.proposal === undefined
          ? <p className={css.empty}>{t('outline.empty')}</p>
          : outline.revision > 0 && <SheetFields t={t} sheet={outline.sheet} hero={data.hero} openCard={props.navigate.openCard} />}
        {outline.proposal !== undefined && <Proposal {...props} />}
      </section>

      <section className={css.block}>
        <div className={css.blockHead}>
          <h3>{t('outline.road')}</h3>
          <p className={css.hint}>{t('outline.roadHint')}</p>
        </div>
        {outline.volumes.length === 0
          ? <p className={css.empty}>{t('outline.noVolumes')}</p>
          : outline.volumes.map((volume, index) => (
            <Volume
              key={volume.id}
              t={t}
              volume={volume}
              index={index + 1}
              chapters={chapters.filter(row => volumeOf(row, outline.volumes) === volume.id)}
              ahead={volume.id === currentVolume ? ahead : []}
              cores={data.cores}
              openChapter={(n, title) => { props.navigate.openPage('novel:chapter', title, String(n)) }}
            />
          ))}
      </section>

      <section className={css.block}>
        <div className={css.blockHead}>
          <h3>{t('outline.cores')}</h3>
          <p className={css.hint}>{t('outline.coresHint')}</p>
        </div>
        {data.cores.length === 0
          ? <p className={css.empty}>{t('outline.coresEmpty')}</p>
          : (
            <div className={css.cores}>
              {data.cores.map(core => <Core key={core.cardId} t={t} core={core} openCard={props.navigate.openCard} />)}
            </div>
          )}
      </section>
    </div>
  )
}

/** The progress line: the newest chapter, its volume, the share of the book. */
function Progress({ t, data }: { readonly t: T; readonly data: NovelOutlineResult }): ReactNode {
  const { outline, chapters } = data
  const ordered = [...chapters].sort((a, b) => a.chapter.seq - b.chapter.seq || a.chapter.n - b.chapter.n)
  const last = ordered.filter(row => row.phase !== 'planning').at(-1)
  const volumeIndex = last === undefined ? -1 : Math.max(0, outline.volumes.findIndex(volume => volume.id === last.chapter.volume))
  const volume = volumeIndex === -1 ? undefined : outline.volumes[volumeIndex]
  const written = volume === undefined ? 0 : chapters.filter(row => volumeOf(row, outline.volumes) === volume.id && row.phase !== 'planning').length
  const total = outline.sheet.length?.words
  const done = chapters.reduce((sum, row) => sum + (row.chapter.wordCount ?? 0), 0)
  const pct = total === undefined || total === 0 ? undefined : Math.min(100, Math.round(done / total * 100))
  return (
    <div className={css.progress}>
      <div className={css.progressRow}>
        <b>{last === undefined ? t('outline.progressNone') : t('outline.progress', { n: last.chapter.n })}</b>
        {volume !== undefined && (
          <span>{volume.chapters === undefined
            ? t('outline.inVolumeNoEst', { vol: volumeNumeral(volumeIndex + 1), title: volume.title, written })
            : t('outline.inVolume', { vol: volumeNumeral(volumeIndex + 1), title: volume.title, written, est: volume.chapters })}</span>
        )}
        {pct !== undefined && <span className={css.muted}>{t('outline.share', { pct, done: done.toLocaleString(), total: total!.toLocaleString() })}</span>}
        {volume?.landing !== undefined && <span className={css.progressNext}>{t('outline.nextLanding', { landing: volume.landing })}</span>}
      </div>
      {pct !== undefined && <div className={css.meter} aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>}
    </div>
  )
}

/** The chapter's volume id (unfiled chapters belong to the first volume). */
function volumeOf(row: ChapterRow, volumes: readonly OutlineVolume[]): string | undefined {
  const id = row.chapter.volume
  return id !== undefined && volumes.some(volume => volume.id === id) ? id : volumes[0]?.id
}

/** The adopted sheet as label / value rows; the protagonist as their card's box. */
function SheetFields({ t, sheet, hero, openCard }: {
  readonly t: T
  readonly sheet: OutlineSheet
  readonly hero: OutlineHero | undefined
  readonly openCard: (cardId: string, heading: string) => void
}): ReactNode {
  const row = (key: 'logline' | 'conflict' | 'arc' | 'theme' | 'tone' | 'ending'): ReactNode => sheet[key] === undefined ? null : (
    <>
      <dt>{t(`outline.f.${key}`)}</dt>
      <dd className={key === 'logline' ? css.logline : undefined}>{sheet[key]}</dd>
    </>
  )
  return (
    <dl className={css.fields}>
      {row('logline')}
      {row('conflict')}
      {hero !== undefined && (
        <>
          <dt>{t('outline.f.protagonist')}</dt>
          <dd><Hero t={t} hero={hero} openCard={openCard} /></dd>
        </>
      )}
      {row('arc')}
      {row('theme')}
      {row('tone')}
      {row('ending')}
      {sheet.length !== undefined && (
        <>
          <dt>{t('outline.f.length')}</dt>
          <dd className={css.length}>
            {sheet.length.words !== undefined && <span>{t('outline.len.words', { n: sheet.length.words.toLocaleString() })}</span>}
            {sheet.length.volumes !== undefined && <span>{t('outline.len.volumes', { n: sheet.length.volumes })}</span>}
            {sheet.length.chapters !== undefined && <span>{t('outline.len.chapters', { n: sheet.length.chapters })}</span>}
            {sheet.length.perChapter !== undefined && <span>{t('outline.len.perChapter', { n: sheet.length.perChapter.toLocaleString() })}</span>}
            <span className={css.muted}>{t('outline.len.note')}</span>
          </dd>
        </>
      )}
    </dl>
  )
}

/** The protagonist's box: their card's steering fields; the name opens the card, where they are edited. */
function Hero({ t, hero, openCard }: { readonly t: T; readonly hero: OutlineHero; readonly openCard: (cardId: string, heading: string) => void }): ReactNode {
  const rows = (['want', 'ambition', 'values', 'lack', 'wound'] as const).filter(key => hero[key] !== undefined)
  return (
    <div className={css.hero}>
      <div className={css.heroHead}>
        <button type="button" className={css.link} onClick={() => { openCard(hero.cardId, hero.name) }}><b>{hero.name}</b></button>
        {hero.identity !== undefined && <span className={css.muted}>{hero.identity}</span>}
        <span className={css.grow} />
        <span className={css.muted}>{t('outline.hero.card', { ref: hero.ref })}</span>
      </div>
      {rows.length > 0 && (
        <dl className={css.heroFields}>
          {rows.map(key => (
            <div key={key} className={css.kvRow}>
              <dt>{t(`outline.hero.${key}`)}</dt>
              <dd>{hero[key]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** The revision log, folded to its count. */
function History({ t, history }: { readonly t: T; readonly history: NovelOutlineResult['outline']['history'] }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <span className={css.historyWrap}>
      <button type="button" className={css.link} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {t('outline.history', { count: history.length })}
      </button>
      {open && (
        <ol className={css.history}>
          {[...history].reverse().map(row => <li key={row.revision}><b>v{row.revision}</b> {row.summary}<span className={css.muted}> · {row.at.slice(0, 10)}</span></li>)}
        </ol>
      )}
    </span>
  )
}

/** The pending proposal: what it changes, why, and the person's 采用 / 不采用. */
function Proposal(props: NovelSurfaceProps & { readonly api: NovelRemote; readonly data: NovelOutlineResult }): ReactNode {
  const { api, data, canvasId, sessionId, navigate, t } = props
  const proposal = data.outline.proposal!
  const adopted = data.outline.sheet
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
  const sheet = proposal.sheet ?? {}
  const textKeys = (['logline', 'conflict', 'arc', 'theme', 'tone', 'ending'] as const).filter(key => sheet[key] !== undefined)
  return (
    <div className={css.proposal}>
      <b>{t('outline.proposal')}</b>
      <dl className={css.fields}>
        {textKeys.map(key => (
          <div key={key} className={css.kvRow}>
            <dt>{t(`outline.f.${key}`)}</dt>
            <dd>
              {adopted[key] !== undefined && adopted[key] !== sheet[key] && <del className={css.was}>{adopted[key]}</del>}
              <span className={css.now}>{sheet[key]}</span>
            </dd>
          </div>
        ))}
        {sheet.protagonist !== undefined && sheet.protagonist !== adopted.protagonist && (
          <div className={css.kvRow}>
            <dt>{t('outline.f.protagonist')}</dt>
            <dd className={css.now}>{data.proposedHero?.name ?? sheet.protagonist}</dd>
          </div>
        )}
        {sheet.length !== undefined && (
          <div className={css.kvRow}>
            <dt>{t('outline.f.length')}</dt>
            <dd className={css.length}>
              {sheet.length.words !== undefined && <span>{t('outline.len.words', { n: sheet.length.words.toLocaleString() })}</span>}
              {sheet.length.volumes !== undefined && <span>{t('outline.len.volumes', { n: sheet.length.volumes })}</span>}
              {sheet.length.chapters !== undefined && <span>{t('outline.len.chapters', { n: sheet.length.chapters })}</span>}
              {sheet.length.perChapter !== undefined && <span>{t('outline.len.perChapter', { n: sheet.length.perChapter.toLocaleString() })}</span>}
            </dd>
          </div>
        )}
      </dl>
      {proposal.volumes !== undefined && (
        <div className={css.proposalVolumes}>
          <span className={css.muted}>{t('outline.proposal.volumes', { count: proposal.volumes.length })}</span>
          <ol>
            {proposal.volumes.map((volume, index) => (
              <li key={`${volume.id}-${index}`}>
                <b>{t('outline.volume', { vol: volumeNumeral(index + 1), title: volume.title })}</b>
                {volume.chapters !== undefined && <span className={css.muted}> · {t('outline.volumeEst', { n: volume.chapters })}</span>}
                {volume.goal !== undefined && <span> · {volume.goal}</span>}
                {volume.landing !== undefined && <span className={css.muted}> · {t('outline.landing')}：{volume.landing}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {proposal.sketches !== undefined && (
        <div className={css.proposalVolumes}>
          <span className={css.muted}>{t('outline.proposal.sketches', { list: proposal.sketches.map(row => row.n).join('、') })}</span>
          <ul>{proposal.sketches.map(row => <li key={row.n}>{`第 ${row.n} 章：${row.line}`}</li>)}</ul>
        </div>
      )}
      {proposal.rationale !== undefined && <p className={css.muted}>{t('outline.proposal.why', { text: proposal.rationale })}</p>}
      <div className={css.acts}>
        <button type="button" className={css.primary} disabled={busy || sessionId === undefined} onClick={() => { void decide('accept') }}>{t('outline.adopt')}</button>
        <button type="button" className={css.button} disabled={busy || sessionId === undefined} onClick={() => { void decide('discard') }}>{t('outline.discard')}</button>
        <span className={css.muted}>{t('outline.proposalHint')}</span>
      </div>
      {failure !== null && <p className={css.warn}>{failure}</p>}
    </div>
  )
}

/** One volume: its head, the chapters filed under it, the sketches ahead, the fold, the landing, what it reveals. */
function Volume({ t, volume, index, chapters, ahead, cores, openChapter }: {
  readonly t: T
  readonly volume: OutlineVolume
  readonly index: number
  /** The chapters filed under this volume. */
  readonly chapters: readonly ChapterRow[]
  /** The sketched chapters ahead (only on the volume being written). */
  readonly ahead: readonly { readonly n: number; readonly line: string }[]
  readonly cores: readonly OutlineCore[]
  readonly openChapter: (n: number, title: string) => void
}): ReactNode {
  const filed = [...chapters].sort((a, b) => a.chapter.seq - b.chapter.seq || a.chapter.n - b.chapter.n)
  const rest = volume.chapters === undefined ? undefined : Math.max(0, volume.chapters - filed.length - ahead.length)
  const reveals = cores.filter(core => core.revealVolume === index)
  return (
    <div className={css.volume}>
      <div className={css.volumeHead}>
        <b>{t('outline.volume', { vol: volumeNumeral(index), title: volume.title })}</b>
        {volume.chapters !== undefined && <span className={css.muted}>{t('outline.volumeEst', { n: volume.chapters })}</span>}
        {volume.goal !== undefined && <span className={css.goal}>{volume.goal}</span>}
      </div>
      {filed.map(row => (
        <button key={row.chapter.n} type="button" className={css.chapter} onClick={() => { openChapter(row.chapter.n, row.chapter.title) }}>
          <span className={css.n}>{`第 ${row.chapter.n} 章`}</span>
          <span className={css.one}>{row.chapter.title}{row.chapter.recap !== undefined && <span className={css.muted}> · {row.chapter.recap}</span>}</span>
          <span className={css.words}>
            {row.chapter.wordCount !== undefined
              ? t('outline.ch.words', { n: row.chapter.wordCount.toLocaleString() })
              : row.chapter.plan?.words !== undefined ? t('outline.ch.target', { n: row.chapter.plan.words.toLocaleString() }) : ''}
          </span>
          <span className={row.phase === 'planning' ? css.tagWarn : css.tagOk}>{t(row.phase === 'planning' ? 'outline.ch.planning' : 'outline.ch.written')}</span>
        </button>
      ))}
      {ahead.map(row => (
        <div key={`s${row.n}`} className={css.chapter} data-sketch="">
          <span className={css.n}>{`第 ${row.n} 章`}</span>
          <span className={css.one}>{row.line}</span>
          <span className={css.words} />
          <span className={css.tagPlain}>{t('outline.ch.sketch')}</span>
        </div>
      ))}
      {rest !== undefined && rest > 0 && <div className={css.fold}>{t('outline.fold', { n: rest })}</div>}
      {volume.landing !== undefined && (
        <div className={css.volumeFoot}><span className={css.muted}>{t('outline.landing')}</span><span>{volume.landing}</span></div>
      )}
      {reveals.length > 0 && (
        <div className={css.volumeFoot}>
          <span className={css.muted}>{t('outline.revealsHere')}</span>
          <span className={css.reveals}>{reveals.map(core => <span key={core.cardId} className={css.reveal}>{core.ref}</span>)}</span>
        </div>
      )}
    </div>
  )
}

/** One core suspense: the question, its reveal, the clues the text laid, the pacing line. */
function Core({ t, core, openCard }: { readonly t: T; readonly core: OutlineCore; readonly openCard: (cardId: string, heading: string) => void }): ReactNode {
  const resolved = core.state === '已揭晓'
  return (
    <div className={css.core}>
      <button type="button" className={css.coreQ} onClick={() => { openCard(core.cardId, core.question) }}>
        {core.starred ? '★ ' : ''}{core.ref} {core.question}
      </button>
      <div className={css.coreMeta}>
        <span className={css.tagPlain}>{t('outline.core.reveal', { when: core.reveal })}</span>
        <span className={css.tagOk}>{t('outline.core.touches', { count: core.touches.length })}</span>
      </div>
      <ol className={css.ladder}>
        {core.touches.map((touch, i) => (
          <li key={i} data-done="">
            <span className={css.pt} />
            <span className={css.at}>{`第 ${touch.chapter} 章`}</span>
            <span>{t(`outline.kind.${touch.kind}`)}{touch.note === undefined ? '' : `：${touch.note}`}</span>
          </li>
        ))}
        {!resolved && (
          <>
            <li data-open="">
              <span className={css.pt} />
              <span className={css.at}>……</span>
              <span>{t('outline.core.grow')}</span>
            </li>
            <li data-end="">
              <span className={css.pt} />
              <span className={css.at}>{core.reveal}</span>
              <span>{t('outline.core.end')}</span>
            </li>
          </>
        )}
      </ol>
      {core.line !== '' && <div className={css.pace} data-nudge={core.nudge || undefined}>{core.line}</div>}
    </div>
  )
}
