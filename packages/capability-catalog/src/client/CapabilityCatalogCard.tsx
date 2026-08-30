/**
 * Capability-catalog settings section (工具与技能): a standalone nav tab.
 * Owns the section state and Remote wiring; visual cards and dialogs live in
 * focused client modules alongside this shell.
 */
import { useEffect, useMemo, useState } from 'react'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogMcpSnapshot, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
import type { CapabilityCatalogKey } from './locales.ts'
import type { CapabilityCatalogCardProps } from './slots.ts'
import { SkillPreviewCard, DeleteSkillConfirm } from './SkillCards.tsx'
import { ToolCards, type ToolSegment } from './ToolCards.tsx'
import { ToolDetailModal } from './ToolDetailModal.tsx'
import { ModalShell } from './ModalShell.tsx'
import { SkillDetailModal, type DetailClaim } from './SkillDetailModal.tsx'
import { AddSkillModal } from './AddSkillModal.tsx'
import { McpServerManageModal } from './McpServerManageModal.tsx'
import { AddMcpDialog } from './AddMcpDialog.tsx'
import { buildMcpGroups } from './mcp-model.ts'
import css from './CapabilityCatalogCard.module.css'

type Kind = 'skills' | 'tools'
type SortBy = 'name' | 'updated'
/** Skills-tab segment: builtin=bundled, plugin=runtime, other=project/user/custom. */
type SkillSegment = 'all' | 'builtin' | 'plugin' | 'other'
/** Bucket a skill source into a segment (bundled→内置, runtime→插件, else→其他). */
const skillBucket = (source: string): SkillSegment =>
  source === 'bundled' ? 'builtin' : source === 'runtime' ? 'plugin' : 'other'

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
  // Skill grid segment (builtin=bundled / plugin=runtime / other=project+user+custom).
  const [skillSegment, setSkillSegment] = useState<SkillSegment>('all')
  // Tool detail (click a tool card to view its full detail).
  const [toolDetail, setToolDetail] = useState<CatalogToolRow | null>(null)
  // MCP management state: the snapshot, the open add-dialog, expanded servers,
  // and the set currently mid-discover.
  const [mcps, setMcps] = useState<CatalogMcpSnapshot | null>(null)
  const [mcpDetailName, setMcpDetailName] = useState<string | null>(null)
  const [discoveringMcp, setDiscoveringMcp] = useState<ReadonlySet<string>>(() => new Set())
  // Tool-origin guidance modal ("why is my plugin tool not here").
  const [toolOriginHelp, setToolOriginHelp] = useState(false)

  const skills = snapshot?.skills ?? []
  const tools = snapshot?.tools ?? []
  const loading = snapshot == null

  /** Re-fetch the catalog + MCP snapshots after any MCP mutation. MCP
   * add/remove/enable/discover changes which `mcp__` tools are registered on the
   * host tool registry, so the catalog grid must refresh too — not just the MCP
   * store — or a removed server's tools linger until a manual page refresh. */
  const refreshMcp = async (): Promise<void> => {
    await Promise.all([
      refresh(),
      mcpSnapshot().then(setMcps),
    ])
  }
  useEffect(() => { void refreshMcp() }, [])

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = skills.filter((s) =>
      (q === '' || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      && (skillSegment === 'all' || skillBucket(s.source) === skillSegment))
    const sorted = [...matched]
    if (sortBy === 'updated') sorted.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    else sorted.sort((a, b) => a.name.localeCompare(b.name))
    return sorted
  }, [skills, query, skillSegment, sortBy])

  /** Per-segment counts for the skills grid. */
  const skillBuiltinCount = useMemo(() => skills.filter((s) => skillBucket(s.source) === 'builtin').length, [skills])
  const skillPluginCount = useMemo(() => skills.filter((s) => skillBucket(s.source) === 'plugin').length, [skills])
  const skillOtherCount = useMemo(() => skills.filter((s) => skillBucket(s.source) === 'other').length, [skills])

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
        <>
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
          <SegmentBar
            segments={[
              { id: 'all', label: t('filterAll'), count: skills.length },
              { id: 'builtin', label: t('builtin'), count: skillBuiltinCount },
              { id: 'plugin', label: t('toolPlugin'), count: skillPluginCount },
              { id: 'other', label: t('skillOther'), count: skillOtherCount },
            ]}
            active={skillSegment}
            onSelect={(id) => setSkillSegment(id as SkillSegment)}
            t={t}
          />
        </>
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
          <SegmentBar
            segments={[
              { id: 'all', label: t('filterAll'), count: tools.length },
              { id: 'builtin', label: t('toolBuiltin'), count: builtinCount },
              { id: 'plugin', label: t('toolPlugin'), count: pluginCount },
              { id: 'mcp', label: t('toolOther'), count: mcpGroups.length },
            ]}
            active={toolSegment}
            onSelect={(id) => setToolSegment(id as ToolSegment)}
            t={t}
          />
          {toolSegment === 'plugin' ? (
            <button type="button" className={css.guideLink} onClick={() => setToolOriginHelp(true)}>
              {t('toolOriginGuideLink')}
            </button>
          ) : null}
        </>
      ) : null}

      {loading ? <div className={css.empty}>{t('loading')}</div> : null}
      {!loading && kind === 'skills' && skills.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}
      {!loading && kind === 'tools' && tools.length === 0 ? <div className={css.empty}>{t('toolNoMatch')}</div> : null}

      {!loading && kind === 'skills' && skills.length > 0 ? (
        visibleSkills.length === 0
          ? <div className={css.empty}>{t('noFilterMatch')}</div>
          : (
            <div className={css.grid}>
              {visibleSkills.map((skill) => (
                <SkillPreviewCard
                  key={skill.name}
                  skill={skill}
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
          t={t}
        />
      ) : null}

      {mcpDetail !== null ? (
        <McpServerManageModal
          group={mcpDetail}
          discovering={discoveringMcp.has(mcpDetail.serverName)}
          onClose={() => setMcpDetailName(null)}
          onSetCredential={mcpSetCredential}
          onSetToolEnabled={setMcpToolEnabled}
          onDiscover={discoverMcp}
          onOpenTool={(tool) => setToolDetail(tool)}
          t={t}
        />
      ) : null}

      {/* Renders AFTER the manage modal so a stacked tool detail lands on top. */}
      {toolDetail !== null ? (
        <ToolDetailModal tool={toolDetail} onClose={() => setToolDetail(null)} t={t} />
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

      {toolOriginHelp ? <ToolOriginGuideModal onClose={() => setToolOriginHelp(false)} t={t} /> : null}
    </div>
  )
}

/** Shared segment filter bar (tools + skills tabs): a labelled group of pill
 * buttons each with a count, one active. One style, one markup. */
interface SegmentDef { readonly id: string; readonly label: string; readonly count: number }
function SegmentBar({ segments, active, onSelect, t }: {
  segments: readonly SegmentDef[]
  active: string
  onSelect: (id: string) => void
  t: (key: CapabilityCatalogKey) => string
}) {
  return (
    <div className={css.segBar} role="group" aria-label={t('source')}>
      {segments.map((s) => (
        <button key={s.id} type="button" className={css.segBtn} data-active={active === s.id} onClick={() => onSelect(s.id)}>
          {s.label}<span className={css.tabCnt}>{s.count}</span>
        </button>
      ))}
    </div>
  )
}

/** Tool-origin guidance modal: explains why a plugin tool may show as builtin and
 * copies a ready-to-send instruction (referencing the convention doc) for the
 * user's agent to read and apply. */
function ToolOriginGuideModal({ onClose, t }: { onClose: () => void; t: (key: CapabilityCatalogKey) => string }) {
  const [copied, setCopied] = useState(false)
  const copyDoc = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(t('toolOriginGuideCopy'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard may be blocked */ }
  }
  return (
    <ModalShell title={t('toolOriginGuideTitle')} onClose={onClose} t={t}>
      <div className={css.confHint}>{t('toolOriginGuideIntro')}</div>
      <div className={css.guideDocRow}>
        <code className={css.guideDocPath}>{t('toolOriginGuideCopy')}</code>
        <button type="button" className={css.btnPrimary} onClick={() => void copyDoc()}>
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <div className={css.confHint}>{t('toolOriginGuideFooter')}</div>
    </ModalShell>
  )
}
