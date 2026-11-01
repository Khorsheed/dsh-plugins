/**
 * 设定, the novel's own face in the canvas's 卡板 seat (2026-11-01): the book
 * as a world, not a wall of cards. Five parts behind one row of pills:
 *
 * - 总览: the one-page outline (and the proposal waiting on the person), the
 *   four shelves at a glance, the settings still 待定, the 写作原则, and — on a
 *   book from before the shelves — the way to 整理设定;
 * - 世界观: a tree on the left (体系 · 地点 · 势力 · 物种与道具, each entry
 *   under what it belongs to), the picked entry on the right with its links
 *   both ways and the chapters that used it;
 * - 人物: grouped by faction, each with 此刻 / 打算 / 相信的事;
 * - 关系: the pairs as a graph, scrubbed by chapter;
 * - 伏笔: the questions by when they are revealed, each a ladder of what the
 *   reader knows chapter by chapter, topped by the answer.
 *
 * Editing a card is its own page (编辑卡片 opens it); this face reads.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useMemo, useState, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, type CodexCharacter, type CodexForeshadow, type CodexSetting, type NovelCodexResult } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { OnePage } from './OnePage.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './codex.module.css'

type T = NovelSurfaceProps['t']
type Part = 'overview' | 'world' | 'people' | 'relations' | 'foreshadow'
const SHELVES = ['system', 'place', 'faction', 'item'] as const

/** A setting's name without the bracketed asides its title often carries (「命名（工作稿）」 → 命名). */
export function shortName(name: string): string {
  return name.replace(/[（(](?:工作稿|暂定|待定|草稿)[）)]/g, '').trim() || name
}

/** The 设定 face (keyed `novel:codex`); nothing on a canvas of another genre. */
export function CodexView(props: NovelSurfaceProps): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <Codex {...props} />
}

function Codex(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.codex({ canvasId }), `codex:${canvasId}`, rev)
  const [part, setPart] = useState<Part>('overview')
  const [picked, setPicked] = useState<string | null>(null)
  const [onlyOpen, setOnlyOpen] = useState(false)
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.page}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.page}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  if (!read.value.ok) return <div className={css.page}><div className={css.warn}>{t(errorKey(read.value.error))}</div></div>
  const data = read.value
  const go = (next: Part, cardId?: string, unsettled = false): void => { setPart(next); setPicked(cardId ?? null); setOnlyOpen(unsettled) }
  const parts: readonly [Part, string, number | undefined][] = [
    ['overview', t('codex.overview'), undefined],
    ['world', t('codex.world'), data.settings?.length ?? 0],
    ['people', t('codex.people'), data.characters?.length ?? 0],
    ['relations', t('codex.relations'), data.relations?.length ?? 0],
    ['foreshadow', t('codex.foreshadow'), data.foreshadows?.length ?? 0],
  ]
  return (
    <div className={css.page} data-canvas-scroll="novel-codex">
      <nav className={css.pills} aria-label={t('codex.parts')}>
        {parts.map(([id, label, count]) => (
          <button key={id} type="button" aria-pressed={part === id} onClick={() => { go(id) }}>
            {label}{count === undefined ? null : <span className={css.count}>{count}</span>}
          </button>
        ))}
      </nav>
      {part === 'overview' && <Overview {...props} data={data} go={go} />}
      {part === 'world' && <World data={data} picked={picked} onPick={setPicked} onlyOpen={onlyOpen} setOnlyOpen={setOnlyOpen} openCard={props.navigate.openCard} openChapter={n => { props.navigate.openManuscripts(String(n)) }} t={t} />}
      {part === 'people' && <People data={data} openCard={props.navigate.openCard} t={t} />}
      {part === 'relations' && <Relations data={data} openCard={props.navigate.openCard} t={t} />}
      {part === 'foreshadow' && <Foreshadows data={data} picked={picked} onPick={setPicked} openCard={props.navigate.openCard} openChapter={n => { props.navigate.openManuscripts(String(n)) }} send={props.sessionId !== undefined && props.sendToConversation !== undefined ? text => { props.sendToConversation?.(props.sessionId!, text) } : undefined} t={t} />}
    </div>
  )
}

