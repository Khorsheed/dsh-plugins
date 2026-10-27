/**
 * 元素: every element of the game as a card grid (look, name, key numbers),
 * filtered by type, multi-selectable to hand to the model as references.
 * One card opens the element: its look large (a 3D turntable, or the pixel
 * editor), right under it a box to ask the model for a new look and the
 * model's A/B/C proposals, its 设定 (lore), the 3D recipe's fine-tuning
 * folded away, and its fields. Every edit lands in the working files; the
 * tab's commit bar turns them into a version for the play area.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChipRow, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { isPixelLook, LOOK_CHARS, LORE_MAX, type AnyLook, type ElementLook, type ElementView, type Look3D, type LookProposal, type ProjectView } from '../types.ts'
import { failureOf, type ViewProps } from './contract.ts'
import { blankLook, ensureColor, LookCanvas, recolor, setCell } from './looks.tsx'
import { Preview3D } from './Preview3D.tsx'
import { Recipe3DEditor } from './Recipe3DEditor.tsx'
import type { ModelParts } from '../vfs.ts'
import css from './GameTab.module.css'

/** Props of the elements view. */
export interface ElementsViewProps extends ViewProps {
  readonly project: ProjectView
  readonly openId: string | null
  readonly onOpen: (id: string | null) => void
  /** The version a jump here came with (the page offers 去试玩). */
  readonly playVersion?: number | null
  readonly onPlay?: () => void
}

