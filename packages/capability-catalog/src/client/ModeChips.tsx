/**
 * The mode chips on a card in the comparison view: which modes load THIS
 * capability, each chip a one-click jump into that mode.
 *
 * The chips are buttons OUTSIDE the card's main button — a nested button is
 * invalid HTML and would make one click do two things — so the card's open
 * action and the mode jump stay separate.
 * @module @khorsheed/dsh-capability-catalog/client/mode-chips
 */

import type { CatalogModeChip } from './mode-model.ts'
import type { CapabilityCatalogKey } from './locales.ts'
import css from './CapabilityCatalogCard.module.css'

/** The chip row, or nothing when the comparison attributed no mode (a managed
 * skill no mode delivers, say). */
export function ModeChips({ modes, onSelect, t }: {
  modes: readonly CatalogModeChip[]
  onSelect: (id: string) => void
  t: (key: CapabilityCatalogKey) => string
}) {
  if (modes.length === 0) return null
  return (
    <div className={css.pvModes}>
      <span className={css.pvModesLabel}>{t('modeIn')}</span>
      {modes.map(mode => (
        <button
          key={mode.id}
          type="button"
          className={css.modeChip}
          data-default={mode.isDefault ? 'true' : undefined}
          title={t('modeChipHint')}
          onClick={() => onSelect(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}
