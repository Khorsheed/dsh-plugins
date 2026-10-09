/**
 * 元素: every element of the game as a card grid (look, name, key numbers),
 * filtered by type, multi-selectable to hand to the model as references.
 * One card opens the element: its look large and editable (pen / recolor,
 * colors from the style's palette, states), its fields, a box to ask the
 * model for a new look, and the model's A/B/C proposals — picking one is
 * the confirmation (it replaces the look in the game at once).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChipRow } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { LOOK_CHARS, type ElementLook, type ElementView, type LookProposal, type ProjectView } from '../types.ts'
import { failureOf, type ViewProps } from './contract.ts'
import { blankLook, ensureColor, LookCanvas, recolor, setCell } from './looks.tsx'
import css from './GameTab.module.css'

/** Props of the elements view. */
export interface ElementsViewProps extends ViewProps {
  readonly project: ProjectView
  readonly openId: string | null
  readonly onOpen: (id: string | null) => void
  readonly onLiveElement: (element: Record<string, unknown>) => void
}

/** A stable per-type hue index for cards without a look. */
function typeTone(types: readonly string[], type: string): number {
  return Math.max(0, types.indexOf(type)) % 6
}

/** The elements view. */
export function ElementsView(props: ElementsViewProps): ReactNode {
  const { t, project, openId, onOpen, insertDraft, toast } = props
  const types = useMemo(() => [...new Set([...(project.manifest?.elementTypes ?? []), ...project.elements.map(e => e.type)])], [project])
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<readonly string[]>([])
  const open = project.elements.find(e => e.id === openId)
  if (open !== undefined) return <ElementDetail {...props} element={open} onBack={() => { onOpen(null) }} types={types} />

  const shown = project.elements.filter(e => filter === 'all' || e.type === filter)
  const openProposals = new Set(project.proposals.filter(p => p.picked === undefined).map(p => p.elementId))
  const toggle = (id: string): void => { setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id])) }

  return <div className={css.scroll}>
    {project.elementErrors.length > 0 && <div className={css.notice} data-tone="error">
      <strong>{t('elements.errors', { count: project.elementErrors.length })}</strong>
      <ul className={css.plainList}>{project.elementErrors.slice(0, 6).map((f, i) => <li key={i}><code>{f.where}</code> {f.message}</li>)}</ul>
    </div>}
    {project.elements.length === 0
      ? <div className={css.emptyCard}><div className={css.emptyGlyph} aria-hidden="true">◆</div><p>{t('elements.empty')}</p></div>
      : <>
          <ChipRow
            label={t('elements.filter')}
            value={filter}
            onSelect={setFilter}
            chips={[{ id: 'all', label: t('elements.all'), count: project.elements.length },
              ...types.map(type => ({ id: type, label: type, count: project.elements.filter(e => e.type === type).length }))]}
          />
          <div className={css.cardGrid}>
            {shown.map(e => {
              const stats = Object.entries(e.stats).filter(([, v]) => typeof v === 'number').slice(0, 2)
              const isSel = selected.includes(e.id)
              return <div key={e.id} className={css.elCard} data-selected={isSel ? 'true' : 'false'}>
                <button type="button" className={css.elOpen} onClick={() => { onOpen(e.id) }} aria-label={t('elements.open', { name: e.name })}>
                  <span className={css.elArt} data-tone={typeTone(types, e.type)}>
                    {e.look !== null ? <LookCanvas look={e.look} box={56} /> : <span className={css.elInitial}>{e.name.slice(0, 1)}</span>}
                  </span>
                  <span className={css.elName}>{e.name}</span>
                  <span className={css.elMeta}>{e.type}{stats.length > 0 ? ` · ${stats.map(([k, v]) => `${k} ${String(v)}`).join(' · ')}` : ''}</span>
                  {openProposals.has(e.id) && <span className={css.badge}>{t('elements.proposalsWaiting')}</span>}
                </button>
                <label className={css.elCheck} title={t('elements.select')}>
                  <input type="checkbox" checked={isSel} onChange={() => { toggle(e.id) }} aria-label={t('elements.selectOne', { name: e.name })} />
                </label>
              </div>
            })}
          </div>
        </>}
    {selected.length > 0 && <div className={css.selectBar}>
      <span>{t('elements.selected', { count: selected.length })}</span>
      <span className={css.spacer} />
      <button type="button" className={css.ghost} onClick={() => { setSelected([]) }}>{t('elements.clear')}</button>
      <button type="button" className={css.primary} onClick={() => {
        const refs = selected.map(id => project.elements.find(e => e.id === id)).filter((e): e is ElementView => e !== undefined)
        if (insertDraft(t('draft.elementsRef', { list: refs.map(e => `「${e.name}」(${e.id})`).join('、') }))) {
          toast(t('toast.drafted'))
          setSelected([])
        }
      }}>{t('elements.toModel')}</button>
    </div>}
  </div>
}