/** A 3D look's main color, for its card's placeholder while the still renders (or without a live version). */
function bodyColor(look: Look3D): string | undefined {
  const recipe = look.kind === 'parts3d' ? look : look.recipe
  return recipe?.palette.body ?? Object.values(recipe?.palette ?? {})[0]
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
  const unseen = props.autoNav.unseen(project.id)
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
                    {e.look !== null ? <LookCanvas look={e.look} box={56} />
                      : e.look3d !== null ? <Preview3D api={props.api} projectId={project.id} version={project.current?.version} look={e.look3d} mode="still"
                          className={css.elArt3d} emptyLabel="" placeholder={<span className={css.elInitial} style={{ background: bodyColor(e.look3d) }} data-model="3d">{e.name.slice(0, 1)}</span>} />
                      : <span className={css.elInitial}>{e.name.slice(0, 1)}</span>}
                  </span>
                  <span className={css.elName}>{e.name}</span>
                  <span className={css.elMeta}>{e.type}{stats.length > 0 ? ` · ${stats.map(([k, v]) => `${k} ${String(v)}`).join(' · ')}` : ''}</span>
                  {openProposals.has(e.id) && <span className={css.badge}>{t('elements.proposalsWaiting')}</span>}
                  {unseen.has(e.id) && <span className={css.elDot} title={t('nav.changed')} aria-label={t('nav.changed')} />}
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
function ElementDetail({ t, sessionId, api, project, element, onBack, insertDraft, toast, refresh, types, autoNav, playVersion, onPlay }: ElementsViewProps & {
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
  const [look3d, setLook3d] = useState<Look3D | null>(element.look3d)
  // Opening the page (by hand or by a jump) is seeing the change: the card's dot goes.
  useEffect(() => { autoNav.markSeen(project.id, element.id) }, [autoNav, project.id, element.id])
  const [clips, setClips] = useState<readonly string[]>([])
  const [parts, setParts] = useState<ModelParts | null>(null)
  const [clip, setClip] = useState<{ name: string; n: number } | null>(null)
  const [view, setView] = useState<{ yaw: number; n: number } | null>(null)
  const viewN = useRef(0)
  const turnTo = (yaw: number): void => { viewN.current++; setView({ yaw, n: viewN.current }) }
  useEffect(() => { setClips([]); setClip(null); setParts(null) }, [element.id])
  useEffect(() => { setLook3d(element.look3d) }, [element.id, element.look3d])

  const save = (next: AnyLook): void => {
    if (isPixelLook(next)) setLook(next)
    else setLook3d(next)
    setSaving('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api.editElement(sessionId, project.id, element.id, { look: JSON.stringify(next) }).then(result => {
        if (failureOf(result) !== undefined) { setSaving('failed'); return }
        setSaving('saved')
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
    void api.editElement(sessionId, project.id, element.id, { fields: JSON.stringify({ [key]: value }) }).then(refresh)
  }

  const proposals = project.proposals.filter(p => p.elementId === element.id)
  const openProposal: LookProposal | undefined = proposals.find(p => p.picked === undefined)
  const history = proposals.filter(p => p.picked !== undefined)
  const states = look === null ? [] : Object.keys(look.states)
  const fields = Object.entries(element.stats)

  return <div className={css.scroll}>
    <PanelHeader className={css.detailHead} title={element.name} meta={<span title={`${element.id} · ${element.file}`}>{element.type}</span>}
      onBack={onBack} backLabel={t('elements.back')} moreLabel={t('more')}
      extra={playVersion != null && onPlay !== undefined ? <button type="button" className={css.primary} onClick={onPlay}>{t('nav.playVersion', { version: playVersion })}</button> : undefined} />

    {look3d !== null ? <section className={css.lookPanel}>
      <Preview3D api={api} projectId={project.id} version={project.current?.version} look={look3d} mode="spin"
        className={css.turntable} emptyLabel={t('look.preview3dEmpty')} onClips={(names, found) => { setClips(names); setParts(found) }} onTurned={() => { setView(null) }} clip={clip} view={view} />
      {clips.length > 0 && <ChipRow label={t('gltf.clips')} value={clip?.name ?? autoClip(look3d, clips)} onSelect={name => { setClip(c => ({ name, n: (c?.n ?? 0) + 1 })) }}
        chips={clips.map(name => ({ id: name, label: name }))} />}
      <div className={`${css.toolRow} ${css.tight}`}>
        <span className={css.metaLine}>{t('look.drag3d')}</span>
        <span className={css.spacer} />
        <span role="group" aria-label={t('look.views')} className={css.segGroup}>
          {([[0, 'look.front'], [90, 'look.side'], [180, 'look.back']] as const).map(([yaw, key]) =>
            <button key={yaw} type="button" className={css.seg} aria-pressed={view?.yaw === yaw} onClick={() => { turnTo(yaw) }}>{t(key)}</button>)}
        </span>
        <span className={css.saveState} data-state={saving}>{saving === 'idle' ? '' : t(`look.${saving}`)}</span>
      </div>
      {look3d.kind === 'gltf' && <GltfControls t={t} look={look3d} onChange={save} />}
    </section> : <section className={css.lookPanel}>
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
        <div className={`${css.toolRow} ${css.tight}`}>
          <span className={css.segGroup} role="group" aria-label={t('look.tools')}>
            <button type="button" className={css.seg} aria-pressed={tool === 'pen'} onClick={() => { setTool('pen'); setRecolorFrom(null) }}>{t('look.pen')}</button>
            <button type="button" className={css.seg} aria-pressed={tool === 'recolor'} onClick={() => { setTool('recolor') }}>{t('look.recolor')}</button>
          </span>
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
    </section>}

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
            <div className={css.proposalArt}>{isPixelLook(v.look) ? <LookCanvas look={v.look} box={84} />
              : <Preview3D api={api} projectId={project.id} version={project.current?.version} look={v.look} mode="still" className={css.proposal3d} emptyLabel={t('look.model3d')} />}</div>
            <strong>{v.label}</strong>
            <span className={css.metaLine}>{v.note}</span>
            <button type="button" className={css.primary} onClick={() => {
              void api.pickProposal(sessionId, project.id, element.id, openProposal.at, i).then(r => {
                if (failureOf(r) === undefined) toast(t('nudge.picked', { name: element.name, label: v.label }))
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
            {isPixelLook(v.look) ? <LookCanvas look={v.look} box={32} /> : <span className={css.metaLine}>{t('look.model3d')}</span>}
            <button type="button" className={css.link} onClick={() => { save(v.look) }}>{t('look.useAgain', { label: v.label })}</button>
          </span>)}
        </div>)}
      </details>}
    </section>

    <LoreCard t={t} element={element} onSave={lore => {
      void api.editElement(sessionId, project.id, element.id, { fields: JSON.stringify({ lore: lore === '' ? null : lore }) }).then(refresh)
    }} />

    {look3d?.kind === 'parts3d' && <details className={css.fold}>
      <summary>{t('look.fineTune')}</summary>
      <Recipe3DEditor t={t} look={look3d} onChange={save} />
    </details>}
    {look3d?.kind === 'gltf' && parts !== null && (parts.materials.length + parts.bones.length + parts.morphs.length) > 0 && <details className={css.fold}>
      <summary>{t('look.fineTune')}</summary>
      <GltfTweaks t={t} look={look3d} parts={parts} onChange={save} />
    </details>}

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

/** 设定: who the element is — free text the agent follows for its behavior and wording. Saved on blur. */
function LoreCard({ t, element, onSave }: { t: ElementsViewProps['t']; element: ElementView; onSave: (lore: string) => void }): ReactNode {
  const [text, setText] = useState(element.lore)
  useEffect(() => { setText(element.lore) }, [element.id, element.lore])
  return <section className={css.block}>
    <h4 className={css.blockTitle}>{t('lore.title')}</h4>
    <textarea className={css.textarea} rows={element.lore === '' ? 3 : 5} maxLength={LORE_MAX} value={text}
      placeholder={t('lore.placeholder')} aria-label={t('lore.title')}
      onChange={e => { setText(e.target.value) }}
      onBlur={() => { if (text.trim() !== element.lore) onSave(text.trim()) }} />
    <p className={css.metaLine}>{t('lore.note')}</p>
  </section>
}

/** A model-file look: which file, toon or its own materials, and its size in the game. */
function GltfControls({ t, look, onChange }: { t: ElementsViewProps['t']; look: Extract<Look3D, { kind: 'gltf' }>; onChange: (next: Look3D) => void }): ReactNode {
  const material = look.material ?? 'toon'
  const [scale, setScale] = useState(String(look.scale ?? 1))
  useEffect(() => { setScale(String(look.scale ?? 1)) }, [look.scale])
  return <div className={css.gltfRow}>
    <span className={css.metaLine}>{t('gltf.file', { src: look.src })}</span>
    <span className={css.spacer} />
    <span role="group" aria-label={t('gltf.material')} className={css.segGroup}>
      <button type="button" className={css.seg} aria-pressed={material === 'toon'} onClick={() => { onChange({ ...look, material: 'toon' }) }}>{t('gltf.toon')}</button>
      <button type="button" className={css.seg} aria-pressed={material === 'original'} onClick={() => { onChange({ ...look, material: 'original' }) }}>{t('gltf.original')}</button>
    </span>
    <label className={css.gltfScale}>
      <span className={css.metaLine}>{t('gltf.scale')}</span>
      <input className={css.input} inputMode="decimal" value={scale} onChange={e => { setScale(e.target.value) }}
        onBlur={() => { const v = Number(scale); if (Number.isFinite(v) && v > 0 && v !== (look.scale ?? 1)) onChange({ ...look, scale: v }) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  </div>
}

/** Rig helpers a user never tunes (Rigify and friends): hidden from the bone list unless already tweaked. */
const RIG_HELPER = /^(DEF|MCH|ORG|CTRL|WGT|IK|FK|VIS|MSTR)[-_.]/i

type GltfLookOf = Extract<Look3D, { kind: 'gltf' }>

/**
 * A model look tuned by the names inside it: base color per material, a size
 * (and, folded, a rotation) per bone, a weight per shape key. Every change is
 * a look edit (live in the turntable, saved like any other).
 */
function GltfTweaks({ t, look, parts, onChange }: { t: ElementsViewProps['t']; look: GltfLookOf; parts: ModelParts; onChange: (next: Look3D) => void }): ReactNode {
  const [query, setQuery] = useState('')
  const tint = look.tint ?? {}, bones = look.bones ?? {}, morphs = look.morphs ?? {}
  const set = <K extends 'tint' | 'bones' | 'morphs'>(key: K, value: GltfLookOf[K]): void => { onChange({ ...look, [key]: value }) }
  const without = <V,>(map: Readonly<Record<string, V>>, name: string): Record<string, V> => { const next = { ...map }; delete next[name]; return next }
  const shown = parts.bones.filter(b => bones[b] !== undefined || (!RIG_HELPER.test(b) && (query === '' || b.toLowerCase().includes(query.toLowerCase()))))
  const boneScale = (name: string): number => { const s = bones[name]?.scale; return typeof s === 'number' ? s : 1 }
  const rot = (name: string): readonly [number, number, number] => bones[name]?.rotate ?? [0, 0, 0]
  const setBone = (name: string, patch: { scale?: number; rotate?: [number, number, number] }): void => {
    const next = { ...bones[name], ...patch }
    const plain = (next.scale === undefined || next.scale === 1) && (next.rotate === undefined || next.rotate.every(v => v === 0))
    set('bones', plain ? without(bones, name) : { ...bones, [name]: next })
  }
  return <div className={css.recipe}>
    {parts.materials.length > 0 && <div className={css.recipeGroup}>
      <span className={css.recipePartName}>{t('gltf.colors')}</span>
      <div className={css.recipeColors}>
        {parts.materials.map(m => <label key={m.name} className={css.recipeColor} title={m.vertexColors ? t('gltf.vertexColorsHint') : undefined}>
          <input type="color" value={tint[m.name] ?? m.color} onChange={e => { set('tint', { ...tint, [m.name]: e.target.value }) }} />
          <span>{m.name}{m.vertexColors ? ` · ${t('gltf.vertexColors')}` : ''}</span>
          {tint[m.name] !== undefined && <button type="button" className={css.link} onClick={() => { set('tint', without(tint, m.name)) }}>{t('gltf.reset')}</button>}
        </label>)}
      </div>
    </div>}
    {parts.morphs.length > 0 && <div className={css.recipeGroup}>
      <span className={css.recipePartName}>{t('gltf.morphs')}</span>
      {parts.morphs.map(name => <label key={name} className={css.param}>
        <span className={css.paramLabel}>{name}</span>
        <input type="range" className={css.range} min={0} max={1} step={0.05} value={morphs[name] ?? 0}
          onChange={e => { const v = Number(e.target.value); set('morphs', v === 0 ? without(morphs, name) : { ...morphs, [name]: v }) }} />
        <span className={css.paramValue}>{(morphs[name] ?? 0).toFixed(2)}</span>
      </label>)}
    </div>}
    {parts.bones.length > 0 && <div className={css.recipeGroup}>
      <span className={css.recipePartName}>{t('gltf.bones')}</span>
      <input className={css.input} value={query} placeholder={t('gltf.boneSearch')} aria-label={t('gltf.boneSearch')} onChange={e => { setQuery(e.target.value) }} />
      {shown.slice(0, 40).map(name => <div key={name} className={css.recipePart}>
        <label className={css.param}>
          <span className={css.paramLabel}>{name}</span>
          <input type="range" className={css.range} min={0.5} max={2} step={0.05} value={boneScale(name)} onChange={e => { setBone(name, { scale: Number(e.target.value) }) }} />
          <span className={css.paramValue}>×{boneScale(name).toFixed(2)}</span>
        </label>
        <details className={css.history}>
          <summary>{t('gltf.rotate')}</summary>
          {(['x', 'y', 'z'] as const).map((axis, i) => <label key={axis} className={css.param}>
            <span className={css.paramLabel}>{axis}</span>
            <input type="range" className={css.range} min={-45} max={45} step={1} value={rot(name)[i]} onChange={e => {
              const next = [...rot(name)] as [number, number, number]
              next[i] = Number(e.target.value)
              setBone(name, { rotate: next })
            }} />
            <span className={css.paramValue}>{rot(name)[i]}°</span>
          </label>)}
        </details>
      </div>)}
      {shown.length > 40 && <span className={css.metaLine}>{t('gltf.moreBones', { count: shown.length - 40 })}</span>}
    </div>}
  </div>
}

/** The clip a model plays on its own (dsh3d's rule): the look's choice, else an idle-like name, else the first. */
function autoClip(look: Look3D, clips: readonly string[]): string {
  const chosen = look.kind === 'gltf' ? look.animation : undefined
  return chosen !== undefined && clips.includes(chosen) ? chosen : clips.find(c => /idle|待机|stand/i.test(c)) ?? clips[0] ?? ''
}
