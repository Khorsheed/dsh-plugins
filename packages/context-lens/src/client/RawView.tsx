/**
 * The 原始 JSON view: the selected request's CapturedRequest serialized
 * verbatim — the structured panel's escape hatch for exact field values.
 *
 * @module @khorsheed/dsh-context-lens/client
 */
import type { ReactNode } from 'react'
import type { CapturedRequest } from '../types.ts'
import { requestNumberText, fmt } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './RawView.module.css'

/** The panel's translate face. */
type T = InspectorTabProps['t']

/** The raw view body. */
export function RawView({ request, t }: { readonly request: CapturedRequest; readonly t: T }): ReactNode {
  const serialized = JSON.stringify(request, null, 1)
  return (
    <div className={css.scroll}>
      <div className={css.hint}>{t('raw.hint', { seq: requestNumberText(request), chars: fmt(serialized.length) })}</div>
      <pre className={css.pre}>{serialized}</pre>
    </div>
  )
}