type Tool = 'pen' | 'recolor'

/** One element, open. */
function ElementDetail({ t, sessionId, api, project, element, onBack, insertDraft, toast, refresh, onLiveElement, types }: ElementsViewProps & {
  element: ElementView
  onBack: () => void
  types: readonly string[]
}): ReactNode {
  const stylePalette = project.manifest?.palette ?? []
  const [look, setLook] = useState<ElementLook | null>(element.look)
  const [state, setState] = useState(Object.keys(element.look?.states ?? { idle: [] })[0] ?? 'idle')
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string | null>(stylePalette[1] ?? element.look?.palette[1] ?? null)
  const [recolorFrom, setRecolorFrom] = useState<number | null>(null)
  const [ask, setAsk] = useState('')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { setLook(element.look) }, [element.id, element.look])

  const save = (next: ElementLook): void => {
    setLook(next)
    setSaving('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api.editElement(sessionId, project.id, element.id, { look: JSON.stringify(next) }).then(result => {
        if (failureOf(result) !== undefined) { setSaving('failed'); return }
        setSaving('saved')
        if (result.ok && result.value.ok) onLiveElement(JSON.parse(result.value.elementJson) as Record<string, unknown>)
        refresh()
      })
    }, 450)
  }

  const paint = (x: number, y: number): void => {
    if (look === null || tool !== 'pen') return
    if (color === null) { save(setCell(look, state, x, y, '.')); return }
    const ensured = ensureColor(look, color)
    save(setCell(ensured.look, state, x, y, ensured.char))
  }

  const saveField = (key: string, raw: string, kind: 'number' | 'string' | 'boolean'): void => {
    const value = kind === 'number' ? Number(raw) : kind === 'boolean' ? raw === 'true' : raw
    if (kind === 'number' && !Number.isFinite(value as number)) return
    if (element.stats[key] === value) return
    void api.editElement(sessionId, project.id, element.id, { fields: JSON.stringify({ [key]: value }) }).then(result => {
      if (result.ok && result.value.ok) onLiveElement(JSON.parse(result.value.elementJson) as Record<string, unknown>)
      toast(t('toast.fieldSaved', { key }))
      refresh()
    })
  }

  const proposals = project.proposals.filter(p => p.elementId === element.id)
  const openProposal: LookProposal | undefined = proposals.find(p => p.picked === undefined)
  const history = proposals.filter(p => p.picked !== undefined)
  const states = look === null ? [] : Object.keys(look.states)
  const fields = Object.entries(element.stats)

  return <div className={css.scroll}>
    <div className={css.crumbs}>
      <button type="button" className={css.link} onClick={onBack}>‹ {t('elements.back')}</button>
      <span className={css.metaLine}>{element.type} · {element.id} · {element.file}</span>
    </div>
    <h3 className={css.detailTitle}>{element.name}</h3>

    <section className={css.lookPanel}>
      <div className={css.lookMain}>
        {look !== null
          ? <LookCanvas look={look} state={state} box={208} grid onPaint={paint} className={css.lookEditor} />
          : <div className={css.lookEmpty} data-tone={typeTone(types, element.type)}>
              <p>{t('look.none')}</p>
              <button type="button" className={css.ghost} onClick={() => { save(blankLook(stylePalette.length > 0 ? stylePalette : ['#000000', '#ffffff'])) }}>{t('look.start')}</button>
            </div>}
        {look !== null && <div className={css.lookSide}>
          <div className={css.lookPreview}><LookCanvas look={look} state={state} box={64} /></div>
          <span className={css.metaLine}>{t('look.inGame')}</span>
          <span className={css.saveState} data-state={saving}>{saving === 'idle' ? '' : t(`look.${saving}`)}</span>
        </div>}
      </div>
      {states.length > 0 && <ChipRow label={t('look.states')} value={state} onSelect={setState} chips={states.map(s => ({ id: s, label: s }))} />}
      {look !== null && <>
        <div className={css.toolRow} role="group" aria-label={t('look.tools')}>
          <button type="button" className={css.seg} aria-pressed={tool === 'pen'} onClick={() => { setTool('pen'); setRecolorFrom(null) }}>{t('look.pen')}</button>
          <button type="button" className={css.seg} aria-pressed={tool === 'recolor'} onClick={() => { setTool('recolor') }}>{t('look.recolor')}</button>
          <span className={css.spacer} />
          <span className={css.metaLine}>{tool === 'pen' ? t('look.penHint') : recolorFrom === null ? t('look.recolorPick') : t('look.recolorTo')}</span>
        </div>
        {tool === 'recolor' && <div className={css.swatches} aria-label={t('look.ownColors')}>
          {look.palette.map((c, i) => <button key={i} type="button" className={css.swatchBtn} aria-pressed={recolorFrom === i}
            style={{ background: c }} title={`${LOOK_CHARS[i]} ${c}`} onClick={() => { setRecolorFrom(i) }} />)}
        </div>}
        <div className={css.swatches} aria-label={t('look.styleColors')}>
          {tool === 'pen' && <button type="button" className={css.swatchBtn} data-erase="true" aria-pressed={color === null}
            title={t('look.erase')} onClick={() => { setColor(null) }} />}
          {stylePalette.map(c => <button key={c} type="button" className={css.swatchBtn} style={{ background: c }} title={c}
            aria-pressed={tool === 'pen' && color === c}
            onClick={() => {
              if (tool === 'pen') setColor(c)
              else if (recolorFrom !== null) { save(recolor(look, recolorFrom, c)); setRecolorFrom(null) }
            }} />)}
        </div>
        <p className={css.metaLine}>{t('look.paletteNote')}</p>
      </>}
    </section>

    <section className={css.block}>
      <h4 className={css.blockTitle}>{t('look.askTitle')}</h4>
      <textarea className={css.textarea} rows={2} value={ask} placeholder={t('look.askPlaceholder')} onChange={e => { setAsk(e.target.value) }} />
      <div className={css.rowEnd}>
        <button type="button" className={css.primary} disabled={ask.trim() === ''} onClick={() => {
          if (insertDraft(t('draft.restyleElement', { name: element.name, id: element.id, ask: ask.trim() }))) { toast(t('toast.drafted')); setAsk('') }
        }}>{t('look.askSend')}</button>
      </div>
      {openProposal !== undefined && <div className={css.proposals}>
        <p className={css.metaLine}>{t('look.proposalsFor', { request: openProposal.request || '—' })}</p>
        <div className={css.proposalGrid}>
          {openProposal.variants.map((v, i) => <div key={i} className={css.proposalCard}>
            <div className={css.proposalArt}><LookCanvas look={v.look} box={84} /></div>
            <strong>{v.label}</strong>
            <span className={css.metaLine}>{v.note}</span>
            <button type="button" className={css.primary} onClick={() => {
              void api.pickProposal(sessionId, project.id, element.id, openProposal.at, i).then(r => {
                if (failureOf(r) === undefined) toast(t('toast.picked', { label: v.label }))
                refresh()
              })
            }}>{t('look.pickThis')}</button>
          </div>)}
        </div>
      </div>}
      {history.length > 0 && <details className={css.history}>
        <summary>{t('look.history', { count: history.length })}</summary>
        {history.map(p => <div key={p.at} className={css.historyRow}>
          {p.variants.map((v, i) => <span key={i} className={css.historyItem} data-picked={i === p.picked ? 'true' : 'false'}>
            <LookCanvas look={v.look} box={32} />
            <button type="button" className={css.link} onClick={() => { save(v.look) }}>{t('look.useAgain', { label: v.label })}</button>
          </span>)}
        </div>)}
      </details>}
    </section>

    <section className={css.block}>
      <h4 className={css.blockTitle}>{t('fields.title')}</h4>
      {fields.length === 0 && <p className={css.metaLine}>{t('fields.none')}</p>}
      <div className={css.fieldGrid}>
        {fields.map(([key, value]) => <label key={`${element.id}:${key}`} className={css.field}>
          <span className={css.fieldKey}>{key}</span>
          {typeof value === 'boolean'
            ? <input type="checkbox" defaultChecked={value} onChange={e => { saveField(key, String(e.target.checked), 'boolean') }} />
            : <input className={css.input} defaultValue={String(value)} inputMode={typeof value === 'number' ? 'decimal' : 'text'}
                onBlur={e => { saveField(key, e.target.value, typeof value === 'number' ? 'number' : 'string') }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />}
        </label>)}
      </div>
      <p className={css.metaLine}>{t('fields.note')}</p>
    </section>
  </div>
}
