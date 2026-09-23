  import { IconBrowseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
  import type { CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
  import type { CapabilityCatalogKey } from './locales.ts'
  import { McpCard } from './McpCards.tsx'
  import { ModeChips } from './ModeChips.tsx'
  import type { CatalogModeChip, ModeComparison } from './mode-model.ts'
  import type { McpGroup } from './mcp-model.ts'
  import css from './CapabilityCatalogCard.module.css'

export type ToolSegment = 'all' | 'builtin' | 'plugin' | 'mcp'

  /** Human label for one tool's channel pill. */
export function toolTag(tool: CatalogToolRow, t: (key: CapabilityCatalogKey) => string): string {
  if (tool.channel === 'mcp') return tool.serverName !== undefined ? `MCP · ${tool.serverName}` : 'MCP'
  if (tool.channel === 'plugin') return t('toolPlugin')
  if (tool.channel === 'builtin') return t('toolBuiltin')
  return tool.channel
}

/** Origin / ownership subtitle for a tool card. */
export function toolOrigin(tool: CatalogToolRow, t: (key: CapabilityCatalogKey) => string): string {
  if (tool.channel === 'mcp') return tool.serverName ?? 'MCP'
  if (tool.channel === 'plugin') return tool.owner ?? t('toolPlugin')
  return t('toolBuiltin')
}


  /** Tool preview card — same anatomy as the skill cards (shared .pvCard / .grid),
 * so tools and skills carry ONE style that can be optimized together. In the
 * comparison view a chip row names the modes that load it. */
function ToolCard({ tool, modes, modeTotal, onMode, onOpen, t }: {
  tool: CatalogToolRow
  modes?: readonly CatalogModeChip[] | undefined
  modeTotal?: number | undefined
  onMode: (id: string) => void
  onOpen: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  return (
    <div className={css.pvCard} data-modes={modes === undefined ? undefined : 'true'}>
      <button type="button" className={css.pvMain} onClick={onOpen}>
        <span className={css.pvHead}>
          <span className={css.pvName}>{tool.name}</span>
          <span className={`${css.pvTag} ${tool.channel === 'mcp' ? css.tagMcp : tool.channel === 'plugin' ? css.tagPlugin : ''}`}>{toolTag(tool, t)}</span>
        </span>
        <span className={css.pvDesc}>{tool.description}</span>
        <span className={css.pvSub}>{toolOrigin(tool, t)}</span>
      </button>
      {modes === undefined ? null : <ModeChips modes={modes} total={modeTotal ?? 0} onSelect={onMode} t={t} />}
      <div className={css.pvFoot}>
        <button type="button" className={css.iconButton} onClick={onOpen} aria-label={t('viewDetail')} title={t('viewDetail')}>
          <IconBrowseOutlineMedium size={16} />
        </button>
      </div>
    </div>
  )
}

/** The tools tab's card views following the segment filter. `all` renders both the
 * builtin/plugin tool cards AND the MCP server cards in ONE grid (so the 16px gap
 * stays uniform across them); the other segments render one set. */
export function ToolCards({ loading, visibleTools, mcpGroups, segment, comparison, modeChipsFor, onMode, onOpenTool, onOpenServer, onSetEnabled, onRemove, t }: {
  loading: boolean
  visibleTools: readonly CatalogToolRow[]
  mcpGroups: readonly McpGroup[]
  segment: ToolSegment
  /** The comparison model, or null when the grid shows one mode's face. */
  comparison: ModeComparison | null
  modeChipsFor: (ids: readonly string[] | undefined) => readonly CatalogModeChip[]
  onMode: (id: string) => void
  onOpenTool: (tool: CatalogToolRow) => void
  onOpenServer: (name: string) => void
  onSetEnabled: (serverName: string, enabled: boolean) => Promise<void>
  onRemove: (serverName: string) => Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  if (loading) return null
  const showsToolCards = segment !== 'mcp'
  const showsMcpServers = segment !== 'builtin' && segment !== 'plugin'
  const total = (showsToolCards ? visibleTools.length : 0) + (showsMcpServers ? mcpGroups.length : 0)
  /** The chips for one tool, or undefined when it has no row (see the skill card). */
  const chipsForTool = (tool: CatalogToolRow): readonly CatalogModeChip[] | undefined => {
    if (comparison === null) return undefined
    const chips = modeChipsFor(comparison.toolModes.get(tool.name))
    return chips.length === 0 ? undefined : chips
  }
  if (total === 0) {
    return segment === 'mcp'
      ? <div className={css.empty}>{t('mcpServerEmpty')}</div>
      : <div className={css.empty}>{t('toolNoMatch')}</div>
  }
  return (
    <div className={css.grid}>
      {showsToolCards ? visibleTools.map((tool) => (
        <ToolCard
          key={tool.name}
          tool={tool}
          modes={chipsForTool(tool)}
          modeTotal={comparison?.modes ?? 0}
          onMode={onMode}
          onOpen={() => onOpenTool(tool)}
          t={t}
        />
      )) : null}
      {showsMcpServers ? mcpGroups.map((g) => (
        <McpCard key={g.serverName} group={g} onOpen={() => onOpenServer(g.serverName)} onSetEnabled={onSetEnabled} onRemove={onRemove} t={t} />
      )) : null}
    </div>
  )
}
