/**
 * The shortcut preferences card in the plugin configuration tab: the same
 * collapsible chrome the official plugin cards use (a header naming the
 * plugin and what its settings govern, disclosing the controls in place),
 * re-implemented here because the client bundle-purity gate forbids value-
 * importing the official card chrome. The rebinding fields are ShortcutsRow;
 * this component only owns the disclosure and the copy.
 *
 * The bundle-purity gate also forbids the staged save/discard model of the
 * official cards — which we do not need anyway: a shortcut preference writes
 * through settingsScope the moment a capture completes, so there is nothing
 * to stage.
 */

import { useState } from 'react'
import { IconChevronDownOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { ShortcutsRow, type ShortcutsRowProps } from './ShortcutsRow.tsx'
import css from './ShortcutsCard.module.css'

/** The card passes every row prop through to the fields it discloses. */
export type ShortcutsCardProps = ShortcutsRowProps

/**
 * Render the collapsible shortcut settings card.
 * @param props - the row's full injected face and copy.
 * @returns the card: a header button and, while open, the rebinding fields.
 */
export function ShortcutsCard(props: ShortcutsCardProps) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const title = t('settings.title')
  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        <IconChevronDownOutlineMedium className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open
        ? (
          <div className={css.body}>
            <ShortcutsRow {...props} />
          </div>
        )
        : null}
    </li>
  )
}
