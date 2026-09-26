/**
 * The mode chips on a card in the comparison view: which modes load THIS
 * capability, each chip a one-click jump into that mode.
 *
 * The chips are buttons OUTSIDE the card's main button — a nested button is
 * invalid HTML and would make one click do two things — so the card's open
 * action and the mode jump stay separate.
 *
 * DENSITY is the whole design problem here. An instance can supply seven or
 * more presets, and the most common capability is in most of them, so a literal
 * chip per mode turns the row into a two-line wall of pills that says very
 * little. Three shapes cover the cases, in this order:
 *
 * - **in every readable mode** → ONE summary pill (`全部模式 · 7`). This is the
 *   strongest and most frequent answer, and it is exactly the case where naming
 *   the modes adds nothing; the title still lists them.
 * - **a few** (up to `VISIBLE_CHIPS`) → the chips themselves.
 * - **many, but not all** → the first two chips plus `+N`, which expands the row
 *   IN PLACE. A hover tooltip would answer "which ones?" but not "take me
 *   there"; expanding keeps every chip's jump.
 * @module @khorsheed/dsh-capability-catalog/client/mode-chips
 */

import { useState } from 'react'
import type { CatalogModeChip } from './mode-model.ts'
import type { CapabilityCatalogKey } from './locales.ts'
import css from './CapabilityCatalogCard.module.css'

/** How many mode chips a card shows before collapsing the rest into `+N`. */
const VISIBLE_CHIPS = 2

/**
 * The chip row, or nothing when the comparison attributed no mode (a managed
 * skill no readable mode delivers, say).
 * @param modes - the modes that load this capability, in roster order.
 * @param total - how many modes the comparison actually read (`all` = this many).
 */
export function ModeChips({ modes, total, onSelect, t }: {
  modes: readonly CatalogModeChip[]
  /** Modes read by the comparison; the row says `全部模式 · N` when this many. */
  total: number
  onSelect: (id: string) => void
  t: (key: CapabilityCatalogKey) => string
}) {
  const [expanded, setExpanded] = useState(false)
  if (modes.length === 0) return null
  const names = modes.map(mode => mode.label).join('、')
  const inEveryMode = modes.length > VISIBLE_CHIPS && modes.length >= total
  const hidden = modes.length - VISIBLE_CHIPS
  return (
    <div className={css.pvModes}>
      <span className={css.pvModesLabel}>{t('modeIn')}</span>
      {inEveryMode ? (
        <span className={css.modeChipAll} title={names}>
          {t('modeEvery').replace('{n}', String(modes.length))}
        </span>
      ) : (
        (expanded ? modes : modes.slice(0, VISIBLE_CHIPS)).map(mode => (
          <button
            key={mode.id}
            type="button"
            className={css.modeChip}
            title={mode.isDefault ? t('modeChipDefaultHint') : t('modeChipHint')}
            onClick={() => onSelect(mode.id)}
          >
            {mode.label}
          </button>
        ))
      )}
      {inEveryMode || hidden <= 0 ? null : (
        <button
          type="button"
          className={css.modeChipMore}
          title={names}
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? t('modeCollapse') : t('modeMore').replace('{n}', String(hidden))}
        </button>
      )}
    </div>
  )
}
