/**
 * Capability-catalog settings section (工具与技能): a standalone nav tab.
 *
 * Layout: a heading + intro, a toolbar (技能 / 工具 tab switch + primary
 * add-skill button), a filter/sort bar for the skills grid, and the list.
 * - 技能 tab renders a responsive grid of preview cards (name + description
 *   preview + source/provider pills). Clicking a card opens a centered modal
 *   with the full detail, the SKILL.md source, the frontmatter metadata, and a
 *   config block for every credential the skill's metadata declares. The modal
 *   keeps its head fixed and scrolls only its body; the source browser's tree
 *   and code panes scroll independently.
 * - 工具 tab renders collapsible tool cards (name + channel attribution).
 * - The add-skill button opens a modal that installs a skill from an uploaded
 *   zip archive, a pasted source command, or a local directory, then refreshes
 *   the catalog.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconFolderClose16,
  IconFolderOpen16,
  IconFolderOpenOutline16,
  IconSearchOutline16,
  IconCopyOutline16,
  IconBrowseOutline16,
  IconTrashOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityCatalogCardProps } from './slots.ts'
import type { CapabilityCatalogKey } from './locales.ts'
import type { CapabilityCatalogSnapshot, CatalogAddSkillRequest, CatalogDirSkillInfo, CatalogJsonValue, CatalogMcpCredentialDecl, CatalogMcpServerConfig, CatalogMcpSnapshot, CatalogMcpTool, CatalogSkillDetail, CatalogSkillFileRead, CatalogSkillRow, CatalogToolRow, McpTransport } from '@khorsheed/dsh-capability-catalog/types'
import { parseServerEntry, maskSecret, credentialStoredRefs, SECRET_REF_PREFIX } from '../mcps.ts'
import css from './CapabilityCatalogCard.module.css'

type Kind = 'skills' | 'tools'
type DetailClaim = { status: 'idle' | 'loading' | 'done'; data: CatalogSkillDetail | undefined }
type SortBy = 'name' | 'updated'
/** Tools-tab segment: one of the three grid views (builtin / plugin / mcp). */
type ToolSegment = 'all' | 'builtin' | 'plugin' | 'mcp'

/** Built-in / plugin-provided skill sources — never deletable, shown with the 内置 tag. */
const BUILTIN_SOURCES: ReadonlySet<string> = new Set(['runtime', 'bundled', 'skill-badge'])
const isBuiltin = (skill: CatalogSkillRow): boolean => BUILTIN_SOURCES.has(skill.source)

