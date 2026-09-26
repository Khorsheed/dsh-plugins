import { useState } from 'react'
  import { IconChevronRightOutlineMedium, IconSearchOutlineMedium } from './icons.tsx'
  import type { CatalogMcpTool, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
  import type { CapabilityCatalogKey } from './locales.ts'
  import { CredentialField, type CredentialSaveState } from './CredentialField.tsx'
  import { ModalShell } from './ModalShell.tsx'
  import { configDisplay, type McpGroup } from './mcp-model.ts'
import css from './CapabilityCatalogCard.module.css'

/** The CatalogToolRow the shared tool detail modal needs for one MCP tool row —
 * live rows pass through; managed rows are synthesized with the server attribution. */
function mcpToolRowFor(tool: CatalogMcpTool | CatalogToolRow, serverName: string): CatalogToolRow {
  if ('channel' in tool) return tool
  return {
    name: tool.name,
    description: tool.description,
    channel: 'mcp',
    confidence: 'exact',
    serverName,
    ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
  }
}

/** Manage-modal for one MCP server (opened from the tile): config JSON,
 * credential inputs, per-tool enable toggles, and discover. Clicking a tool row
 * opens the SHARED tool detail modal (stacked on top) for its parameter schema —
 * the manage modal stays server-level. */
export function McpServerManageModal({ group, discovering, onClose, onSetCredential, onSetToolEnabled, onDiscover, onOpenTool, t }: {
  group: McpGroup
  discovering: boolean
  onClose: () => void
  onSetCredential: (ref: string, value: string) => Promise<boolean>
  onSetToolEnabled: (serverName: string, tool: string, enabled: boolean) => Promise<void>
  onDiscover: (serverName: string) => Promise<void>
  onOpenTool: (tool: CatalogToolRow) => void
  t: (key: CapabilityCatalogKey) => string
}) {
  const [credValues, setCredValues] = useState<Record<string, string>>({})
  const [credState, setCredState] = useState<Record<string, CredentialSaveState>>({})
  const [toolQuery, setToolQuery] = useState('')

  const saveCred = async (ref: string): Promise<void> => {
    const value = credValues[ref] ?? ''
    if (value === '') return
    setCredState((s) => ({ ...s, [ref]: 'saving' }))
    const ok = await onSetCredential(ref, value)
    setCredState((s) => ({ ...s, [ref]: ok ? 'ok' : 'fail' }))
    if (ok) setCredValues((s) => ({ ...s, [ref]: '' }))
  }

  const runDiscover = async (): Promise<void> => {
    await onDiscover(group.serverName)
  }

  const live = group.managed ? group.tools : group.liveTools
  const toolQ = toolQuery.trim().toLowerCase()
  const visibleLive = toolQ === ''
    ? live
    : live.filter((tool) => tool.name.toLowerCase().includes(toolQ) || tool.description.toLowerCase().includes(toolQ))
  // How many of this server's tools are enabled (live-only groups have no
  // per-tool toggle, so all are treated as enabled).
  const enabledCount = group.managed ? group.tools.filter((tool) => tool.enabled).length : live.length

  return (
    <ModalShell title={group.serverName} onClose={onClose} t={t}>
      <div className={css.mcpBody}>
        {group.managed && group.config !== undefined ? (
          <>
            <details className={css.mcpConfigDetails}>
              <summary className={css.mcpConfigSummary}>
                <span className={css.mcpConfigChevron}><IconChevronRightOutlineMedium size={14} /></span>
                {t('mcpConfig')}
              </summary>
              <pre className={css.mcpConfig}>{configDisplay(group.config)}</pre>
            </details>

            {group.credentials.length > 0 ? (
              <div>
                <div className={css.mcpBlockLabel}>{t('credentials')}</div>
                <div className={css.confHint}>{t('mcpNeedsCred')}</div>
                {group.credentials.map((decl) => {
                  const ref = decl.ref
                  const state = credState[ref] ?? 'idle'
                  return (
                    <CredentialField
                      key={ref}
                      label={decl.label}
                      configured={decl.configured}
                      value={credValues[ref] ?? ''}
                      state={state}
                      onChange={(value) => setCredValues((s) => ({ ...s, [ref]: value }))}
                      onSave={() => void saveCred(ref)}
                      t={t}
                    />
                  )
                })}
              </div>
            ) : null}
          </>
        ) : null}

        <div>
          <div className={css.mcpToolBar}>
            <div className={css.mcpToolLabelRow}>
              <div className={css.mcpBlockLabel}>{t('mcpTools')}<span className={css.tabCnt}>{live.length}</span></div>
              {live.length > 0 ? <span className={css.mcpEnabledCount}>{enabledCount}/{live.length} {t('mcpEnabledOf')}</span> : null}
            </div>
            {live.length > 0 ? (
              <div className={css.mcpToolSearchBox}>
                <span className={css.searchIcon}><IconSearchOutlineMedium size={14} /></span>
                <input
                  className={css.mcpToolSearch}
                  type="search"
                  value={toolQuery}
                  placeholder={t('mcpToolSearchPlaceholder')}
                  aria-label={t('mcpToolSearchPlaceholder')}
                  onChange={(e) => setToolQuery(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          {live.length === 0 ? (
            <div className={css.empty}>{t('mcpEmptyTools')}</div>
          ) : visibleLive.length === 0 ? (
            <div className={css.empty}>{t('toolNoMatch')}</div>
          ) : (
            <div className={css.mcpTools}>
              {visibleLive.map((tool) => (
                <McpToolRow
                  key={tool.name}
                  tool={tool}
                  managed={group.managed}
                  serverName={group.serverName}
                  onOpen={(row) => onOpenTool(mcpToolRowFor(row, group.serverName))}
                  onSetToolEnabled={group.managed ? onSetToolEnabled : undefined}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>

        {group.managed ? (
          <div className={css.mcpActions}>
            {!group.enabled ? (
              <span className={css.confHint}>{t('mcpNotEnabled')}</span>
            ) : (
              <button type="button" className={`${css.mcpActionBtn} ${css.primary}`} disabled={discovering} onClick={() => void runDiscover()}>
                {discovering ? t('mcpDiscovering') : t('mcpDiscover')}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </ModalShell>
  )
}

/** One tool row inside a MCP server group: name/desc (click to open the shared
 * tool detail modal) + a per-tool enable switch (managed servers only). */
function McpToolRow({ tool, managed, serverName, onOpen, onSetToolEnabled, t }: {
  tool: CatalogMcpTool | CatalogToolRow
  managed: boolean
  serverName: string
  onOpen: (tool: CatalogMcpTool | CatalogToolRow) => void
  onSetToolEnabled: ((serverName: string, tool: string, enabled: boolean) => Promise<void>) | undefined
  t: (key: CapabilityCatalogKey) => string
}) {
  const isMcp = managed && 'enabled' in tool
  const enabled = isMcp ? (tool as CatalogMcpTool).enabled : true
  return (
    <div key={tool.name} className={css.mcpToolCard}>
      <div className={css.mcpToolRow}>
        <button type="button" className={css.mcpToolMain} onClick={() => onOpen(tool)}>
          <span className={css.mcpToolName}>{tool.name}</span>
          <span className={css.mcpToolDesc}>{tool.description}</span>
        </button>
        {isMcp ? (
          <label
            className={`${css.switch} ${css.mcpToolToggle}`}
            onClick={(e) => e.stopPropagation()}
            title={t('mcpToolToggleHint')}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => void onSetToolEnabled?.(serverName, tool.name, e.target.checked)}
              aria-label={t('mcpEnabled')}
            />
            <span className={css.track} />
            <span className={css.thumb} />
          </label>
        ) : null}
      </div>
    </div>
  )
}
