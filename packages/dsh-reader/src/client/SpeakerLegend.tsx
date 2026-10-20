/**
 * The transcript's speakers, one chip each, above the tabs: the colour that
 * marks their paragraphs and their name — click to rename (Enter keeps it,
 * Esc drops it, an empty name goes back to 说话人 A). A rename applies to the
 * whole transcript and is kept on the host.
 *
 * @module @khorsheed/dsh-reader/client/SpeakerLegend
 */
import { useState, type ReactNode } from 'react'
import css from './ReaderPane.module.css'

export interface SpeakerLegendProps {
  readonly count: number
  readonly label: (speaker: number) => string
  readonly onRename: (speaker: number, name: string) => void
  readonly hint: string
  readonly renameTitle: string
}

export function SpeakerLegend(props: SpeakerLegendProps): ReactNode {
  const { count, label, onRename, hint, renameTitle } = props
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  return (
    <div className={css.speakerLegend}>
      {Array.from({ length: count }, (_, speaker) => (
        editing === speaker
          ? (
            <input
              key={speaker}
              className={css.speakerInput}
              data-spk={speaker}
              autoFocus
              value={draft}
              aria-label={renameTitle}
              onChange={event => { setDraft(event.target.value) }}
              onBlur={() => { setEditing(null) }}
              onKeyDown={event => {
                if (event.key === 'Enter') { onRename(speaker, draft); setEditing(null) }
                if (event.key === 'Escape') setEditing(null)
              }}
            />
          )
          : (
            <button
              key={speaker}
              type="button"
              className={css.speakerChip}
              data-spk={speaker}
              title={renameTitle}
              onClick={() => { setDraft(label(speaker)); setEditing(speaker) }}
            >
              {label(speaker)}
            </button>
          )
      ))}
      <span className={css.speakerHint}>{hint}</span>
    </div>
  )
}