export function CapabilityCatalogCard({
  useCatalog, detail, readSkillFile, listDirSkills, pickDirectory, setCredential, addSkill, deleteSkill, refresh,
  mcpSnapshot, mcpAdd, mcpRemove, mcpSetEnabled, mcpSetCredential, mcpSetToolEnabled, mcpDiscover,
  t,
}: CapabilityCatalogCardProps) {
  const snapshot = useCatalog((s) => s)
  const [kind, setKind] = useState<Kind>('skills')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [claim, setClaim] = useState<DetailClaim>({ status: 'idle', data: undefined })
  const [showAdd, setShowAdd] = useState(false)
  const [showAddMcp, setShowAddMcp] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // Grid filter / sort state.
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  // Tool grid segment (builtin / plugin / mcp).
  const [toolSegment, setToolSegment] = useState<ToolSegment>('all')
  // Tool detail (click a tool card to view its full detail).
  const [toolDetail, setToolDetail] = useState<CatalogToolRow | null>(null)
  // MCP management state: the snapshot, the open add-dialog, expanded servers,
  // and the set currently mid-discover.
  const [mcps, setMcps] = useState<CatalogMcpSnapshot | null>(null)
  const [mcpDetailName, setMcpDetailName] = useState<string | null>(null)
  const [discoveringMcp, setDiscoveringMcp] = useState<ReadonlySet<string>>(() => new Set())

  const skills = snapshot?.skills ?? []
  const tools = snapshot?.tools ?? []
  const loading = snapshot == null

  /** Re-fetch the MCP management snapshot (after any MCP mutation). */
  const refreshMcp = async (): Promise<void> => {
    const s = await mcpSnapshot()
    setMcps(s)
  }
  useEffect(() => { void refreshMcp() }, [])

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = skills.filter((s) =>
      q === '' || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    const sorted = [...matched]
    if (sortBy === 'updated') sorted.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    else sorted.sort((a, b) => a.name.localeCompare(b.name))
    return sorted
  }, [skills, query, sortBy])

  /** Per-segment counts for the three grid filters. */
  const builtinCount = useMemo(() => tools.filter((tool) => tool.channel === 'builtin').length, [tools])
  const pluginCount = useMemo(() => tools.filter((tool) => tool.channel === 'plugin').length, [tools])

  /** Tool cards for the current segment. `all` shows builtin + plugin (MCP still
   * renders as server cards below). Filtered by query, name-sorted. */
  const visibleTools = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = tools.filter((tool) => {
      if (toolSegment === 'all') {
        if (tool.channel !== 'builtin' && tool.channel !== 'plugin') return false
      } else if (tool.channel !== toolSegment) {
        return false
      }
      if (q === '') return true
      return tool.name.toLowerCase().includes(q)
        || tool.description.toLowerCase().includes(q)
        || (tool.serverName ?? '').toLowerCase().includes(q)
        || (tool.owner ?? '').toLowerCase().includes(q)
    })
    return matched.sort((a, b) => a.name.localeCompare(b.name))
  }, [tools, query, toolSegment])

  /** Merged MCP server groups for the `mcp` segment: catalog-managed servers
   * + any live-registered (mcp-<server>__<tool>) tools grouped by server. */
  const mcpGroups = useMemo(() => buildMcpGroups(snapshot, mcps, query), [snapshot, mcps, query])

  /** The MCP server group open in the manage modal (derived fresh so mutations
   * re-render it, never a stale snapshot), or null when closed. */
  const mcpDetail = useMemo(
    () => mcpGroups.find((g) => g.serverName === mcpDetailName) ?? null,
    [mcpGroups, mcpDetailName],
  )

  const removeMcp = async (serverName: string): Promise<void> => {
    await mcpRemove(serverName)
    await refreshMcp()
  }
  const setMcpEnabled = async (serverName: string, enabled: boolean): Promise<void> => {
    await mcpSetEnabled(serverName, enabled)
    await refreshMcp()
  }
  const setMcpToolEnabled = async (serverName: string, tool: string, enabled: boolean): Promise<void> => {
    await mcpSetToolEnabled(serverName, tool, enabled)
    await refreshMcp()
  }
  const discoverMcp = async (serverName: string): Promise<void> => {
    setDiscoveringMcp((prev) => new Set(prev).add(serverName))
    try {
      await mcpDiscover(serverName)
    } finally {
      setDiscoveringMcp((prev) => { const n = new Set(prev); n.delete(serverName); return n })
      await refreshMcp()
    }
  }

  const openDetail = async (name: string): Promise<void> => {
    setSelectedName(name)
    setClaim({ status: 'loading', data: undefined })
    const data = await detail(name)
    setClaim({ status: 'done', data })
  }
  const closeDetail = (): void => {
    setSelectedName(null)
    setClaim({ status: 'idle', data: undefined })
  }

  const resetFilter = (): void => {
    setQuery('')
    setSortBy('name')
    setToolSegment('all')
  }

  return (
    <div className={css.section}>
      <div className={css.headRow}>
        <h2 className={css.heading}>{t('title')}</h2>
      </div>
      <p className={css.intro}>{t('intro')}</p>

      <div className={css.toolbar}>
        <div className={css.tabs} role="tablist">
          <button type="button" className={css.tab} data-active={kind === 'skills'} role="tab" onClick={() => setKind('skills')}>
            {t('skillTab')}<span className={css.tabCnt}>{skills.length}</span>
          </button>
          <button type="button" className={css.tab} data-active={kind === 'tools'} role="tab" onClick={() => setKind('tools')}>
            {t('toolTab')}<span className={css.tabCnt}>{tools.length}</span>
          </button>
        </div>
        <button
          type="button"
          className={css.addBtn}
          onClick={() => (kind === 'skills' ? setShowAdd(true) : setShowAddMcp(true))}
        >
          {kind === 'skills' ? t('addSkill') : t('addMcp')}
        </button>
      </div>

      {!loading && kind === 'skills' && skills.length > 0 ? (
        <div className={css.filterBar} role="search">
          <div className={css.searchBox}>
            <span className={css.searchIcon}><IconSearchOutline16 size={16} /></span>
            <input
              className={css.searchInput}
              type="search"
              value={query}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className={css.select} value={sortBy} aria-label={t('sortBy')} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="name">{t('sortBy')}: {t('sortName')}</option>
            <option value="updated">{t('sortBy')}: {t('sortUpdated')}</option>
          </select>
        </div>
      ) : null}

      {!loading && kind === 'tools' && tools.length > 0 ? (
        <>
          <div className={css.filterBar} role="search">
            <div className={css.searchBox}>
              <span className={css.searchIcon}><IconSearchOutline16 size={16} /></span>
              <input
                className={css.searchInput}
                type="search"
                value={query}
                placeholder={t('toolSearchPlaceholder')}
                aria-label={t('toolSearchPlaceholder')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className={css.segBar} role="group" aria-label={t('source')}>
            <button type="button" className={css.segBtn} data-active={toolSegment === 'all'} onClick={() => setToolSegment('all')}>
              {t('filterAll')}<span className={css.tabCnt}>{tools.length}</span>
            </button>
            <button type="button" className={css.segBtn} data-active={toolSegment === 'builtin'} onClick={() => setToolSegment('builtin')}>
              {t('toolBuiltin')}<span className={css.tabCnt}>{builtinCount}</span>
            </button>
            <button type="button" className={css.segBtn} data-active={toolSegment === 'plugin'} onClick={() => setToolSegment('plugin')}>
              {t('toolPlugin')}<span className={css.tabCnt}>{pluginCount}</span>
            </button>
            <button type="button" className={css.segBtn} data-active={toolSegment === 'mcp'} onClick={() => setToolSegment('mcp')}>
              {t('toolOther')}<span className={css.tabCnt}>{mcpGroups.length}</span>
            </button>
          </div>
        </>
      ) : null}

      {loading ? <div className={css.empty}>{t('loading')}</div> : null}
      {!loading && kind === 'skills' && skills.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}
      {!loading && kind === 'tools' && tools.length === 0 ? <div className={css.empty}>{t('toolNoMatch')}</div> : null}

      {!loading && kind === 'skills' && skills.length > 0 ? (
        visibleSkills.length === 0
          ? <div className={css.empty}>{t('noFilterMatch')} <button type="button" className={css.ghostLink} onClick={resetFilter}>{t('filterAll')}</button></div>
          : (
            <div className={css.grid}>
              {visibleSkills.map((skill) => (
                <SkillPreviewCard
                  key={skill.name}
                  skill={skill}
                  builtin={isBuiltin(skill)}
                  onOpen={() => void openDetail(skill.name)}
                  onDelete={() => setDeleteTarget(skill.name)}
                  t={t}
                />
              ))}
            </div>
          )
      ) : null}

      {kind === 'tools' ? (
        <ToolCards
          loading={loading}
          visibleTools={visibleTools}
          mcpGroups={mcpGroups}
          segment={toolSegment}
          onOpenTool={(tool) => setToolDetail(tool)}
          onOpenServer={(name) => setMcpDetailName(name)}
          onSetEnabled={setMcpEnabled}
          onRemove={removeMcp}
          resetFilter={resetFilter}
          t={t}
        />
      ) : null}

      {toolDetail !== null ? (
        <ToolDetailModal tool={toolDetail} onClose={() => setToolDetail(null)} t={t} />
      ) : null}

      {mcpDetail !== null ? (
        <McpServerManageModal
          group={mcpDetail}
          discovering={discoveringMcp.has(mcpDetail.serverName)}
          onClose={() => setMcpDetailName(null)}
          onSetCredential={mcpSetCredential}
          onSetToolEnabled={setMcpToolEnabled}
          onDiscover={discoverMcp}
          t={t}
        />
      ) : null}

      {selectedName !== null ? (
        <SkillDetailModal
          name={selectedName}
          claim={claim}
          onClose={closeDetail}
          setCredential={setCredential}
          readSkillFile={readSkillFile}
          t={t}
        />
      ) : null}

      {showAdd ? (
        <AddSkillModal onClose={() => setShowAdd(false)} addSkill={addSkill} listDirSkills={listDirSkills} pickDirectory={pickDirectory} refresh={refresh} t={t} />
      ) : null}

      {showAddMcp ? (
        <AddMcpDialog
          onClose={() => setShowAddMcp(false)}
          mcpAdd={mcpAdd}
          mcpSetCredential={mcpSetCredential}
          mcpDiscover={mcpDiscover}
          refreshMcp={refreshMcp}
          t={t}
        />
      ) : null}

      {deleteTarget !== null ? (
        <DeleteSkillConfirm
          name={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const res = await deleteSkill(deleteTarget)
            if (res.ok) await refresh()
            setDeleteTarget(null)
          }}
          t={t}
        />
      ) : null}
    </div>
  )
}

