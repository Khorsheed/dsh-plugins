/**
 * 文稿 tab: the transcript is the editing surface. A sticky player plays the
 * edit as it will sound (or the original); the paragraph and word being heard
 * are highlighted and followed. Click a phrase to cut/restore it, select any
 * words to cut or correct them, find a keyword to cut or replace every hit.
 * Model cuts and the user's cuts are drawn differently.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChipRow } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { displayTokens, findOccurrences } from '../core/text.ts'
import { formatClock, isRemoved, keptRanges, removedRanges, toOutputTime, toReferenceTime, type Range } from '../core/timeline.ts'
import type { Edit, Project, ProjectView, Segment, Speaker, Token } from '../types.ts'
import type { RemoteResult, VideoPaneProps } from './contract.ts'
import type { VideoStudioKey } from './locales.ts'
import { TranscriptPlayer } from './player.ts'
import css from './VideoPane.module.css'

type T = VideoPaneProps['t']
type Act = (fn: () => Promise<RemoteResult<ProjectView>>) => Promise<void>

type Filter = 'all' | 'pending' | 'user' | 'agent' | 'hits'
type Mode = 'edited' | 'original'
const PAGE = 60
const EPS = 1e-3

async function value<V>(answer: Promise<RemoteResult<V>>): Promise<V> {
  const result = await answer
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

interface Phrase {
  tokens: Token[]
  start: number
  end: number
}

function phrasesOf(tokens: readonly Token[]): Phrase[] {
  const out: Phrase[] = []
  let cur: Token[] = []
  const flush = () => {
    const first = cur[0]
    const last = cur[cur.length - 1]
    if (first && last) out.push({ tokens: cur, start: first.start, end: last.end })
    cur = []
  }
  for (const tok of tokens) {
    cur.push(tok)
    if (/[，。？！、,.?!；;]/u.test(tok.text)) flush()
  }
  flush()
  return out
}

function speakerLabel(t: T, project: Project, sp: Speaker | undefined): string {
  if (!sp) return '?'
  return sp.name || t('speakers.unnamed', { n: String(project.speakers.indexOf(sp) + 1) })
}

interface Selection {
  start: number
  end: number
  text: string
}

export function TranscriptTab({ p, v, act }: { p: VideoPaneProps; v: ProjectView; act: Act }): ReactNode {
  const { t } = p
  const project = v.project
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  const [mode, setMode] = useState<Mode>('edited')
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState(0)
  const [follow, setFollow] = useState(true)
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [remember, setRemember] = useState(true)
  const [sel, setSel] = useState<Selection | null>(null)
  const [fixDraft, setFixDraft] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const sentinel = useRef<HTMLDivElement | null>(null)

  const edits = project.edits
  const removed = useMemo(() => removedRanges(v.durationSec, edits), [v.durationSec, edits])
  const kept = useMemo(() => keptRanges(v.durationSec, edits), [v.durationSec, edits])
  const proposed = useMemo(() => edits.filter((e) => e.state === 'proposed'), [edits])
  const appliedCuts = useMemo(() => edits.filter((e) => e.state === 'applied' && (e.kind === 'cut' || e.kind === 'shorten')), [edits])
  const speakers = useMemo(() => new Map(project.speakers.map((s) => [s.id, s])), [project.speakers])
  const groups = useMemo(() => project.groups.filter((g) => proposed.some((e) => e.group === g.id)), [project.groups, proposed])
  const hits = useMemo(() => (finding ? findOccurrences(project.transcript, edits, query) : []), [finding, project.transcript, edits, query])

  // ── player ──
  const player = useMemo(() => new TranscriptPlayer(
    (start, duration) => value(p.audioChunk({ projectId: project.id, start, duration })),
    () => setPlaying(false),
  ), [project.id])
  useEffect(() => () => player.dispose(), [player])
  useEffect(() => {
    player.setRanges(mode === 'edited' ? kept : [{ start: 0, end: v.durationSec }])
  }, [player, mode, kept, v.durationSec])
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = 0
    const tick = (ts: number) => {
      if (ts - last > 120) {
        last = ts
        setNow(player.currentRef())
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, player])
  const playFrom = (ref: number) => {
    player.play(ref)
    setNow(ref)
    setPlaying(true)
  }
  const toggle = () => {
    if (player.isPlaying) {
      player.pause()
      setPlaying(false)
    } else playFrom(now >= v.durationSec - 0.1 ? 0 : now)
  }

  // ── filtering / paging ──
  const cutsBy = (origin: 'user' | 'agent') => appliedCuts.filter((e) => e.origin === origin)
  const touches = (seg: Segment, list: readonly { start: number; end: number }[]) => list.some((r) => r.start < seg.end && r.end > seg.start)
  const segs = project.transcript.filter((s) =>
    filter === 'all' ? true
      : filter === 'pending' ? touches(s, proposed)
        : filter === 'hits' ? hits.some((h) => h.segmentId === s.id)
          : touches(s, cutsBy(filter)))
  const activeIndex = segs.findIndex((s) => now >= s.start && now < s.end)
  const activeId = activeIndex >= 0 ? segs[activeIndex]!.id : null

  // follow: make sure the active paragraph is rendered, then centre it
  useEffect(() => {
    if (!playing || !follow || activeIndex < 0) return
    if (activeIndex >= limit) {
      setLimit(activeIndex + PAGE)
      return
    }
    listRef.current?.querySelector(`[data-seg="${activeId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId, playing, follow, limit])

  // auto-load more as the end of the list scrolls into view
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE)
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [segs.length > limit])

  // ── selection ──
  const readSelection = () => {
    const s = window.getSelection()
    const root = listRef.current
    if (!s || s.isCollapsed || !root) return
    let start = Infinity
    let end = -Infinity
    let text = ''
    root.querySelectorAll<HTMLElement>('[data-s]').forEach((el) => {
      if (!s.containsNode(el, true)) return
      start = Math.min(start, Number(el.dataset.s))
      end = Math.max(end, Number(el.dataset.e))
      text += el.textContent ?? ''
    })
    if (Number.isFinite(start) && end > start) {
      setSel({ start, end, text })
      setFixDraft(null)
    }
  }
  const clearSel = () => {
    setSel(null)
    setFixDraft(null)
    window.getSelection()?.removeAllRanges()
  }

  if (!project.transcript.length) return <div className={css.empty}>{t('transcript.empty')}</div>

  const userCount = project.transcript.filter((s) => touches(s, cutsBy('user'))).length
  const agentCount = project.transcript.filter((s) => touches(s, cutsBy('agent'))).length
  const pendingCount = project.transcript.filter((s) => touches(s, proposed)).length
  const outNow = mode === 'edited' ? toOutputTime(now, removed) : now
  const outTotal = mode === 'edited' ? v.outputSec : v.durationSec

  return (
    <>
      <div className={css.actions}>
        <span className={css.stats}>{t('transcript.stats', { duration: formatClock(v.durationSec), output: formatClock(v.outputSec) })}</span>
        <button type="button" className={css.btn} aria-pressed={finding} onClick={() => { setFinding((f) => !f); if (finding && filter === 'hits') setFilter('all') }}>{t('find.toggle')}</button>
        <button type="button" className={css.btn} onClick={() => void act(() => p.scan(project.id))}>{t('transcript.scan')}</button>
      </div>

      {finding && (
        <div className={css.findBar}>
          <input id="vs-find" className={css.inlineInput} value={query} placeholder={t('find.placeholder')} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <span className={css.muted}>{query.trim() ? t('find.count', { count: String(hits.length) }) : ''}</span>
          <button type="button" className={css.btn} disabled={!hits.length} onClick={() => setFilter('hits')}>{t('find.show')}</button>
          <button type="button" className={css.danger} disabled={!hits.length} onClick={() => void act(() => p.cutMatches({ projectId: project.id, needle: query }))}>{t('find.cutAll')}</button>
          <div className={css.findRow}>
            <input id="vs-replace" className={css.inlineInput} value={replacement} placeholder={t('find.replacePlaceholder')} onChange={(e) => setReplacement(e.target.value)} />
            <label className={css.check}><input id="vs-remember" type="checkbox" checked={remember} disabled={!project.showId} onChange={(e) => setRemember(e.target.checked)} />{t('find.remember')}</label>
            <button type="button" className={css.btn} disabled={!query.trim() || (!hits.length && !remember)}
              onClick={() => void act(() => p.replaceAll({ projectId: project.id, from: query, to: replacement, remember: remember && !!project.showId }))}>{t('find.replaceAll')}</button>
          </div>
        </div>
      )}

      {groups.map((g) => {
        const items = proposed.filter((e) => e.group === g.id)
        const saved = items.reduce((a, e) => a + (e.kind === 'shorten' ? Math.max(0, e.end - e.start - (e.value ?? 0)) : e.kind === 'cut' ? e.end - e.start : 0), 0)
        return (
          <div key={g.id} className={css.prop}>
            <div className={css.propHead}>{g.title}</div>
            <div className={css.actions}>
              <span className={css.muted}>{saved > 0 ? t('proposal.items', { count: String(items.length), saved: formatClock(saved) }) : t('proposal.textItems', { count: String(items.length) })}</span>
              <button type="button" className={css.btn} onClick={() => void act(() => p.decide({ projectId: project.id, groupId: g.id, state: 'rejected' }))}>✗ {t('action.reject')}</button>
              <button type="button" className={css.primary} onClick={() => void act(() => p.decide({ projectId: project.id, groupId: g.id, state: 'applied' }))}>✓ {t('action.accept')}</button>
            </div>
          </div>
        )
      })}

      <ChipRow
        label={t('tabs.transcript')}
        value={filter}
        onSelect={(id: Filter) => { setFilter(id); setLimit(PAGE) }}
        chips={[
          { id: 'all', label: t('transcript.filterAll') },
          { id: 'pending', label: t('transcript.filterPending'), count: pendingCount },
          { id: 'user', label: t('transcript.filterUser'), count: userCount },
          { id: 'agent', label: t('transcript.filterAgent'), count: agentCount },
          ...(finding && query.trim() ? [{ id: 'hits' as const, label: t('transcript.filterHits'), count: new Set(hits.map((h) => h.segmentId)).size }] : []),
        ]}
      />
      <div className={css.legend}>
        <span><i className={css.swUser} />{t('legend.user')}</span>
        <span><i className={css.swAgent} />{t('legend.agent')}</span>
        <span><i className={css.swProp} />{t('legend.proposed')}</span>
        <span className={css.muted}>{t('transcript.hint')}</span>
      </div>

      <div ref={listRef} className={css.list} onMouseUp={readSelection}>
        {segs.slice(0, limit).map((seg) => (
          <Paragraph key={seg.id} t={t} project={project} seg={seg} sp={speakers.get(seg.speakerId)} removed={removed} appliedCuts={appliedCuts}
            proposed={proposed} hits={hits} now={now} active={seg.id === activeId} playing={playing} edits={edits}
            onCut={(start, end, cut) => void act(() => p.setCut({ projectId: project.id, start, end, cut }))}
            onPlay={() => playFrom(seg.start)}
            onReassign={(speakerId) => void act(() => p.reassignSegment({ projectId: project.id, segmentId: seg.id, speakerId }))} />
        ))}
        {segs.length > limit && <div ref={sentinel} className={css.muted}>{t('state.loading')}</div>}
      </div>

      {sel && (
        <div className={css.selBar}>
          {fixDraft === null ? (
            <>
              <span className={css.selText}>「{sel.text}」</span>
              <button type="button" className={css.danger} onClick={() => { void act(() => p.setCut({ projectId: project.id, start: sel.start, end: sel.end, cut: true })); clearSel() }}>{t('select.cut')}</button>
              <button type="button" className={css.btn} onClick={() => { void act(() => p.setCut({ projectId: project.id, start: sel.start, end: sel.end, cut: false })); clearSel() }}>{t('select.restore')}</button>
              <button type="button" className={css.btn} onClick={() => setFixDraft(sel.text)}>{t('select.fix')}</button>
              <button type="button" className={css.btn} onClick={() => { playFrom(sel.start) }}>▶</button>
              <button type="button" className={css.iconBtn} aria-label={t('action.cancel')} onClick={clearSel}>×</button>
            </>
          ) : (
            <form className={css.selFix} onSubmit={(e) => { e.preventDefault(); void act(() => p.fixText({ projectId: project.id, start: sel.start, end: sel.end, text: fixDraft })); clearSel() }}>
              <input id="vs-fix" className={css.inlineInput} value={fixDraft} onChange={(e) => setFixDraft(e.target.value)} autoFocus />
              <button type="submit" className={css.primary}>{t('action.save')}</button>
              <button type="button" className={css.btn} onClick={() => setFixDraft(null)}>{t('action.cancel')}</button>
              <span className={css.muted}>{t('select.fixHint')}</span>
            </form>
          )}
        </div>
      )}

      <div className={css.playerBar}>
        <button type="button" className={css.playBtn} aria-label={playing ? t('action.stop') : t('action.play')} onClick={toggle}>{playing ? '❚❚' : '▶'}</button>
        <span className={css.seg}>
          <button type="button" data-on={mode === 'edited'} onClick={() => setMode('edited')}>{t('player.edited')}</button>
          <button type="button" data-on={mode === 'original'} onClick={() => setMode('original')}>{t('player.original')}</button>
        </span>
        <input id="vs-scrub" className={css.scrub} type="range" min={0} max={Math.max(1, outTotal)} step={0.1} value={Math.min(outNow, outTotal)} aria-label={t('player.position')}
          onChange={(e) => {
            const out = Number(e.target.value)
            const ref = mode === 'edited' ? toReferenceTime(out, removed) : out
            setNow(ref)
            player.seek(ref)
          }} />
        <span className={css.time}>{formatClock(outNow)} / {formatClock(outTotal)}</span>
        <label className={css.check}><input id="vs-follow" type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />{t('player.follow')}</label>
      </div>
    </>
  )
}

function Paragraph({ t, project, seg, sp, removed, appliedCuts, proposed, hits, now, active, playing, edits, onCut, onPlay, onReassign }: {
  t: T; project: Project; seg: Segment; sp: Speaker | undefined; removed: Range[]; appliedCuts: Edit[]; proposed: Edit[]
  hits: { start: number; end: number }[]; now: number; active: boolean; playing: boolean; edits: Edit[]
  onCut: (start: number, end: number, cut: boolean) => void; onPlay: () => void; onReassign: (speakerId: string) => void
}): ReactNode {
  const [menu, setMenu] = useState(false)
  const tokens = useMemo(() => displayTokens(seg, edits), [seg, edits])
  const phrases = useMemo(() => phrasesOf(tokens), [tokens])
  const cutBy = (tok: Token): Edit | undefined => appliedCuts.find((e) => e.start <= tok.start + EPS && e.end >= tok.end - EPS && tok.end - tok.start > EPS)
  const inProposal = (tok: Token) => proposed.find((x) => x.kind === 'cut' && x.start <= tok.start + EPS && x.end >= tok.end - EPS && tok.end - tok.start > EPS)
  const isHit = (tok: Token) => hits.some((h) => h.start <= tok.start + EPS && h.end >= tok.end - EPS)
  const fixed = (tok: Token) => edits.some((e) => e.kind === 'text' && e.state === 'applied' && Math.abs(e.start - tok.start) < EPS && Math.abs(e.end - tok.end) < EPS)
  const pieces: ReactNode[] = []
  phrases.forEach((ph, i) => {
    const prev = phrases[i - 1]
    if (prev) {
      const gap = ph.start - prev.end
      const shorten = edits.find((x) => x.kind === 'shorten' && x.state !== 'rejected' && x.start <= prev.end + EPS && x.end >= ph.start - EPS)
      if (gap >= 1 || shorten) pieces.push(<span key={`g${i}`} className={css.pause} data-proposed={shorten?.state === 'proposed'}>{t('transcript.pause', { sec: gap.toFixed(1) })}{shorten ? ` → ${(shorten.value ?? 0).toFixed(1)}` : ''}</span>)
    }
    const whole = isRemoved(ph.start, ph.end, removed)
    pieces.push(
      <span key={i} className={css.phrase} role="button" tabIndex={0}
        onClick={() => {
          // a drag-selection is handled by the selection bar, not as a click
          if (window.getSelection()?.isCollapsed === false) return
          onCut(ph.start, ph.end, !whole)
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCut(ph.start, ph.end, !whole) } }}>
        {ph.tokens.map((tok, k) => {
          const cut = cutBy(tok)
          const prop = inProposal(tok)
          const nowTok = active && now >= tok.start && now < tok.end
          return (
            <span key={k} className={css.tok} data-s={tok.start} data-e={tok.end}
              data-cut={cut ? cut.origin : undefined} data-proposed={prop ? true : undefined} data-hit={isHit(tok) || undefined}
              data-now={nowTok || undefined} data-fixed={fixed(tok) || undefined}
              title={cut?.reason ?? prop?.reason ?? (fixed(tok) ? t('select.fixedFrom', { from: edits.find((e) => e.kind === 'text' && e.state === 'applied' && Math.abs(e.start - tok.start) < EPS)?.from ?? '' }) : undefined)}>{tok.text}</span>
          )
        })}
      </span>,
    )
  })
  const lastEnd = seg.tokens[seg.tokens.length - 1]?.end ?? seg.end
  const tail = edits.find((x) => x.kind === 'shorten' && x.state !== 'rejected' && Math.abs(x.start - lastEnd) < 0.05)
  if (tail) pieces.push(<span key="tail" className={css.pause} data-proposed={tail.state === 'proposed'}>{t('transcript.pause', { sec: (tail.end - tail.start).toFixed(1) })} → {(tail.value ?? 0).toFixed(1)}</span>)
  return (
    <div className={css.para} data-seg={seg.id} data-active={active || undefined} data-playing={(active && playing) || undefined}>
      <div className={css.who}>
        <button type="button" className={`${css.whoName} ${css[`sp_${sp?.color ?? 's1'}`] ?? ''}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu} title={t('transcript.reassign')}>{speakerLabel(t, project, sp)}</button>
        <span className={css.whoMeta}>
          <button type="button" className={css.timeBtn} onClick={onPlay} title={t('player.fromHere')}>{formatClock(seg.start)} ▶</button>
        </span>
        {menu && (
          <select id={`vs-reassign-${seg.id}`} className={css.select} value={seg.speakerId} aria-label={t('transcript.reassign')}
            onChange={(e) => { setMenu(false); onReassign(e.target.value) }}>
            {project.speakers.map((x) => <option key={x.id} value={x.id}>{speakerLabel(t, project, x)}</option>)}
          </select>
        )}
      </div>
      <div className={css.line}>{pieces}</div>
    </div>
  )
}

export type { VideoStudioKey }
