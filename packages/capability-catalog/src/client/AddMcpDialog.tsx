import { useEffect, useMemo, useState } from 'react'
  import type { CatalogMcpServerConfig, CatalogMcpTool } from '@khorsheed/dsh-capability-catalog/types'
  import { credentialStoredRefs, parseServerEntry } from '../mcps.ts'
  import type { CapabilityCatalogKey } from './locales.ts'
  import { ModalShell } from './ModalShell.tsx'
  import { configDisplay, transportLabel } from './mcp-model.ts'
import css from './CapabilityCatalogCard.module.css'

/** Extract a single server entry from a pasted snippet, plus its suggested
 * name. Accepts a bare entry (`command`/`url`), the `mcpServers` wrapper, or a
 * bare `{name: entry}` map; picks the first entry. */
function extractServerPreamble(raw: string): { entry: Record<string, unknown>; suggestedName: string } | null {
  let json: unknown
  try { json = JSON.parse(raw) } catch { return null }
  if (typeof json !== 'object' || json === null) return null
  const obj = json as Record<string, unknown>
  if (typeof obj['command'] === 'string' || typeof obj['url'] === 'string') {
    return { entry: obj, suggestedName: '' }
  }
  const container = (obj['mcpServers'] ?? obj) as Record<string, unknown>
  const firstKey = Object.keys(container).find((k) => typeof container[k] === 'object' && container[k] !== null)
  if (firstKey === undefined) return null
  return { entry: container[firstKey] as Record<string, unknown>, suggestedName: firstKey }
}

/** Add-MCP dialog: paste a server config → parse it into a server card →
 * configure credentials + enable → add. One server per add. */
export function AddMcpDialog({ onClose, mcpAdd, mcpSetCredential, mcpDiscover, refreshMcp, t }: {
  onClose: () => void
  mcpAdd: (config: CatalogMcpServerConfig) => Promise<boolean>
  mcpSetCredential: (ref: string, value: string) => Promise<boolean>
  mcpDiscover: (serverName: string) => Promise<readonly CatalogMcpTool[]>
  refreshMcp: () => Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  const [raw, setRaw] = useState('')
  const [serverName, setServerName] = useState('')
  const [credValues, setCredValues] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const preamble = useMemo(() => (raw.trim() === '' ? null : extractServerPreamble(raw)), [raw])
  const parseError = raw.trim() !== '' && preamble === null
  const finalName = serverName.trim() !== '' ? serverName.trim() : (preamble?.suggestedName ?? '')
  const parsed = useMemo(() => {
    if (preamble === null || finalName === '') return null
    return parseServerEntry(finalName, preamble.entry)
  }, [preamble, finalName])

  // Seed the name field once a suggestion appears (does not overwrite edits).
  useEffect(() => {
    if (serverName === '' && preamble !== null && preamble.suggestedName !== '') {
      setServerName(preamble.suggestedName)
    }
  }, [preamble, serverName])

  const canSubmit = parsed !== null && finalName !== ''

  const submit = async (): Promise<void> => {
    if (parsed === null || busy) return
    setBusy(true)
    setMsg(null)
    const config: CatalogMcpServerConfig = { ...parsed.config, enabled }
    const ok = await mcpAdd(config)
    if (!ok) {
      setMsg({ ok: false, text: t('addError') })
      setBusy(false)
      return
    }
    const refs = credentialStoredRefs(config.serverName, config)
    for (const cred of parsed.credentials) {
      const value = credValues[cred.ref] ?? ''
      if (value === '') continue
      await mcpSetCredential(refs[cred.ref] ?? cred.ref, value)
    }
    if (enabled) await mcpDiscover(config.serverName)
    await refreshMcp()
    onClose()
  }

  return (
    <ModalShell title={t('mcpAddTitled')} onClose={onClose} className={css.addModal} closeOnMask={false} t={t}>
      <p className={css.confHint}>{t('mcpAddHint')}</p>
      <textarea
        className={css.textarea}
        rows={6}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={t('mcpPastePlaceholder')}
        spellCheck={false}
      />

      {parseError ? <div className={`${css.addMsg} ${css.addMsgErr}`}>{t('mcpParseFailed')}</div> : null}
      {parsed === null ? null : (
        <div className={css.addPanel}>
          <label className={css.fieldLabel}>{t('mcpServerName')}</label>
          <input
            className={css.input}
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder={preamble?.suggestedName !== '' && preamble?.suggestedName !== undefined ? preamble.suggestedName : t('mcpServerNamePlaceholder')}
            spellCheck={false}
          />

          <div className={css.meta}>
            <span className={css.metaKey}>{t('mcpTransport')}</span>
            <span className={css.metaVal}>{transportLabel(t, parsed.config.transport)}</span>
          </div>

          <div>
            <div className={css.mcpBlockLabel}>{t('mcpConfig')}</div>
            <pre className={css.mcpConfig}>{configDisplay({ ...parsed.config, enabled })}</pre>
          </div>

          {parsed.credentials.length > 0 ? (
            <div>
              <div className={css.confHint}>{t('mcpNeedsCred')}</div>
              {parsed.credentials.map((cred) => (
                <div className={css.credRow} key={cred.ref}>
                  <label className={css.credLabel}>{cred.label}<span className={`${css.badge} ${css.badgeWarn}`}>{t('mcpCredBadge')}</span></label>
                  <div className={css.credInputRow}>
                    <div className={css.inputWrap}>
                      <input
                        className={css.input}
                        type="password"
                        value={credValues[cred.ref] ?? ''}
                        placeholder={t('credPlaceholder')}
                        onChange={(e) => setCredValues((s) => ({ ...s, [cred.ref]: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <label className={css.switchRow}>
            <span className={css.enableLabel}>{t('mcpEnabled')}</span>
            <span className={css.switch}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span className={css.track} />
              <span className={css.thumb} />
            </span>
          </label>

          {msg !== null ? <div className={`${css.addMsg} ${msg.ok ? css.addMsgOk : css.addMsgErr}`}>{msg.text}</div> : null}
        </div>
      )}

      <div className={css.actions}>
        <button type="button" className={css.btnGhost} onClick={onClose}>{t('cancel')}</button>
        <span className={css.spacer} />
        <button type="button" className={css.btnPrimary} disabled={!canSubmit || busy} onClick={() => void submit()}>{t('mcpAdd')}</button>
      </div>
    </ModalShell>
  )
}
