/**
 * The 3D look editor: a `parts3d` recipe as sliders and color wells,
 * generated from the recipe itself — proportions, every part's numbers
 * (built-in keys and a project part's own `extra` numbers alike), palette,
 * motions and scale. Nothing here knows a theme: a project's own bodies and
 * parts get the same controls as the built-ins.
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { MotionSpec, PartSpec, Parts3DLook } from '../types.ts'
import { zh } from './locales.ts'
import css from './GameTab.module.css'

/** Integer counts and their ranges (the validator's, mirrored). */
const COUNT_RANGE: Readonly<Record<string, readonly [number, number]>> = { legs: [0, 8], heads: [1, 9], segments: [3, 40], count: [1, 12] }
/** Part numbers and their ranges (the validator's, mirrored). */
const PART_RANGE: Readonly<Record<string, readonly [number, number, number]>> = {
  size: [0.05, 3, 0.01], length: [0.05, 3, 0.01], fan: [0, 360, 5], thickness: [0.01, 0.5, 0.005],
}

/** A label for a recipe key: the dictionary's when it has one, else the key itself. */
function labelOf(t: TranslateNS<'game'>, key: string): string {
  const k = `recipe.key.${key}`
  return Object.hasOwn(zh, k) ? t(k as keyof typeof zh) : key
}

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}): ReactNode {
  return <label className={css.param}>
    <span className={css.paramLabel}>{label}</span>
    <input type="range" className={css.range} min={min} max={max} step={step} value={value} onChange={e => { onChange(Number(e.target.value)) }} />
    <span className={css.paramValue}>{step >= 1 ? String(Math.round(value)) : value.toFixed(step < 0.01 ? 3 : 2)}</span>
  </label>
}

/** Props of {@link Recipe3DEditor}. */
export interface Recipe3DEditorProps {
  readonly t: TranslateNS<'game'>
  readonly look: Parts3DLook
  readonly onChange: (next: Parts3DLook) => void
}

/** The recipe editor. */
export function Recipe3DEditor({ t, look, onChange }: Recipe3DEditorProps): ReactNode {
  const setProportion = (key: string, v: number): void => { onChange({ ...look, proportions: { ...look.proportions, [key]: v } }) }
  const setPart = (index: number, patch: Partial<PartSpec>): void => {
    onChange({ ...look, parts: look.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)) })
  }
  const setMotion = (name: string, patch: MotionSpec): void => {
    onChange({ ...look, motion: { ...look.motion, [name]: { ...look.motion[name], ...patch } } })
  }
  const proportions = Object.entries(look.proportions)
  const motions = Object.entries(look.motion)

  return <div className={css.recipe}>
    <p className={css.metaLine}>{t('recipe.base', { base: labelOf(t, look.base) })}</p>

    {proportions.length > 0 && <section className={css.recipeGroup}>
      <h4 className={css.blockTitle}>{t('recipe.proportions')}</h4>
      {proportions.map(([key, value]) => {
        const count = COUNT_RANGE[key]
        return <Slider key={key} label={labelOf(t, key)} value={value}
          min={count?.[0] ?? 0.05} max={count?.[1] ?? 3} step={count === undefined ? 0.01 : 1}
          onChange={v => { setProportion(key, v) }} />
      })}
    </section>}

    {look.parts.length > 0 && <section className={css.recipeGroup}>
      <h4 className={css.blockTitle}>{t('recipe.parts')}</h4>
      {look.parts.map((part, index) => <div key={index} className={css.recipePart}>
        <strong className={css.recipePartName}>{labelOf(t, part.type)}</strong>
        {part.count !== undefined && <Slider label={labelOf(t, 'count')} value={part.count} min={1} max={12} step={1} onChange={v => { setPart(index, { count: v }) }} />}
        {(['size', 'length', 'fan', 'thickness'] as const).filter(k => part[k] !== undefined).map(k => {
          const [min, max, step] = PART_RANGE[k]!
          return <Slider key={k} label={labelOf(t, k)} value={part[k]!} min={min} max={max} step={step} onChange={v => { setPart(index, { [k]: v }) }} />
        })}
        {Object.entries(part.extra ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number').map(([k, v]) => {
          const span = Math.max(1, Math.abs(v) * 2)
          return <Slider key={k} label={labelOf(t, k)} value={v} min={v < 0 ? -span : 0} max={span} step={span > 20 ? 1 : 0.01}
            onChange={next => { setPart(index, { extra: { ...part.extra, [k]: next } }) }} />
        })}
      </div>)}
    </section>}

    {Object.keys(look.palette).length > 0 && <section className={css.recipeGroup}>
      <h4 className={css.blockTitle}>{t('recipe.palette')}</h4>
      <div className={css.recipeColors}>
        {Object.entries(look.palette).map(([key, color]) => <label key={key} className={css.recipeColor}>
          <input type="color" value={color} onChange={e => { onChange({ ...look, palette: { ...look.palette, [key]: e.target.value } }) }} />
          <span>{labelOf(t, key)}</span>
        </label>)}
      </div>
    </section>}

    {motions.length > 0 && <section className={css.recipeGroup}>
      <h4 className={css.blockTitle}>{t('recipe.motion')}</h4>
      {motions.map(([name, m]) => <div key={name} className={css.recipePart}>
        <strong className={css.recipePartName}>{labelOf(t, name)}</strong>
        <Slider label={labelOf(t, 'amplitude')} value={m.amplitude ?? 0} min={0} max={name === 'breath' || name === 'bob' ? 0.5 : 90} step={name === 'breath' || name === 'bob' ? 0.005 : 1}
          onChange={v => { setMotion(name, { amplitude: v }) }} />
        <Slider label={labelOf(t, 'period')} value={m.period ?? 1.5} min={0.1} max={10} step={0.1} onChange={v => { setMotion(name, { period: v }) }} />
      </div>)}
    </section>}

    <section className={css.recipeGroup}>
      <Slider label={labelOf(t, 'scale')} value={look.scale ?? 1} min={0.2} max={5} step={0.05} onChange={v => { onChange({ ...look, scale: v }) }} />
    </section>
  </div>
}