/* ------------------------------------------------------------------ 总览 */

function Overview(props: NovelSurfaceProps & { readonly data: NovelCodexResult; readonly go: (part: Part, cardId?: string, unsettled?: boolean) => void }): ReactNode {
  const { data, go, t, sessionId } = props
  const settings = data.settings ?? []
  const unsettled = settings.filter(row => row.unsettled)
  const principles = data.principles ?? []
  const people = data.characters ?? []
  const byId = new Map(settings.map(row => [row.cardId, row]))
  const names = new Map(people.map(row => [row.cardId, row.name]))
  const relations = data.relations ?? []
  const foreshadows = data.foreshadows ?? []
  const openReveal = foreshadows.filter(row => row.reveal === undefined && row.state !== '已揭晓').length
  return (
    <div className={css.stack}>
      {(data.unorganized ?? 0) > 0 && (
        <div className={css.notice}>
          <span>{t('world.unorganized', { count: data.unorganized ?? 0 })}</span>
          {sessionId !== undefined && props.sendToConversation !== undefined && (
            <button type="button" className={css.button} onClick={() => { props.sendToConversation?.(sessionId, t('world.organizeAsk')) }}>{t('world.organize')}</button>
          )}
        </div>
      )}
      <OnePage {...props} />
      {people.length > 0 && (
        <section className={css.section}>
          <h3 className={css.h3}>{t('codex.people')}<span className={css.h3Meta}>{people.length}</span><span className={css.grow} /><button type="button" className={css.link} onClick={() => { go('people') }}>{t('onepage.allPeople')}</button></h3>
          <div className={css.index}>
            {people.slice(0, PEOPLE_SHOWN).map(person => (
              <button key={person.cardId} type="button" className={css.personRow} onClick={() => { go('people') }}>
                <span className={css.personRowName}>{shortName(person.name)}</span>
                <span className={css.personRowFac}>{person.factions[0] === undefined ? '—' : shortName(byId.get(person.factions[0])?.name ?? '')}</span>
                <span className={css.personRowNow}>
                  {person.intent !== undefined
                    ? <><em>{t('card.intent')}</em>{person.intent}</>
                    : <><em>{t('codex.now')}</em>{[person.where, person.state].filter(Boolean).join('；') || '—'}</>}
                </span>
              </button>
            ))}
          </div>
          {people.length > PEOPLE_SHOWN && <button type="button" className={css.link} onClick={() => { go('people') }}>{t('onepage.morePeople', { count: people.length - PEOPLE_SHOWN })}</button>}
          {(relations.length > 0 || foreshadows.length > 0) && (
            <div className={css.glance}>
              {relations.length > 0 && (
                <button type="button" className={css.link} onClick={() => { go('relations') }}>
                  {t('onepage.relations', { count: relations.length, first: relations[0]!.pair.map(id => names.get(id) ?? '').join(' ↔ ') })}
                </button>
              )}
              {foreshadows.length > 0 && (
                <button type="button" className={css.link} onClick={() => { go('foreshadow') }}>
                  {openReveal > 0 ? t('onepage.foreshadowsOpen', { count: foreshadows.length, open: openReveal }) : t('onepage.foreshadows', { count: foreshadows.length })}
                </button>
              )}
            </div>
          )}
        </section>
      )}
      <section className={css.section}>
        <h3 className={css.h3}>
          {t('codex.world')}<span className={css.h3Meta}>{t('onepage.settingCount', { count: settings.length })}</span><span className={css.grow} />
          {unsettled.length > 0 && <button type="button" className={css.link} onClick={() => { go('world', undefined, true) }}><i className={css.dot} />{t('onepage.unsettled', { count: unsettled.length })}</button>}
        </h3>
        <div className={css.index}>
          {SHELVES.map(sort => {
            const rows = settings.filter(row => row.sort === sort)
            const roots = rows.filter(row => !row.parents.some(id => rows.some(other => other.cardId === id)))
            const ordered = [...roots, ...rows.filter(row => !roots.includes(row))]
            return (
              <div key={sort} className={css.shelfRow}>
                <span className={css.shelfKey}>{t(`world.shelf.${sort}`)}<i>{rows.length}</i></span>
                <span className={css.shelfNames}>
                  {rows.length === 0 ? <span className={css.mutedInline}>{t('world.shelfEmpty')}</span> : ordered.slice(0, 8).map((row, index) => (
                    <span key={row.cardId}>
                      {index > 0 && <span className={css.sep}>·</span>}
                      <button type="button" className={css.nameLink} onClick={() => { go('world', row.cardId) }}>{shortName(row.name)}</button>
                    </span>
                  ))}
                </span>
                {rows.length > 0 && <button type="button" className={css.link} onClick={() => { go('world', ordered[0]!.cardId) }}>{t('onepage.all')}</button>}
              </div>
            )
          })}
        </div>
      </section>
      {principles.length > 0 && (
        <section className={css.section}>
          <h3 className={css.h3}>{t('onepage.principles')}<span className={css.h3Meta}>{t('onepage.principlesHint')}</span></h3>
          <ol className={css.rules}>
            {principles.map(row => {
              const [lead, rest] = splitLead(row.text)
              return <li key={row.cardId}>{lead !== undefined && <b>{lead}</b>}<span className={css.clamp2}>{rest}</span></li>
            })}
          </ol>
        </section>
      )}
    </div>
  )
}

