import type { ReactNode } from 'react'
import css from './CapabilityCatalogCard.module.css'

export interface MetadataItem {
  readonly label: ReactNode
  readonly value: ReactNode
}

/** Presentational wrapping metadata row shared by content-detail dialogs. */
export function MetadataRow({ items }: { items: readonly MetadataItem[] }) {
  return (
    <div className={css.meta}>
      {items.map((item, index) => (
        <span className={css.metaItem} key={index}><span className={css.metaKey}>{item.label}</span><span className={css.metaVal}>{item.value}</span></span>
      ))}
    </div>
  )
}
