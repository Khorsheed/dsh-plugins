import { useState } from 'react'
  import { IconChevronDownOutline14, IconChevronRightOutline14, IconCopyOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
  import type { CatalogPresetOption, CatalogPresetScopeEditResult, CatalogSkillDetail, CatalogSkillFileRead } from '@khorsheed/dsh-capability-catalog/types'
  import type { CatalogModeChip } from './mode-model.ts'
  import type { CapabilityCatalogKey } from './locales.ts'
  import { BundleFileTree } from './BundleFileTree.tsx'
  import { CredentialField, type CredentialSaveState } from './CredentialField.tsx'
  import { MetadataRow } from './MetadataRow.tsx'
  import { ModalShell } from './ModalShell.tsx'
  import css from './CapabilityCatalogCard.module.css'

  export type DetailClaim = { status: 'idle' | 'loading' | 'done'; data: CatalogSkillDetail | undefined }

  /** The preset-scope editor's data face for one skill, when the deployment has one. */
  export interface ScopeEditor {
    /** Whether the skill lives in the plugin's managed root. */
    managed: boolean
    /** The presets its frontmatter currently declares (empty = every preset). */
    declared: readonly string[]
    /** A default root still supplying this name, when delivery is refused. */
    conflict?: string
    /** Whether the skill can be adopted out of a default root. */
    adoptable: boolean
    /**
     * Whether THIS skill's preset scope is writable at all. False for a
     * plugin-provided or built-in skill: its modes follow the plugin's own row
     * in each mode's composition, and the host refuses a scope write on it.
     */
    writable: boolean
    /** The plugin that provides a non-writable skill, when the row names one. */
    provider?: string
    /** Every preset the roster supplies. */
    options: readonly CatalogPresetOption[]
    save: (presets: readonly string[]) => Promise<CatalogPresetScopeEditResult>
    adopt: (presets: readonly string[]) => Promise<CatalogPresetScopeEditResult>
    release: () => Promise<CatalogPresetScopeEditResult>
  }

/** Why a skill with no writable preset scope has no editor. */
function providedScopeNote(t: (key: CapabilityCatalogKey) => string, provider: string | undefined): string {
  return provider === undefined
    ? t('scopeBuiltin')
    : t('scopeProvided').replace('{provider}', provider)
}

/** Centered modal with a skill's full detail, source browser, metadata and credential config. */
export function SkillDetailModal({ name, claim, onClose, setCredential, readSkillFile, t, scope, modeChips, modesLoading, onModeSelect }: {
  name: string
  claim: DetailClaim
  onClose: () => void
  setCredential: (key: string, value: string) => Promise<boolean>
  readSkillFile: (name: string, path: string) => Promise<CatalogSkillFileRead | undefined>
  t: (key: CapabilityCatalogKey) => string
  scope?: ScopeEditor | undefined
  /** The modes that load this skill, when its scope section cannot say (a
   * non-writable skill); undefined = not queried, [] = queried and in none. */
  modeChips?: readonly CatalogModeChip[] | undefined
  /** Whether the ask is still in flight. */
  modesLoading?: boolean
  onModeSelect?: (id: string) => void
}) {
  const [credValues, setCredValues] = useState<Record<string, string>>({})
  const [credState, setCredState] = useState<Record<string, CredentialSaveState>>({})
  const [copied, setCopied] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const data = claim.data
  // Source browser: the selected bundle file and its content (right pane).
  const [srcFile, setSrcFile] = useState('')
  const [srcContent, setSrcContent] = useState<string | undefined>(undefined)
  const [srcLoading, setSrcLoading] = useState(false)
  // Preset-scope editor: the pending selection, the busy flag, and the last message.
  const [scopePick, setScopePick] = useState<readonly string[] | null>(null)
  const [scopeBusy, setScopeBusy] = useState(false)
  const [scopeMsg, setScopeMsg] = useState<string | null>(null)

  const saveCred = async (key: string): Promise<void> => {
    const value = credValues[key] ?? ''
    if (value === '') return
    setCredState((s) => ({ ...s, [key]: 'saving' }))
    const ok = await setCredential(key, value)
    setCredState((s) => ({ ...s, [key]: ok ? 'ok' : 'fail' }))
  }

  const copySource = async (): Promise<void> => {
    const text = (srcFile === '' || srcFile === 'SKILL.md') ? data?.content : srcContent
    if (text === undefined) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard may be blocked */ }
  }

  const pickedScope = scopePick ?? scope?.declared ?? []

  /** Run one scope mutation, then report its outcome in place. */
  const runScope = async (action: () => Promise<CatalogPresetScopeEditResult>): Promise<void> => {
    setScopeBusy(true)
    setScopeMsg(null)
    try {
      const result = await action()
      setScopeMsg(result.ok ? t('scopeSaved') : `${t('scopeError')}: ${result.error ?? ''}`)
      if (result.ok) setScopePick(null)
    } finally {
      setScopeBusy(false)
    }
  }

  const toggleScope = (id: string): void => {
    setScopePick(pickedScope.includes(id) ? pickedScope.filter(value => value !== id) : [...pickedScope, id])
  }

  // Select a bundle file for the source pane. SKILL.md's body is already in the
  // detail (no extra RPC); other files load on demand.
  const selectSource = (path: string): void => {
    setSrcFile(path)
    if (path === 'SKILL.md') {
      setSrcLoading(false)
      setSrcContent(data?.content)
      return
    }
    setSrcLoading(true)
    setSrcContent(undefined)
    void readSkillFile(name, path).then(res => {
      setSrcContent(res?.content)
      setSrcLoading(false)
    })
  }

  return (
    <ModalShell title={name} onClose={onClose} t={t}>
  {claim.status === 'loading' ? <div className={css.empty}>{t('loading')}</div> : null}
      {claim.status === 'done' && data === undefined ? <div className={css.empty}>{t('loadFailed')}</div> : null}

      {claim.status === 'done' && data !== undefined ? (
        <>
          <MetadataRow items={[
            { label: t('source'), value: data.source },
            { label: t('provider'), value: data.provider },
            { label: t('modelInvocable'), value: data.modelInvocable ? t('yes') : t('no') },
            ...(data.whenToUse !== undefined ? [{ label: t('whenToUse'), value: data.whenToUse }] : []),
          ]} />
          <p className={css.detailDesc}>{data.description}</p>

          {scope !== undefined ? (
            <section className={css.scopeBox}>
              <div className={css.scopeHead}>
                <span className={css.scopeTitle}>{t('scopeSection')}</span>
                <button
                  type="button"
                  className={css.scopeInfo}
                  title={`${t('scopeHint')}\n\n${t('scopeProbe')}`}
                  aria-label={t('scopeInfoLabel')}
                >
                  i
                </button>
              </div>
              {scope.options.length === 0 ? (
                <div className={css.scopeHint}>{t('scopeUnavailable')}</div>
              ) : !scope.writable ? (
                <>
                  {/* The host writes a preset scope only into the managed root, so a
                      plugin-provided or built-in skill has none to edit. The section
                      explains which plugin decides AND shows where it actually loads,
                      which is the same question the mode picker answers. */}
                  <div className={css.scopeHint}>{providedScopeNote(t, scope.provider)}</div>
                  {modesLoading === true ? (
                    <div className={css.scopeHint}>{t('modeBusy')}</div>
                  ) : modeChips === undefined ? null : modeChips.length === 0 ? (
                    <div className={css.scopeHint}>{t('modeNone')}</div>
                  ) : (
                    <>
                      <div className={css.pvModes}>
                        <span className={css.pvModesLabel}>{t('modeIn')}</span>
                        {modeChips.map(chip => (
                          <button
                            key={chip.id}
                            type="button"
                            className={css.modeChip}
                            data-default={chip.isDefault ? 'true' : undefined}
                            title={t('modeChipHint')}
                            onClick={() => onModeSelect?.(chip.id)}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                      <div className={css.scopeHint}>{t('modeChipsCost')}</div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className={css.scopeGrid}>
                    {scope.options.map((option) => (
                      <label className={css.scopeItem} key={option.id} title={option.description}>
                        <input
                          type="checkbox"
                          checked={pickedScope.includes(option.id)}
                          disabled={scopeBusy}
                          onChange={() => toggleScope(option.id)}
                        />
                        <span>{option.name ?? option.id}</span>
                        {option.broken !== undefined ? <span className={css.scopeBadge}>{t('scopeBroken')}</span> : null}
                      </label>
                    ))}
                  </div>
                  <div className={css.scopeActions}>
                    {/* A skill not yet in the managed root has nothing to save
                        yet: its selection is the scope `adopt` installs it with. */}
                    {scope.managed ? (
                      <button
                        type="button"
                        className={css.addBtn}
                        disabled={scopeBusy}
                        onClick={() => void runScope(() => scope.save(pickedScope))}
                      >
                        {scopeBusy ? t('scopeSaving') : t('scopeSave')}
                      </button>
                    ) : null}
                    {scope.managed ? (
                      <button
                        type="button"
                        className={css.addBtn}
                        disabled={scopeBusy}
                        onClick={() => void runScope(() => scope.release())}
                      >
                        {t('scopeRelease')}
                      </button>
                    ) : scope.adoptable ? (
                      <button
                        type="button"
                        className={css.addBtn}
                        disabled={scopeBusy}
                        onClick={() => void runScope(() => scope.adopt(pickedScope))}
                      >
                        {t('scopeAdopt')}
                      </button>
                    ) : null}
                    {scopeMsg !== null ? <span className={css.scopeHint}>{scopeMsg}</span> : null}
                  </div>
                  {scope.conflict !== undefined ? (
                    <div className={css.scopeConflict}>{t('scopeConflict')}: {scope.conflict}</div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {/* Above the credential form, not below the source browser: this block
              is the skill's own frontmatter, and a raw JSON dump pressed against
              the code pane reads as part of the source view. */}
          {data.metadataText !== undefined && hasUnrenderedMetadata(data.metadataText) ? (
            <details className={css.source}>
              <summary className={css.sourceTitle}>{t('frontmatterMetadata')}</summary>
              <pre className={css.codeBlk}>{formatMetadata(data.metadataText)}</pre>
            </details>
          ) : null}

          {data.credentials !== undefined && data.credentials.length > 0 ? (
            <details className={css.conf} open>
              <summary className={css.confTitle}>{t('credentials')}</summary>
              <div className={css.confHint}>{t('credentialsHint')}</div>
              {data.credentials.map((decl) => {
                const key = decl.key
                const label = decl.label ?? key
                const state = credState[key] ?? 'idle'
                const configured = decl.configured || state === 'ok'
                return (
                  <CredentialField
                    key={key}
                    label={label}
                    configured={configured}
                    value={credValues[key] ?? ''}
                    state={state}
                    onChange={(value) => setCredValues((s) => ({ ...s, [key]: value }))}
                    onSave={() => void saveCred(key)}
                    t={t}
                  />
                )
              })}
            </details>
          ) : null}

          {data.environmentRefs !== undefined && data.environmentRefs.length > 0 ? (
            <details className={css.conf}>
              <summary className={css.confTitle}>{t('envRefs')}</summary>
              <div className={css.confHint}>{t('envRefsHint')}</div>
              <div className={css.envRefList}>
                {data.environmentRefs.map((ref) => (
                  <span className={css.envRef} key={ref}>{ref}</span>
                ))}
              </div>
            </details>
          ) : null}

          {(() => {
            const files = data.files !== undefined && data.files.length > 0 ? data.files : ['SKILL.md']
            const single = files.length <= 1
            return (
              <section className={css.sourceSection}>
                <button type="button" className={css.sourceTrigger} onClick={() => setSourceOpen((o) => !o)} aria-expanded={sourceOpen}>
                  <span className={css.sourceChevron}>{sourceOpen ? <IconChevronDownOutline14 size={16} /> : <IconChevronRightOutline14 size={16} />}</span>
                  <span className={css.sourceLabel}>{t('viewSource')}</span>
                </button>
                {sourceOpen ? (
                  single ? (
                    <div className={css.sourceSingle}>
                      <div className={css.sourceBar}>
                        <span className={css.sourceBarFile}>{srcFile === '' || srcFile === 'SKILL.md' ? 'SKILL.md' : srcFile}</span>
                        <button type="button" className={css.sourceCopy} onClick={() => void copySource()} aria-label={t('copy')}>
                          {copied ? t('copied') : <span className={css.codeCopyIcon}><IconCopyOutline16 size={16} /> {t('copy')}</span>}
                        </button>
                      </div>
                      <div className={css.detailPane}>
                        {srcLoading ? <div className={css.empty}>{t('loading')}</div>
                          : (srcFile === '' || srcFile === 'SKILL.md') ? <pre className={css.codeBlk}>{data.content}</pre>
                            : srcContent === undefined ? <div className={css.empty}>{t('loadFailed')}</div>
                              : <pre className={css.codeBlk}>{srcContent}</pre>}
                      </div>
                    </div>
                  ) : (
                    <div className={css.split}>
                      <div className={css.treePane}>
                        <BundleFileTree
                          files={files}
                          selectedPath={srcFile === '' ? 'SKILL.md' : srcFile}
                          onSelect={selectSource}
                        />
                      </div>
                      <div className={css.detailPane}>
                        <button type="button" className={css.codeCopy} onClick={() => void copySource()} aria-label={t('copy')}>
                          {copied ? <span>{t('copied')}</span> : <span className={css.codeCopyIcon}><IconCopyOutline16 size={16} /> {t('copy')}</span>}
                        </button>
                        {srcLoading ? <div className={css.empty}>{t('loading')}</div>
                          : (srcFile === '' || srcFile === 'SKILL.md') ? <pre className={css.codeBlk}>{data.content}</pre>
                            : srcContent === undefined ? <div className={css.empty}>{t('loadFailed')}</div>
                              : <pre className={css.codeBlk}>{srcContent}</pre>}
                      </div>
                    </div>
                  )
                ) : null}
              </section>
            )
          })()}
        </>
      ) : null}
    </ModalShell>
  )
}

/**
 * Metadata keys this modal already renders in a dedicated place.
 *
 * `presetScope` is edited by the scope section and visible in the source pane;
 * `credentials` is the credential form above (its values live in the credential
 * store, never in the frontmatter). Repeating either as raw JSON is noise, and
 * an empty `metadata` block appearing because someone declared a credential is
 * worse than noise — it reads as a defect.
 */
const RENDERED_METADATA_KEYS: ReadonlySet<string> = new Set(['presetScope', 'credentials'])

/**
 * Whether a skill's metadata holds anything the modal does not already render.
 * @param metadataText - the serialized metadata object.
 * @returns whether the block is worth showing.
 */
export function hasUnrenderedMetadata(metadataText: string): boolean {
  try {
    const parsed: unknown = JSON.parse(metadataText)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    return Object.keys(parsed).some(key => !RENDERED_METADATA_KEYS.has(key))
  } catch {
    return true
  }
}

/** Keys whose VALUE is replaced before a metadata dump is displayed. */
const SECRET_KEY_PATTERN = /key|token|secret|password/i

/** The placeholder a secret-shaped metadata value renders as. */
const REDACTED = '···'

/**
 * Replace secret-shaped VALUES in a metadata object before display.
 *
 * The metadata block prints whatever frontmatter carries, and today nothing
 * secret lives there (credential values are stored in the credential service,
 * never in the file). This is a display guard for the day someone puts an
 * inline token in a metadata key: the block still shows the key and its shape,
 * but not the value. Matching is on the KEY (recursively, so a nested
 * `auth.token` is covered) — a value-shaped heuristic would redact prose.
 * @param value - any parsed metadata value.
 * @returns the same shape with secret-keyed values replaced.
 */
export function redactMetadataSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(entry => redactMetadataSecrets(entry))
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactMetadataSecrets(entry)
  }
  return out
}

/** Pretty-print a JSON metadata string for display, with secret-shaped values redacted. */
export function formatMetadata(metadataText: string): string {
  try {
    return JSON.stringify(redactMetadataSecrets(JSON.parse(metadataText)), null, 2)
  } catch {
    return metadataText
  }
}