/** People listed on 总览 before 「还有 N 人」. */
const PEOPLE_SHOWN = 8

/** 「全书命题（工作稿）：书写……」 → [「全书命题。」, 「书写……」]; a principle without a short lead stays whole. */
function splitLead(text: string): [string | undefined, string] {
  const m = /^([^：:。\n]{2,24})[：:]\s*/.exec(text)
  if (m === null) return [undefined, text]
  return [`${shortName(m[1]!)}。`, text.slice(m[0].length)]
}

/* ---------------------------------------------------------------- 世界观 */

function World({ data, picked, onPick, onlyOpen, setOnlyOpen, openCard, openChapter, t }: {
  readonly data: NovelCodexResult
  readonly picked: string | null
  readonly onPick: (cardId: string) => void
  readonly onlyOpen: boolean
  readonly setOnlyOpen: (value: boolean) => void
  readonly openCard: (cardId: string, heading: string) => void
  readonly openChapter: (n: number) => void
  readonly t: T
}): ReactNode {
  const settings = data.settings ?? []
  const byId = useMemo(() => new Map(settings.map(row => [row.cardId, row])), [settings])
  const open = settings.filter(row => row.unsettled)
  const listed = onlyOpen ? open : settings
  const current = (picked === null ? undefined : byId.get(picked)) ?? listed[0] ?? settings[0]
  if (settings.length === 0) return <p className={css.empty}>{t('world.empty')}</p>
  const childrenOf = (id: string, sort: string): CodexSetting[] => settings.filter(row => row.sort === sort && row.parents.includes(id))
  const node = (row: CodexSetting, depth: number): ReactNode => (
    <button key={row.cardId} type="button" className={css.node} style={{ ['--d' as string]: depth }} data-guide={depth > 0 || undefined} aria-current={row.cardId === current?.cardId || undefined} onClick={() => { onPick(row.cardId) }}>
      <span className={css.nodeName}>{shortName(row.name)}</span>
      {row.unsettled && <i className={css.dot} title={t('world.unsettled')} />}
    </button>
  )
  const walk = (row: CodexSetting, depth: number, seen: ReadonlySet<string>): ReactNode[] => [
    node(row, depth),
    ...childrenOf(row.cardId, row.sort).filter(child => !seen.has(child.cardId)).flatMap(child => walk(child, depth + 1, new Set([...seen, child.cardId]))),
  ]
  return (
    <div className={css.split}>
      <nav className={css.side} aria-label={t('codex.world')}>
        {open.length > 0 && (
          <div className={css.seg} role="group" aria-label={t('onepage.filter')}>
            <button type="button" aria-pressed={!onlyOpen} onClick={() => { setOnlyOpen(false) }}>{t('onepage.filterAll', { count: settings.length })}</button>
            <button type="button" aria-pressed={onlyOpen} onClick={() => { setOnlyOpen(true) }}>{t('onepage.filterOpen', { count: open.length })}</button>
          </div>
        )}
        {SHELVES.map(sort => {
          const rows = settings.filter(row => row.sort === sort)
          if (rows.length === 0) return null
          if (onlyOpen) {
            const flagged = rows.filter(row => row.unsettled)
            if (flagged.length === 0) return null
            return <div key={sort} className={css.sideGroup}><h4>{t(`world.shelf.${sort}`)} · {flagged.length}</h4>{flagged.map(row => node(row, 0))}</div>
          }
          const roots = rows.filter(row => !row.parents.some(id => rows.some(other => other.cardId === id)))
          return <div key={sort} className={css.sideGroup}><h4>{t(`world.shelf.${sort}`)} · {rows.length}</h4>{roots.flatMap(row => walk(row, 0, new Set([row.cardId])))}</div>
        })}
      </nav>
      {current !== undefined && <SettingDetail setting={current} data={data} byId={byId} onPick={onPick} openCard={openCard} openChapter={openChapter} t={t} />}
    </div>
  )
}