/** Preview card in the skills grid (Agent-preset anatomy): name + built-in tag,
 * two-line description, provider subtitle, foot actions. */
function SkillPreviewCard({ skill, builtin, onOpen, onDelete, t }: {
  skill: CatalogSkillRow
  builtin: boolean
  onOpen: () => void
  onDelete: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  return (
    <div className={css.pvCard}>
      <button type="button" className={css.pvMain} onClick={onOpen}>
        <span className={css.pvHead}>
          <span className={css.pvName}>{skill.name}</span>
          {builtin ? <span className={css.pvTag}>{t('builtin')}</span> : null}
        </span>
        <span className={css.pvDesc}>{skill.description}</span>
        <span className={css.pvSub}>{skill.provider}</span>
      </button>
      <div className={css.pvFoot}>
        <button type="button" className={css.iconButton} onClick={onOpen} aria-label={t('viewDetail')} title={t('viewDetail')}>
          <IconBrowseOutline16 size={16} />
        </button>
        {!builtin ? (
          <button type="button" className={`${css.iconButton} ${css.iconDanger}`} onClick={onDelete} aria-label={t('delete')} title={t('delete')}>
            <IconTrashOutline16 size={16} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Second-step modal confirming a destructive skill delete. */
function DeleteSkillConfirm({ name, onCancel, onConfirm, t }: {
  name: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('delete')}
      description={`${t('confirmDelete')}「${name}」？`}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('delete')}</Button>
        </>
      )}
    />
  )
}

/** Human label for one tool's channel pill. */
function toolTag(tool: CatalogToolRow, t: (key: CapabilityCatalogKey) => string): string {
  if (tool.channel === 'mcp') return tool.serverName !== undefined ? `MCP · ${tool.serverName}` : 'MCP'
  if (tool.channel === 'plugin') return t('toolPlugin')
  if (tool.channel === 'builtin') return t('toolBuiltin')
  return tool.channel
}

/** Origin / ownership subtitle for a tool card. */
function toolOrigin(tool: CatalogToolRow, t: (key: CapabilityCatalogKey) => string): string {
  if (tool.channel === 'mcp') return tool.serverName ?? 'MCP'
  if (tool.channel === 'plugin') return tool.owner ?? t('toolPlugin')
  return t('toolBuiltin')
}

/** Pretty-print a tool's parameter JSON (or a no-params hint). */
function formatParams(parameters: CatalogToolRow['parameters'], t: (key: CapabilityCatalogKey) => string): string {
  if (parameters === undefined || parameters === null) return t('toolNoParams')
  if (typeof parameters !== 'object') return String(parameters)
  if (Array.isArray(parameters)) return parameters.length === 0 ? t('toolNoParams') : JSON.stringify(parameters, null, 2)
  if (Object.keys(parameters).length === 0) return t('toolNoParams')
  try {
    return JSON.stringify(parameters, null, 2)
  } catch {
    return t('toolNoParams')
  }
}

/** The candidate child schema for a property (array items object, or object with
 * properties) — used to render an expandable nested table. */
function nestedSchemaOf(schema: CatalogJsonValue): CatalogJsonValue | undefined {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return undefined
  const s = schema as Record<string, unknown>
  if (s['type'] === 'array') {
    const items = s['items']
    if (items !== null && typeof items === 'object' && typeof (items as Record<string, unknown>)['properties'] === 'object') {
      return items as CatalogJsonValue
    }
    return undefined
  }
  if (typeof s['properties'] === 'object' && s['properties'] !== null) return schema
  return undefined
}

/** The property entries of an object schema (or null when not tabular). */
function schemaProps(schema: CatalogJsonValue): [string, Record<string, unknown>][] | null {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return null
  const props = (schema as Record<string, unknown>)['properties']
  if (typeof props !== 'object' || props === null) return null
  const entries = Object.entries(props) as [string, Record<string, unknown>][]
  return entries.length > 0 ? entries : null
}

/** The required-name set of an object schema. */
function requiredNames(schema: CatalogJsonValue): Set<string> {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return new Set()
  const required = (schema as Record<string, unknown>)['required']
  return new Set<string>(Array.isArray(required) ? (required as string[]) : [])
}

/** A compact type label (array<itemType> / object / string / …). */
function typeLabel(schema: Record<string, unknown>): string {
  const t = schema['type']
  if (Array.isArray(t)) return (t as string[]).join('|')
  if (t === 'array') {
    const items = schema['items']
    if (items !== null && typeof items === 'object') {
      const it = (items as Record<string, unknown>)['type']
      if (typeof it === 'string') return `array<${it}>`
      if (typeof (items as Record<string, unknown>)['properties'] === 'object') return 'array<object>'
    }
    return 'array'
  }
  if (t === undefined && typeof schema['properties'] === 'object') return 'object'
  return typeof t === 'string' ? t : ''
}

/** Recursive rows for one schema level. Emits flat `<tr>`s so nested object /
 * array-of-object properties stay in the SAME table (no nested-table alignment
 * issues), indented by depth; a chevron expands a nested level. */
function ParamRows({ schema, path, expanded, onToggle, depth, t }: {
  schema: CatalogJsonValue
  path: string
  expanded: ReadonlySet<string>
  onToggle: (key: string) => void
  depth: number
  t: (key: CapabilityCatalogKey) => string
}): ReactNode {
  const props = schemaProps(schema)
  if (props === null) return null
  const required = requiredNames(schema)
  return (
    <>
      {props.map(([name, p]) => {
        const key = path === '' ? name : `${path}.${name}`
        const nested = nestedSchemaOf(p as CatalogJsonValue)
        const open = expanded.has(key)
        return (
          <Fragment key={key}>
            <tr className={depth > 0 ? css.toolParamsNestedRow : undefined}>
              <td className={css.toolParamsName} style={{ paddingLeft: `${8 + depth * 18}px` }}>
                {nested !== undefined ? (
                  <button type="button" className={css.toolParamsExpand} onClick={() => onToggle(key)} aria-expanded={open}>
                    {open ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
                  </button>
                ) : null}
                <span>{name}</span>
              </td>
              <td className={css.toolParamsType}>{typeLabel(p)}</td>
              <td className={css.toolParamsDesc}>{typeof p['description'] === 'string' ? p['description'] : '—'}</td>
              <td className={css.toolParamsReq}>{required.has(name) ? t('yes') : ''}</td>
            </tr>
            {nested !== undefined && open ? (
              <ParamRows schema={nested} path={key} expanded={expanded} onToggle={onToggle} depth={depth + 1} t={t} />
            ) : null}
          </Fragment>
        )
      })}
    </>
  )
}

/** The wrap table for one schema level (header + recursive rows). */
function ParamTable({ schema, path, expanded, onToggle, depth, t }: {
  schema: CatalogJsonValue
  path: string
  expanded: ReadonlySet<string>
  onToggle: (key: string) => void
  depth: number
  t: (key: CapabilityCatalogKey) => string
}) {
  if (schemaProps(schema) === null) return <div className={css.empty}>{t('toolNoParams')}</div>
  return (
    <table className={css.toolParamsTable}>
      <thead>
        <tr>
          <th className={css.toolParamsName}>{t('paramName')}</th>
          <th className={css.toolParamsType}>{t('paramType')}</th>
          <th>{t('paramDesc')}</th>
          <th className={css.toolParamsReq}>{t('paramRequired')}</th>
        </tr>
      </thead>
      <tbody>
        <ParamRows schema={schema} path={path} expanded={expanded} onToggle={onToggle} depth={depth} t={t} />
      </tbody>
    </table>
  )
}

/** Reusable parameter view: a recursive table with a 表格/JSON toggle and a
 * one-click 复制 JSON, falling back to the raw JSON block when the schema is not
 * tabular. Used by the tool detail modal and the MCP tool rows' schema. */
function SchemaView({ parameters, title, compact, t }: {
  parameters: CatalogJsonValue | undefined
  title?: string
  compact?: boolean
  t: (key: CapabilityCatalogKey) => string
}) {
  const hasTable = parameters !== undefined && parameters !== null && schemaProps(parameters) !== null
  const [view, setView] = useState<'table' | 'json'>('table')
  const [copied, setCopied] = useState(false)
  const [expandedParams, setExpandedParams] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => { if (!hasTable) setView('json') }, [hasTable])
  const toggleParam = (key: string): void => {
    setExpandedParams((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const paramsJson = useMemo(() => formatParams(parameters, t), [parameters, t])
  const copyJson = async (): Promise<void> => {
    if (parameters === undefined || parameters === null) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(parameters, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard may be blocked */ }
  }
  return (
    <div>
      <div className={compact ? (css.toolParamsHeadCompact ?? '') : css.toolParamsHead}>
        {title !== undefined ? <span className={css.toolDetailParamsTitle}>{title}</span> : <span />}
        <span className={css.toolParamsActions}>
          {hasTable ? (
            <span className={css.toolParamsTabs}>
              <button type="button" className={css.toolParamsTab} data-active={view === 'table'} onClick={() => setView('table')}>{t('paramsTable')}</button>
              <button type="button" className={css.toolParamsTab} data-active={view === 'json'} onClick={() => setView('json')}>{t('paramsJson')}</button>
            </span>
          ) : null}
          <button
            type="button"
            className={css.toolCopyBtn}
            disabled={parameters === undefined || parameters === null}
            onClick={() => void copyJson()}
          >{copied ? t('copied') : t('copyJson')}</button>
        </span>
      </div>
      {parameters === undefined || parameters === null ? (
        <div className={css.toolParamsEmpty}>{t('toolNoParams')}</div>
      ) : hasTable && view === 'table' ? (
        <div className={css.toolParamsTableWrap}>
          <ParamTable schema={parameters} path="" expanded={expandedParams} onToggle={toggleParam} depth={0} t={t} />
        </div>
      ) : (
        <div className={css.toolParamsBody}>{paramsJson}</div>
      )}
    </div>
  )
}

/** Tool preview card — same anatomy as the skill cards (shared .pvCard / .grid),
 * so tools and skills carry ONE style that can be optimized together. */
function ToolCard({ tool, onOpen, t }: { tool: CatalogToolRow; onOpen: () => void; t: (key: CapabilityCatalogKey) => string }) {
  return (
    <div className={css.pvCard}>
      <button type="button" className={css.pvMain} onClick={onOpen}>
        <span className={css.pvHead}>
          <span className={css.pvName}>{tool.name}</span>
          <span className={`${css.pvTag} ${tool.channel === 'mcp' ? css.tagMcp : tool.channel === 'plugin' ? css.tagPlugin : ''}`}>{toolTag(tool, t)}</span>
        </span>
        <span className={css.pvDesc}>{tool.description}</span>
        <span className={css.pvSub}>{toolOrigin(tool, t)}</span>
      </button>
      <div className={css.pvFoot}>
        <button type="button" className={css.iconButton} onClick={onOpen} aria-label={t('viewDetail')} title={t('viewDetail')}>
          <IconBrowseOutline16 size={16} />
        </button>
      </div>
    </div>
  )
}

/** The tools tab's card views following the segment filter. `all` renders both the
 * builtin/plugin tool cards AND the MCP server cards in ONE grid (so the 16px gap
 * stays uniform across them); the other segments render one set. */
function ToolCards({ loading, visibleTools, mcpGroups, segment, onOpenTool, onOpenServer, onSetEnabled, onRemove, resetFilter, t }: {
  loading: boolean
  visibleTools: readonly CatalogToolRow[]
  mcpGroups: readonly McpGroup[]
  segment: ToolSegment
  onOpenTool: (tool: CatalogToolRow) => void
  onOpenServer: (name: string) => void
  onSetEnabled: (serverName: string, enabled: boolean) => Promise<void>
  onRemove: (serverName: string) => Promise<void>
  resetFilter: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  if (loading) return null
  const showsToolCards = segment !== 'mcp'
  const showsMcpServers = segment !== 'builtin' && segment !== 'plugin'
  const total = (showsToolCards ? visibleTools.length : 0) + (showsMcpServers ? mcpGroups.length : 0)
  if (total === 0) {
    return segment === 'mcp'
      ? <div className={css.empty}>{t('mcpServerEmpty')}</div>
      : <div className={css.empty}>{t('toolNoMatch')} <button type="button" className={css.ghostLink} onClick={resetFilter}>{t('filterAll')}</button></div>
  }
  return (
    <div className={css.grid}>
      {showsToolCards ? visibleTools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} onOpen={() => onOpenTool(tool)} t={t} />
      )) : null}
      {showsMcpServers ? mcpGroups.map((g) => (
        <McpCard key={g.serverName} group={g} onOpen={() => onOpenServer(g.serverName)} onSetEnabled={onSetEnabled} onRemove={onRemove} t={t} />
      )) : null}
    </div>
  )
}

/** Tool detail modal (host Modal, wider): description (clamped when it overflows,
 * expandable) + channel/origin + parameter schema. No footer button — the ×,
 * Esc, and mask-click close it. */
function ToolDetailModal({ tool, onClose, t }: { tool: CatalogToolRow; onClose: () => void; t: (key: CapabilityCatalogKey) => string }) {
  const [descExpanded, setDescExpanded] = useState(false)
  // Show the expand toggle only when the description actually overflows the clamp.
  const descRef = useRef<HTMLParagraphElement>(null)
  const [descOverflow, setDescOverflow] = useState(false)
  useEffect(() => {
    const el = descRef.current
    if (el === null) { setDescOverflow(false); return }
    setDescOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [tool.description])
  // Esc + mask-click close (the shared .overlay/.modal chrome has no host-Modal
  // behavior).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={css.overlay} role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={css.modal}>
        <div className={css.modalHead}>
          <h3 className={css.modalTitle}>{tool.name}</h3>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('detailClose')}>×</button>
        </div>
        <div className={css.modalBody}>
          <div className={css.meta}>
            <span className={css.metaItem}><span className={css.metaKey}>{t('source')}</span><span className={css.metaVal}>{toolTag(tool, t)}</span></span>
            <span className={css.metaItem}><span className={css.metaKey}>{t('provider')}</span><span className={css.metaVal}>{toolOrigin(tool, t)}</span></span>
          </div>
          <div className={css.toolDetailDesc}>
            <p ref={descRef} className={`${css.toolDesc ?? ''} ${descExpanded ? (css.toolDescExpanded ?? '') : (css.toolDescClamp ?? '')}`}>{tool.description}</p>
            {descOverflow ? (
              <button type="button" className={css.toolDescToggle ?? ''} onClick={() => setDescExpanded(e => !e)}>
                {descExpanded ? t('toolCollapse') : t('toolExpand')}
              </button>
            ) : null}
          </div>
          <SchemaView parameters={tool.parameters as CatalogJsonValue | undefined} title={t('toolParams')} t={t} />
        </div>
      </div>
    </div>
  )
}

/** Centered modal with a skill's full detail, source browser, metadata and credential config. */
function SkillDetailModal({ name, claim, onClose, setCredential, readSkillFile, t }: {
  name: string
  claim: DetailClaim
  onClose: () => void
  setCredential: (key: string, value: string) => Promise<boolean>
  readSkillFile: (name: string, path: string) => Promise<CatalogSkillFileRead | undefined>
  t: (key: CapabilityCatalogKey) => string
}) {
  const [credValues, setCredValues] = useState<Record<string, string>>({})
  const [credState, setCredState] = useState<Record<string, 'idle' | 'saving' | 'ok' | 'fail'>>({})
  const [copied, setCopied] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(true)
  const data = claim.data
  // Source browser: the selected bundle file and its content (right pane).
  const [srcFile, setSrcFile] = useState('')
  const [srcContent, setSrcContent] = useState<string | undefined>(undefined)
  const [srcLoading, setSrcLoading] = useState(false)

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
    <div className={css.overlay} role="dialog" aria-modal="true">
      <div className={css.modal}>
        <div className={css.modalHead}>
          <h3 className={css.modalTitle}>{name}</h3>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('detailClose')}>×</button>
        </div>

        <div className={css.modalBody}>
          {claim.status === 'loading' ? <div className={css.empty}>{t('loading')}</div> : null}
          {claim.status === 'done' && data === undefined ? <div className={css.empty}>{t('loadFailed')}</div> : null}

          {claim.status === 'done' && data !== undefined ? (
            <>
              <div className={css.meta}>
                <span className={css.metaItem}><span className={css.metaKey}>{t('source')}</span><span className={css.metaVal}>{data.source}</span></span>
                <span className={css.metaItem}><span className={css.metaKey}>{t('provider')}</span><span className={css.metaVal}>{data.provider}</span></span>
                <span className={css.metaItem}><span className={css.metaKey}>{t('modelInvocable')}</span><span className={css.metaVal}>{data.modelInvocable ? t('yes') : t('no')}</span></span>
                {data.whenToUse !== undefined ? <span className={css.metaItem}><span className={css.metaKey}>{t('whenToUse')}</span><span className={css.metaVal}>{data.whenToUse}</span></span> : null}
              </div>
              <p className={css.detailDesc}>{data.description}</p>

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
                      <div className={css.credRow} key={key}>
                        <label className={css.credLabel}>{label}
                          {configured ? <span className={`${css.badge} ${css.badgeOk}`}>{t('configured')}</span> : <span className={css.badge}>{t('notConfigured')}</span>}
                        </label>
                        <div className={css.credInputRow}>
                          <div className={css.inputWrap}>
                            <input className={css.input} type="password" value={credValues[key] ?? ''}
                              placeholder={configured ? t('configuredReplace') : t('credPlaceholder')}
                              onChange={(e) => setCredValues((s) => ({ ...s, [key]: e.target.value }))}
                              onBlur={() => { if ((credValues[key] ?? '') !== '') void saveCred(key) }}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveCred(key) }} />
                          </div>
                          {!configured ? (
                            <button type="button" className={css.btnPrimary} disabled={state === 'saving' || (credValues[key] ?? '') === ''}
                              onClick={() => void saveCred(key)}>{t('save')}</button>
                          ) : null}
                        </div>
                        {state === 'ok' ? <div className={css.credOk}>{t('saved')}</div> : null}
                        {state === 'fail' ? <div className={css.credFail}>{t('saveFailed')}</div> : null}
                      </div>
                    )
                  })}
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

              {data.metadataText !== undefined ? (
                <details className={css.source}>
                  <summary className={css.sourceTitle}>{t('metadata')}</summary>
                  <pre className={css.codeBlk}>{formatMetadata(data.metadataText)}</pre>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Add-skill modal: file upload (drag-drop), clone-from-source, or local dir. */
function AddSkillModal({ onClose, addSkill, listDirSkills, pickDirectory, refresh, t }: {
  onClose: () => void
  addSkill: (request: CatalogAddSkillRequest) => Promise<{ ok: boolean; error?: string; name?: string; exists?: boolean }>
  listDirSkills: (dirPath: string) => Promise<readonly CatalogDirSkillInfo[]>
  pickDirectory: () => Promise<string | null>
  refresh: () => Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  const [tab, setTab] = useState<'upload' | 'command' | 'localdir'>('upload')
  const [zipBase64, setZipBase64] = useState<string | null>(null)
  const [zipName, setZipName] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [command, setCommand] = useState('')
  const [dir, setDir] = useState('')
  const [dirSkills, setDirSkills] = useState<readonly CatalogDirSkillInfo[]>([])
  const [selectedSkills, setSelectedSkills] = useState<readonly string[]>([])
  const [modelInvocable, setModelInvocable] = useState(true)
  const [root, setRoot] = useState<'user' | 'project'>('user')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirm, setConfirm] = useState<{ name: string; req: CatalogAddSkillRequest } | null>(null)

  const rootPath = root === 'user' ? t('rootUserPath') : t('rootProjectPath')
  const canSubmit = tab === 'upload' ? zipBase64 !== null : tab === 'command' ? command.trim() !== '' : dir !== '' && dirSkills.length > 0 && selectedSkills.length > 0

  // Tabs are independent: switching clears the previous tab's message so a
  // warning on one tab never bleeds into another.
  const switchTab = (next: 'upload' | 'command' | 'localdir'): void => {
    setTab(next)
    setMsg(null)
  }

  // One picker: open the host's native directory chooser, then auto-parse the
  // chosen directory for skills (list, or report none found).
  const browseDir = async (): Promise<void> => {
    setMsg(null)
    const path = await pickDirectory()
    if (path === null || path === '') return
    setDir(path)
    const skills = await listDirSkills(path)
    setDirSkills(skills)
    setSelectedSkills(skills.map(s => s.name))
    if (skills.length === 0) setMsg({ ok: false, text: t('noSkillsFound') })
  }

  const toggleSkill = (name: string): void => {
    setSelectedSkills(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  const readFile = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => setZipBase64(arrayBufferToBase64(reader.result as ArrayBuffer))
    reader.onerror = () => setMsg({ ok: false, text: t('readFailed') })
    reader.readAsArrayBuffer(file)
    setZipName(file.name)
  }
  const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file !== undefined) readFile(file)
  }
  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file !== undefined) readFile(file)
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit || busy) return
    setBusy(true)
    setMsg(null)
    const req = (() => {
      if (tab === 'upload') return { channel: 'zip' as const, payload: zipBase64 as string, modelInvocable, root }
      if (tab === 'command') return { channel: 'command' as const, payload: '', repo: command, modelInvocable, root }
      // From-directory: a `kind:'self'` entry is the picked dir itself (a single
      // skill bundle) and is installed with repo=<dir> and no `skills`. Child
      // entries are sub-dir skills of a container and go in `skills:[name]`.
      const selfNames = dirSkills.filter(s => s.kind === 'self').map(s => s.name)
      const childSkills = selectedSkills.filter(n => !selfNames.includes(n))
      const selfOnly = selfNames.some(n => selectedSkills.includes(n)) && childSkills.length === 0
      return selfOnly
        ? { channel: 'command' as const, payload: '', repo: dir, modelInvocable, root }
        : { channel: 'command' as const, payload: '', repo: dir, modelInvocable, root, ...(childSkills.length > 0 ? { skills: childSkills } : {}) }
    })()
    const res = await addSkill(req)
    if (res.ok) {
      await refresh()
      setMsg({ ok: true, text: `${t('addSuccess')}${res.name ?? ''}` })
    } else if (res.exists === true) {
      // Soft refusal: a same-name skill already lives in the target root. Offer overwrite.
      setConfirm({ name: res.name ?? '', req })
    } else {
      setMsg({ ok: false, text: res.error ?? t('addError') })
    }
    setBusy(false)
  }

  const overwrite = async (): Promise<void> => {
    if (confirm === null || busy) return
    const req = confirm.req
    setConfirm(null)
    setBusy(true)
    setMsg(null)
    const res = await addSkill({ ...req, overwrite: true })
    if (res.ok) {
      await refresh()
      setMsg({ ok: true, text: `${t('addSuccess')}${res.name ?? ''}` })
    } else {
      setMsg({ ok: false, text: res.error ?? t('addError') })
    }
    setBusy(false)
  }

  return (
    <>
    <div className={css.overlay} role="dialog" aria-modal="true">
      <div className={`${css.modal} ${css.addModal}`}>
        <div className={css.modalHead}>
          <h3 className={css.modalTitle}>{t('addSkill')}</h3>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('detailClose')}>×</button>
        </div>
        <div className={css.modalBody}>
          <div className={`${css.tabs} ${css.innerTabs}`} role="tablist">
            <button type="button" className={css.tab} data-active={tab === 'upload'} role="tab" onClick={() => switchTab('upload')}>{t('addTabUpload')}</button>
            <button type="button" className={css.tab} data-active={tab === 'command'} role="tab" onClick={() => switchTab('command')}>{t('addTabCommand')}</button>
            <button type="button" className={css.tab} data-active={tab === 'localdir'} role="tab" onClick={() => switchTab('localdir')}>{t('addTabDir')}</button>
          </div>

          <div className={css.addPanel}>
          {tab === 'upload' ? (
            <label
              className={`${css.dropzone} ${dragging ? css.dragging : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className={css.dropzoneIcon}><IconFolderOpenOutline16 size={28} /></span>
              <div className={css.dropTitle}>{t('dropTitle')}</div>
              <div className={css.dropHint}>{t('dropHint')}</div>
              <input type="file" accept=".zip,.md" className={css.fileInput} onChange={onFile} />
              {zipName !== '' ? <div className={css.fileName}>{zipName}</div> : null}
            </label>
          ) : null}

          {tab === 'command' ? (
            <div className={css.command}>
              <label className={css.fieldLabel}>{t('commandLabel')}</label>
              <input className={css.input} value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('commandPlaceholder')} spellCheck={false} />
              <p className={css.confHint}>{t('commandHint')}</p>
            </div>
          ) : null}

          {tab === 'localdir' ? (
            <div className={css.command}>
              <div className={css.dirHintRow}>
                <button type="button" className={css.btnGhost} onClick={() => void browseDir()}>{t('browseDir')}</button>
                <span className={css.dirHintInline}>{t('dirHint')}</span>
              </div>
              {dir !== '' ? <p className={css.dirPath}>{dir}</p> : null}
              {dirSkills.length > 0 ? (
                <div className={css.skillPick}>
                  <div className={css.fieldLabel}>{t('pickSkills')}</div>
                  {dirSkills.map((s) => (
                    <label className={css.pickRow} key={s.name}>
                      <span className={css.check}>
                        <input type="checkbox" checked={selectedSkills.includes(s.name)} onChange={() => toggleSkill(s.name)} />
                        <span className={css.checkMark} />
                      </span>
                      <div className={css.pickText}>
                        <div className={css.pickName}>{s.name}</div>
                        <div className={css.pickDesc}>{s.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <label className={css.switchRow}>
            <span className={css.enableLabel}>{t('addModelInvocable')}</span>
            <span className={css.switch}>
              <input type="checkbox" checked={modelInvocable} onChange={(e) => setModelInvocable(e.target.checked)} />
              <span className={css.track} />
              <span className={css.thumb} />
            </span>
          </label>

          <label className={css.rootRow}>
            <span className={css.enableLabel}>{t('addRoot')}</span>
            <select className={css.select} value={root} onChange={(e) => setRoot(e.target.value as 'user' | 'project')}>
              <option value="user">{t('rootUser')}</option>
              <option value="project">{t('rootProject')}</option>
            </select>
            <span className={css.fieldPath}>{rootPath}</span>
          </label>

          {msg !== null ? <div className={`${css.addMsg} ${msg.ok ? css.addMsgOk : css.addMsgErr}`}>{msg.text}</div> : null}
          </div>

          <div className={css.actions}>
            <button type="button" className={css.btnGhost} onClick={onClose}>{t('cancel')}</button>
            <span className={css.spacer} />
            <button type="button" className={css.btnPrimary} disabled={!canSubmit || busy} onClick={() => void submit()}>{t('addSubmit')}</button>
          </div>
        </div>
      </div>
    </div>
    {confirm !== null ? (
      <Modal
        open
        onClose={() => setConfirm(null)}
        title={t('addExistsTitle')}
        description={`「${confirm.name}」${t('addExists')}`}
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void overwrite()}>{t('replace')}</Button>
          </>
        )}
      />
    ) : null}
    </>
  )
}

/** Encode an ArrayBuffer to base64 (chunked to avoid stack overflow). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** Pretty-print a JSON metadata string for display. */
function formatMetadata(metadataText: string): string {
  try {
    return JSON.stringify(JSON.parse(metadataText), null, 2)
  } catch {
    return metadataText
  }
}

/* ---------------------------------------------------------------------------
   MCP management UI.
   --------------------------------------------------------------------------- */

/** One merged MCP server group shown in the MCP section. `managed` servers are
 * catalog-controlled (config + credentials + per-tool toggles); live-only ones
 * are read-only snapshots of already-registered MCP tools. */
interface McpGroup {
  readonly serverName: string
  readonly transport: McpTransport | undefined
  readonly enabled: boolean
  readonly managed: boolean
  readonly config: CatalogMcpServerConfig | undefined
  readonly tools: readonly CatalogMcpTool[]
  readonly liveTools: readonly CatalogToolRow[]
  readonly credentials: readonly CatalogMcpCredentialDecl[]
  readonly toolCount: number
}

/** Fold the tool-graph MCP entries + the catalog's managed servers into one
 * server-grouped list (catalog-managed wins over a same-name live group). */
function buildMcpGroups(
  snapshot: CapabilityCatalogSnapshot | undefined,
  mcps: CatalogMcpSnapshot | null,
  query: string,
): McpGroup[] {
  const q = query.trim().toLowerCase()
  const groups: McpGroup[] = []
  const seen = new Set<string>()

  for (const server of mcps?.servers ?? []) {
    if (q !== '' && !server.serverName.toLowerCase().includes(q)) continue
    const creds = (mcps?.credentials ?? []).filter((c) => c.ref.startsWith(`mcp.${server.serverName}.`))
    const tools = mcps?.tools[server.serverName] ?? []
    groups.push({
      serverName: server.serverName,
      transport: server.transport,
      enabled: server.enabled,
      managed: true,
      config: server,
      tools,
      liveTools: [],
      credentials: creds,
      toolCount: tools.length,
    })
    seen.add(server.serverName)
  }

  // Live-registered MCP tools (already in `ctx.tools`) folded by server. These
  // are not catalog-managed, so they are read-only in the section.
  const byServer = new Map<string, CatalogToolRow[]>()
  for (const tool of snapshot?.tools ?? []) {
    if (tool.channel !== 'mcp') continue
    const s = tool.serverName ?? 'MCP'
    const list = byServer.get(s)
    if (list !== undefined) list.push(tool)
    else byServer.set(s, [tool])
  }
  for (const [serverName, live] of byServer) {
    if (seen.has(serverName)) continue
    if (q !== '' && !serverName.toLowerCase().includes(q)) continue
    groups.push({
      serverName,
      transport: undefined,
      enabled: true,
      managed: false,
      config: undefined,
      tools: [],
      liveTools: live,
      credentials: [],
      toolCount: live.length,
    })
  }

  return groups.sort((a, b) => a.serverName.localeCompare(b.serverName))
}

/** Human label for a transport kind. */
function transportLabel(t: (key: CapabilityCatalogKey) => string, transport: McpTransport): string {
  if (transport === 'stdio') return 'stdio'
  if (transport === 'streamable-http') return 'streamable-http'
  return t('mcpUnknown')
}

/** Mask any `secretRef:` markers in a URL for read-only display. */
function maskUrl(url: string): string {
  return url.replace(new RegExp(`${SECRET_REF_PREFIX}[A-Za-z0-9_.-]+`, 'g'), '·secretRef·')
}

/** Read-only JSON view of a server config, with secret values masked. */
function configDisplay(config: CatalogMcpServerConfig): string {
  const env = (config.env ?? []).map(([k, v]) => [k, maskSecret(v)])
  const headers = (config.headers ?? []).map(([k, v]) => [k, maskSecret(v)])
  const url = config.url !== undefined ? maskUrl(config.url) : undefined
  const masked: Record<string, unknown> = {
    serverName: config.serverName,
    transport: config.transport,
    enabled: config.enabled,
    ...(config.command !== undefined ? { command: config.command } : {}),
    ...(config.args !== undefined ? { args: config.args } : {}),
    ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    ...(env.length > 0 ? { env } : {}),
  }
  return JSON.stringify(masked, null, 2)
}

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

/** One MCP server tile in the `mcp` segment: name + transport pill + tool count,
 * with an external enable switch (managed only) and a click-through to the
 * manage modal. Servers carry no description, so the body shows the tool count. */
function McpCard({ group, onOpen, onSetEnabled, onRemove, t }: {
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
            <IconBrowseOutline16 size={16} />
          </button>
          {group.managed ? (
            <button type="button" className={`${css.iconButton} ${css.iconDanger}`} onClick={() => void onRemove(group.serverName)} aria-label={t('mcpRemove')} title={t('mcpRemove')}>
              <IconTrashOutline16 size={16} />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  )
}

/** Manage-modal for one MCP server (opened from the tile): config JSON,
 * credential inputs, per-tool enable toggles, and discover. The inner view
 * deliberately differs from the builtin/plugin detail modal (desc/params only)
 * because MCP servers are configurable, not just inspectable. */
function McpServerManageModal({ group, discovering, onClose, onSetCredential, onSetToolEnabled, onDiscover, t }: {
  group: McpGroup
  discovering: boolean
  onClose: () => void
  onSetCredential: (ref: string, value: string) => Promise<boolean>
  onSetToolEnabled: (serverName: string, tool: string, enabled: boolean) => Promise<void>
  onDiscover: (serverName: string) => Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  const [credValues, setCredValues] = useState<Record<string, string>>({})
  const [credState, setCredState] = useState<Record<string, 'idle' | 'saving' | 'ok' | 'fail'>>({})
  const [schemaFor, setSchemaFor] = useState<string | null>(null)
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
    setSchemaFor(null)
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
    <Modal open onClose={onClose} title={group.serverName} className={css.toolDetailModal ?? ''}>
      <div className={css.mcpBody}>
        {group.managed && group.config !== undefined ? (
          <>
            <details className={css.mcpConfigDetails}>
              <summary className={css.mcpConfigSummary}>{t('mcpConfig')}</summary>
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
                    <div className={css.credRow} key={ref}>
                      <label className={css.credLabel}>{decl.label}
                        {decl.configured ? <span className={`${css.badge} ${css.badgeOk}`}>{t('configured')}</span> : <span className={css.badge}>{t('notConfigured')}</span>}
                      </label>
                      <div className={css.credInputRow}>
                        <div className={css.inputWrap}>
                          <input
                            className={css.input}
                            type="password"
                            value={credValues[ref] ?? ''}
                            placeholder={decl.configured ? t('configuredReplace') : t('credPlaceholder')}
                            onChange={(e) => setCredValues((s) => ({ ...s, [ref]: e.target.value }))}
                            onBlur={() => { if ((credValues[ref] ?? '') !== '') void saveCred(ref) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveCred(ref) }}
                          />
                        </div>
                        {!decl.configured ? (
                          <button
                            type="button"
                            className={css.btnPrimary}
                            disabled={state === 'saving' || (credValues[ref] ?? '') === ''}
                            onClick={() => void saveCred(ref)}
                          >{t('save')}</button>
                        ) : null}
                      </div>
                      {state === 'ok' ? <div className={css.credOk}>{t('saved')}</div> : null}
                      {state === 'fail' ? <div className={css.credFail}>{t('saveFailed')}</div> : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={css.confHint}>{t('mcpNoCreds')}</div>
            )}
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
                <span className={css.searchIcon}><IconSearchOutline16 size={14} /></span>
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
                  schemaFor={schemaFor}
                  setSchemaFor={setSchemaFor}
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
    </Modal>
  )
}

/** One tool row inside a MCP server group: name/desc (click to toggle schema) +
 * a per-tool enable switch (managed servers only). */
function McpToolRow({ tool, managed, serverName, schemaFor, setSchemaFor, onSetToolEnabled, t }: {
  tool: CatalogMcpTool | CatalogToolRow
  managed: boolean
  serverName: string
  schemaFor: string | null
  setSchemaFor: (name: string | null) => void
  onSetToolEnabled: ((serverName: string, tool: string, enabled: boolean) => Promise<void>) | undefined
  t: (key: CapabilityCatalogKey) => string
}) {
  const isMcp = managed && 'enabled' in tool
  const enabled = isMcp ? (tool as CatalogMcpTool).enabled : true
  const open = schemaFor === tool.name
  return (
    <div key={tool.name} className={css.mcpToolCard}>
      <div className={css.mcpToolRow}>
        <button type="button" className={css.mcpToolMain} onClick={() => setSchemaFor(open ? null : tool.name)} aria-expanded={open}>
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
      {open ? (
        <div className={css.mcpToolSchemaBody}>
          <SchemaView parameters={tool.parameters as CatalogJsonValue | undefined} compact t={t} />
        </div>
      ) : null}
    </div>
  )
}

/** Add-MCP dialog: paste a server config → parse it into a server card →
 * configure credentials + enable → add. One server per add. */
function AddMcpDialog({ onClose, mcpAdd, mcpSetCredential, mcpDiscover, refreshMcp, t }: {
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
    <div className={css.overlay} role="dialog" aria-modal="true">
      <div className={`${css.modal} ${css.addModal}`}>
        <div className={css.modalHead}>
          <h3 className={css.modalTitle}>{t('mcpAddTitled')}</h3>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('detailClose')}>×</button>
        </div>
        <div className={css.modalBody}>
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
        </div>
      </div>
    </div>
  )
}

/** One node of the bundle file tree. */
interface BundleNode {
  name: string
  path: string
  children: BundleNode[]
  isDir: boolean
}

/** Build a directory trie from flat bundle-relative paths. */
function buildBundleTree(files: readonly string[]): BundleNode[] {
  const roots: BundleNode[] = []
  for (const file of files) {
    const segments = file.split('/').filter(s => s !== '')
    let level = roots
    let acc = ''
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg === undefined) continue
      acc = acc === '' ? seg : `${acc}/${seg}`
      const last = i === segments.length - 1
      let node = level.find(n => n.name === seg)
      if (node === undefined) {
        node = { name: seg, path: acc, children: [], isDir: !last }
        level.push(node)
      }
      level = node.children
    }
  }
  return [...roots].sort((a, b) => {
    const aDir = a.isDir ? 0 : 1
    const bDir = b.isDir ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    return a.name.localeCompare(b.name)
  })
}

/** A neutral document glyph for file rows (folded-corner page). */
function BundleFileGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
      <path d="M9 1.5V5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

/** Skill-bundle file tree (IDE-explorer anatomy: chevron, folder, indent). */
function BundleFileTree({ files, selectedPath, onSelect }: {
  files: readonly string[]
  selectedPath: string
  onSelect: (path: string) => void
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const all = new Set<string>()
    const walk = (nodes: BundleNode[]): void => {
      for (const node of nodes) {
        if (node.isDir) {
          all.add(node.path)
          walk(node.children)
        }
      }
    }
    walk(buildBundleTree(files))
    return all
  })
  const roots = useMemo(() => buildBundleTree(files), [files])

  const toggle = (path: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNode = (node: BundleNode, depth: number): ReactNode => {
    const indent = { paddingLeft: `${depth * 16 + 4}px` }
    if (node.isDir) {
      const open = expanded.has(node.path)
      return (
        <div key={node.path}>
          <button type="button" className={css.treeRow} style={indent} onClick={() => toggle(node.path)}>
            <span className={css.treeChevron}>{open ? <IconChevronDownOutline14 size={16} /> : <IconChevronRightOutline14 size={16} />}</span>
            {open ? <IconFolderOpen16 /> : <IconFolderClose16 />}
            <span className={css.treeName}>{node.name}</span>
          </button>
          {open && node.children.length > 0 ? (
            <div>{node.children.map(child => renderNode(child, depth + 1))}</div>
          ) : null}
        </div>
      )
    }
    const selected = selectedPath === node.path
    return (
      <button
        type="button"
        className={`${css.treeRow} ${css.treeFile} ${selected ? css.treeSelected : ''}`}
        style={indent}
        key={node.path}
        onClick={() => onSelect(node.path)}
      >
        <span className={css.treeGlyph}><BundleFileGlyph /></span>
        <span className={css.treeName}>{node.name}</span>
      </button>
    )
  }

  return (
    <div className={css.tree}>
      {roots.map(node => renderNode(node, 0))}
    </div>
  )
}
