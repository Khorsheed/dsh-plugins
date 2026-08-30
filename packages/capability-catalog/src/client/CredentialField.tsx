import type { CapabilityCatalogKey } from './locales.ts'
import css from './CapabilityCatalogCard.module.css'

export type CredentialSaveState = 'idle' | 'saving' | 'ok' | 'fail'

/** One presentational saved-credential row; state and save behavior stay local
 * to the containing modal. */
export function CredentialField({ label, configured, value, state, onChange, onSave, t }: {
  label: string
  configured: boolean
  value: string
  state: CredentialSaveState
  onChange: (value: string) => void
  onSave: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  return (
    <div className={css.credRow}>
      <label className={css.credLabel}>{label}
        {configured ? <span className={`${css.badge} ${css.badgeOk}`}>{t('configured')}</span> : <span className={css.badge}>{t('notConfigured')}</span>}
      </label>
      <div className={css.credInputRow}>
        <div className={css.inputWrap}>
          <input
            className={css.input}
            type="password"
            value={value}
            placeholder={configured ? t('configuredReplace') : t('credPlaceholder')}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => { if (value !== '') onSave() }}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave() }}
          />
        </div>
        {!configured ? (
          <button
            type="button"
            className={css.btnPrimary}
            disabled={state === 'saving' || value === ''}
            onClick={onSave}
          >{t('save')}</button>
        ) : null}
      </div>
      {state === 'ok' ? <div className={css.credOk}>{t('saved')}</div> : null}
      {state === 'fail' ? <div className={css.credFail}>{t('saveFailed')}</div> : null}
    </div>
  )
}