/** A setting's text as it is written: 「键：值」 lines become rows, 未决 its own box, 状态 goes to the head. */
export function settingParts(text: string): { readonly rows: { readonly key?: string; readonly text: string }[]; readonly open: readonly string[]; readonly status?: string } {
  const rows: { key?: string; text: string }[] = []
  const open: string[] = []
  let status: string | undefined
  for (const line of text.replace(/\\n/g, '\n').split('\n').map(item => item.trim()).filter(Boolean)) {
    const m = /^([^：:，。,\s]{1,6})[：:]\s*(.+)$/.exec(line)
    if (m === null) { rows.push({ text: line }); continue }
    const [, key, value] = m as unknown as [string, string, string]
    if (key === '状态') { status = value; continue }
    if (/^(未决|未定|待定|待决)$/.test(key)) { open.push(...value.replace(/[。.]$/, '').split(/[、；;]/).map(item => item.trim()).filter(Boolean)); continue }
    rows.push({ key, text: value })
  }
  return { rows, open, ...(status === undefined ? {} : { status }) }
}

function SettingDetail({ setting, data, byId, onPick, openCard, openChapter, t }: {
  readonly setting: CodexSetting
  readonly data: NovelCodexResult
  readonly byId: ReadonlyMap<string, CodexSetting>
  readonly onPick: (cardId: string) => void
  readonly openCard: (cardId: string, heading: string) => void
  readonly openChapter: (n: number) => void
  readonly t: T
}): ReactNode {
  const settings = data.settings ?? []
  const chain: CodexSetting[] = []
  let up = setting.parents[0] === undefined ? undefined : byId.get(setting.parents[0])
  while (up !== undefined && !chain.includes(up) && chain.length < 6) { chain.unshift(up); up = up.parents[0] === undefined ? undefined : byId.get(up.parents[0]) }
  const children = settings.filter(row => row.parents.includes(setting.cardId))
  const based = settings.filter(row => row.base.includes(setting.cardId))
  const people = (data.characters ?? []).filter(row => row.factions.includes(setting.cardId) || row.homes.includes(setting.cardId))
  const link = (row: CodexSetting): ReactNode => <button key={row.cardId} type="button" className={css.chip} onClick={() => { onPick(row.cardId) }}>{shortName(row.name)}</button>
  const rels: [string, ReactNode][] = [
    ...(setting.parents.length === 0 ? [] : [[t('card.link.parent'), setting.parents.map(id => byId.get(id)).filter((row): row is CodexSetting => row !== undefined).map(link)] as [string, ReactNode]]),
    ...(setting.base.length === 0 ? [] : [[t('card.link.base'), setting.base.map(id => byId.get(id)).filter((row): row is CodexSetting => row !== undefined).map(link)] as [string, ReactNode]]),
    ...(children.length === 0 ? [] : [[t('card.link.children'), children.map(link)] as [string, ReactNode]]),
    ...(based.length === 0 ? [] : [[t('card.link.based'), based.map(link)] as [string, ReactNode]]),
    ...(people.length === 0 ? [] : [[t('card.link.people'), people.map(row => <button key={row.cardId} type="button" className={css.chip} onClick={() => { openCard(row.cardId, row.name) }}>{row.name}</button>)] as [string, ReactNode]]),
    ...(setting.chapters.length === 0 ? [] : [[t('card.link.chapters'), setting.chapters.map(n => <button key={n} type="button" className={css.chap} onClick={() => { openChapter(n) }}>{t('card.inChapter', { n })}</button>)] as [string, ReactNode]]),
  ]
  const parts = settingParts(setting.text)
  return (
    <article className={css.detail}>
      <header className={css.dHead}>
        <div className={css.crumbs}>{[t(`world.shelf.${setting.sort}`), ...chain.map(row => shortName(row.name))].join(' › ')}</div>
        <button type="button" className={css.ghost} onClick={() => { openCard(setting.cardId, shortName(setting.name)) }}>{t('codex.edit')}</button>
        <h2>{shortName(setting.name)}</h2>
        <div className={css.dMeta}>
          {setting.unsettled && <span className={css.pillWarn}>{t('world.unsettled')}</span>}
          <span>{setting.chapters.length === 0 ? t('codex.noChapters') : t('onepage.inChapters', { list: setting.chapters.join('、') })}</span>
          {children.length > 0 && <span>· {t('onepage.children', { count: children.length })}</span>}
        </div>
      </header>
      {parts.rows.length > 0 && (
        <dl className={css.kv}>
          {parts.rows.map((row, index) => row.key === undefined
            ? <p key={index} className={css.kvPara}>{row.text}</p>
            : <div key={index}><dt>{row.key}</dt><dd>{row.text}</dd></div>)}
        </dl>
      )}
      {(parts.open.length > 0 || (setting.unsettled && parts.status !== undefined)) && (
        <div className={css.openQ}>
          <b>{t('onepage.openHead')}</b>
          {parts.open.length > 0 && <ul>{parts.open.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          <span className={css.mutedInline}>{[t('codex.unsettledHint'), parts.status].filter(Boolean).join(' ')}</span>
        </div>
      )}
      {rels.length > 0 && (
        <dl className={css.links}>
          {rels.map(([label, value]) => <div key={label} className={css.linkRow}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ 人物 */

function People({ data, openCard, t }: { readonly data: NovelCodexResult; readonly openCard: (cardId: string, heading: string) => void; readonly t: T }): ReactNode {
  const people = data.characters ?? []
  const settings = new Map((data.settings ?? []).map(row => [row.cardId, row]))
  if (people.length === 0) return <p className={css.empty}>{t('codex.noPeople')}</p>
  const groups = new Map<string, CodexCharacter[]>()
  for (const person of people) {
    const key = person.factions[0] === undefined ? '' : person.factions[0]
    groups.set(key, [...(groups.get(key) ?? []), person])
  }
  const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0))
  return (
    <div className={css.stack}>
      {order.map(key => (
        <section key={key || 'none'} className={css.section}>
          <h4 className={css.groupHead}>{key === '' ? t('codex.noFaction') : shortName(settings.get(key)?.name ?? key)}</h4>
          <div className={css.people}>
            {groups.get(key)!.map(person => (
              <article key={person.cardId} className={css.person}>
                <header className={css.personHead}>
                  <button type="button" className={css.personName} onClick={() => { openCard(person.cardId, person.name) }}>{person.name}</button>
                  {person.identity !== undefined && <span className={css.muted}>{person.identity}</span>}
                </header>
                <dl className={css.personRows}>
                  <dt>{t('codex.now')}</dt>
                  <dd>{[person.where ?? (person.homes[0] === undefined ? undefined : shortName(settings.get(person.homes[0])?.name ?? '')), person.state].filter(Boolean).join('；') || '—'}</dd>
                  <dt>{t('card.intent')}</dt>
                  <dd>{person.intent ?? '—'}</dd>
                  <dt>{t('card.beliefs')}</dt>
                  <dd>
                    {person.beliefs.length === 0 ? '—' : (
                      <ul className={css.beliefs}>
                        {person.beliefs.map((row, index) => <li key={index}><span className={css.how} data-how={row.source ?? '亲历'}>{row.source ?? '亲历'}</span>{row.text}<span className={css.muted}> {t('card.inChapter', { n: row.chapter })}</span></li>)}
                      </ul>
                    )}
                  </dd>
                  {person.secrets.length > 0 && <><dt>{t('codex.secrets')}</dt><dd>{person.secrets.join('；')}</dd></>}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
      <p className={css.muted}>{t('codex.peopleHint')}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ 关系 */

function Relations({ data, openCard, t }: { readonly data: NovelCodexResult; readonly openCard: (cardId: string, heading: string) => void; readonly t: T }): ReactNode {
  const relations = data.relations ?? []
  const current = Math.max(1, data.current ?? 1)
  const [at, setAt] = useState(current)
  const names = new Map((data.characters ?? []).map(row => [row.cardId, row.name]))
  if (relations.length === 0) return <p className={css.empty}>{t('codex.noRelations')}</p>
  const live = relations.filter(row => (row.since ?? 0) <= at)
  const ids = [...new Set(relations.flatMap(row => row.pair))]
  const W = 560, H = 320, R = 120
  const place = new Map(ids.map((id, index) => {
    const angle = (index / Math.max(1, ids.length)) * Math.PI * 2 + Math.PI
    return [id, { x: W / 2 + R * Math.cos(angle) * 1.5, y: H / 2 + R * Math.sin(angle) }]
  }))
  const shown = new Set(live.flatMap(row => row.pair))
  return (
    <div className={css.relBox}>
      <div className={css.stack}>
        <label className={css.slider}>
          <span>{t('codex.upTo')}</span>
          <input type="range" min={1} max={current} value={at} onChange={event => { setAt(Number(event.target.value)) }} />
          <b>{t('card.inChapter', { n: at })}</b>
        </label>
        <svg className={css.graph} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('codex.relations')}>
          {live.map(row => {
            const [a, b] = row.pair
            const p = place.get(a ?? ''), q = place.get(b ?? '')
            if (p === undefined || q === undefined) return null
            return (
              <g key={row.cardId}>
                <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={css.edge} data-type={row.type} />
                <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 10} textAnchor="middle" className={css.edgeLabel}>{`${row.type} · ${row.stage}`}</text>
              </g>
            )
          })}
          {ids.map(id => {
            const p = place.get(id)!
            return (
              <g key={id} className={css.node} data-ghost={!shown.has(id) || undefined} onClick={() => { openCard(id, names.get(id) ?? id) }}>
                <circle cx={p.x} cy={p.y} r={28} />
                <text x={p.x} y={p.y + 5} textAnchor="middle">{(names.get(id) ?? id).slice(0, 4)}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className={css.relList}>
        {relations.map(row => (
          <div key={row.cardId} className={css.relItem} data-later={(row.since ?? 0) > at || undefined}>
            <b>{row.pair.map(id => names.get(id) ?? id).join(' × ')}</b>
            <span className={css.muted}>{row.type} · {row.stage}{row.since === undefined ? '' : ` · ${t('codex.since', { n: row.since })}`}</span>
            {row.now !== undefined && <span>{row.now}</span>}
            {row.steps.filter(step => step.chapter <= at).slice(-2).map((step, index) => (
              <span key={index} className={css.quote}>{t('card.inChapter', { n: step.chapter })} {step.label}{step.evidence === undefined ? '' : `「${step.evidence}」`}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 伏笔 */

function Foreshadows({ data, picked, onPick, openCard, openChapter, send, t }: {
  readonly data: NovelCodexResult
  readonly picked: string | null
  readonly onPick: (cardId: string) => void
  readonly openCard: (cardId: string, heading: string) => void
  readonly openChapter: (n: number) => void
  readonly send: ((text: string) => void) | undefined
  readonly t: T
}): ReactNode {
  const list = data.foreshadows ?? []
  if (list.length === 0) return <p className={css.empty}>{t('codex.noForeshadows')}</p>
  const current = list.find(row => row.cardId === picked) ?? list[0]!
  const now = data.current ?? 0
  const groups: [string, CodexForeshadow[]][] = [
    [t('codex.fsBig'), list.filter(row => row.revealKind === 'volume' || row.revealKind === 'final')],
    [t('codex.fsChapter'), list.filter(row => row.revealKind === 'chapter')],
    [t('codex.fsOpen'), list.filter(row => row.revealKind === undefined)],
  ]
  const recent = current.steps.filter(step => step.chapter > now - 4 && step.kind !== 'planted').length
  const planted = current.steps.find(step => step.kind === 'planted')?.chapter ?? current.steps[0]?.chapter
  const advanced = current.steps.filter(step => step.kind === 'advanced' || step.kind === 'hinted').length
  const advice = [
    ...(recent >= 3 ? [t('codex.pace', { count: recent })] : []),
    ...(current.reveal === undefined || current.answer === undefined ? [t('onepage.fsOpen')] : []),
  ]
  const track = (row: CodexForeshadow): ReactNode => {
    const chapters = new Set(row.steps.map(step => step.chapter))
    const span = Math.max(now, ...chapters, 1)
    const touched = [...chapters].sort((a, b) => a - b)
    return (
      <span className={css.track}>
        {Array.from({ length: Math.min(span, 12) }, (_, i) => span - Math.min(span, 12) + i + 1).map(n => <i key={n} data-on={chapters.has(n) || undefined} />)}
        <span>{row.state}{touched.length > 0 ? ` · ${t('onepage.chapterSpan', { from: touched[0]!, to: touched.at(-1)! })}` : ''}</span>
      </span>
    )
  }
  return (
    <div className={css.split}>
      <nav className={css.side} aria-label={t('codex.foreshadow')}>
        {groups.map(([label, rows]) => rows.length === 0 ? null : (
          <div key={label} className={css.sideGroup}>
            <h4>{label}</h4>
            {rows.map(row => (
              <button key={row.cardId} type="button" className={css.fsItem} aria-current={row.cardId === current.cardId || undefined} onClick={() => { onPick(row.cardId) }}>
                <span className={css.fsQ}>{row.starred ? '★ ' : ''}{row.question}</span>
                {track(row)}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <article className={css.detail}>
        <header className={css.dHead}>
          <div className={css.crumbs}>{t('codex.foreshadow')}</div>
          <button type="button" className={css.ghost} onClick={() => { openCard(current.cardId, current.question) }}>{t('codex.edit')}</button>
          <h2>{current.starred ? '★ ' : ''}{current.question}</h2>
          <div className={css.dMeta}>
            {planted !== undefined && <span>{t('onepage.planted', { n: planted })}</span>}
            {advanced > 0 && <span>· {t('onepage.advancedTimes', { count: advanced })}</span>}
            <span>· {current.reveal === undefined ? <>{t('onepage.revealLabel')}<b className={css.warnText}>{t('onepage.notSet')}</b></> : t('codex.reveal', { when: current.reveal })}</span>
          </div>
        </header>
        {advice.length > 0 && (
          <div className={css.advice}>
            <div>{advice.map((line, index) => <p key={index}>{line}</p>)}</div>
            {send !== undefined && (current.reveal === undefined || current.answer === undefined) && (
              <button type="button" className={css.button} onClick={() => { send(t('onepage.fsAsk', { q: current.question })) }}>{t('onepage.fsAskBtn')}</button>
            )}
          </div>
        )}
        <ol className={css.ladder}>
          {current.steps.map((step, index) => (
            <li key={index} data-kind={step.kind}>
              <button type="button" className={css.rungWhen} onClick={() => { openChapter(step.chapter) }}><i>{step.chapter}</i>{t(`codex.step.${step.kind}` as 'codex.step.planted')}</button>
              <div className={css.rungBody}>
                {step.note !== undefined && <p>{step.note}</p>}
                {step.evidence !== undefined && <blockquote>{step.evidence}</blockquote>}
              </div>
            </li>
          ))}
          <li data-kind="goal">
            <span className={css.rungWhen}><i>?</i>{t('onepage.truth')}</span>
            <div className={css.rungBody}><p>{current.answer ?? t('codex.noAnswer')}</p>{current.reveal !== undefined && <span className={css.mutedInline}>{t('codex.reveal', { when: current.reveal })}</span>}</div>
          </li>
        </ol>
      </article>
    </div>
  )
}
