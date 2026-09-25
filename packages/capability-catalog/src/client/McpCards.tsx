import { IconBrowseOutlineMedium, IconTrashOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
  import type { CapabilityCatalogKey } from './locales.ts'
  import { transportLabel, type McpGroup } from './mcp-model.ts'
  import css from './CapabilityCatalogCard.module.css'

/** One MCP server tile in the `mcp` segment: name + transport pill + tool count,
 * with an external enable switch (managed only) and a click-through to the
 * manage modal. Servers carry no description, so the body shows the tool count. */
export function McpCard({ group, onOpen, onSetEnabled, onRemove, t }: {
  group: McpGroup
  onOpen: () => void
  onSetEnabled: (serverName: string, enabled: boolean) => Promise<void>
  onRemove: (serverName: string) => Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  const transportText = transportLabel(t, group.transport ?? 'stdio')
  const body = group.toolCount > 0 ? t('mcpToolCount').replace('{n}', String(group.toolCount)) : t('mcpNoTools')
  return (
    <div className={css.pvCard}>
      <button type="button" className={css.pvMain} onClick={onOpen}>
        <span className={css.pvHead}>
          <span className={css.pvName}>{group.serverName}</span>
          <span className={`${css.pvTag} ${group.transport === 'stdio' ? css.tagStdio : group.transport === 'streamable-http' ? css.tagHttp : ''}`}>{transportText}</span>
        </span>
        <span className={css.pvDesc}>{body}</span>
        <span className={css.pvSub}>{group.managed ? (group.enabled ? t('mcpEnabled') : t('mcpDisabled')) : 'MCP'}</span>
      </button>
      <div className={css.pvFoot}>
        {group.managed ? (
          <label className={`${css.switch} ${css.mcpFootToggle}`} onClick={(e) => e.stopPropagation()} title={t('mcpEnabled')}>
            <input
              type="checkbox"
              checked={group.enabled}
              onChange={(e) => void onSetEnabled(group.serverName, e.target.checked)}
              aria-label={t('mcpEnabled')}
            />
            <span className={css.track} />
            <span className={css.thumb} />
          </label>
        ) : null}
        <span className={css.mcpCardActions}>
          <button type="button" className={css.iconButton} onClick={onOpen} aria-label={t('viewDetail')} title={t('viewDetail')}>
            <IconBrowseOutlineMedium size={16} />
          </button>
          {group.managed ? (
            <button type="button" className={`${css.iconButton} ${css.iconDanger}`} onClick={() => void onRemove(group.serverName)} aria-label={t('mcpRemove')} title={t('mcpRemove')}>
              <IconTrashOutlineMedium size={16} />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  )
}
