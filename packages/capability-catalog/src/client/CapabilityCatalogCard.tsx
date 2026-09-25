/**
 * Capability-catalog settings section (工具与技能): a standalone nav tab.
 * Owns the section state and Remote wiring; visual cards and dialogs live in
 * focused client modules alongside this shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconSearchOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogMcpSnapshot, CatalogModeFace, CatalogPresetOption, CatalogPresetScopeStatus, CatalogSkillRow, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
import type { CapabilityCatalogKey } from './locales.ts'
import type { CapabilityCatalogCardProps } from './slots.ts'
import { SkillPreviewCard, DeleteSkillConfirm } from './SkillCards.tsx'
import { ToolCards, type ToolSegment } from './ToolCards.tsx'
import { ToolDetailModal } from './ToolDetailModal.tsx'
import { ModalShell } from './ModalShell.tsx'
import { SkillDetailModal, type DetailClaim, type ScopeEditor } from './SkillDetailModal.tsx'
import { AddSkillModal } from './AddSkillModal.tsx'
import { McpServerManageModal } from './McpServerManageModal.tsx'
import { AddMcpDialog } from './AddMcpDialog.tsx'
import { buildMcpGroups } from './mcp-model.ts'
import { buildModeComparison, orphanManagedSkills, resolveModeChips, type CatalogModeChip, type ModeComparison, type OrphanManagedSkill } from './mode-model.ts'
import { presetName } from './preset-display.ts'
import css from './CapabilityCatalogCard.module.css'

type Kind = 'skills' | 'tools'
type SortBy = 'name' | 'updated'
/** Skills-tab segment: builtin=bundled, plugin=runtime, other=project/user/custom. */
type SkillSegment = 'all' | 'builtin' | 'plugin' | 'other'
/** The mode control's value for the cross-mode comparison: never a preset id. */
const MODE_COMPARE = '\u0000compare'
/** The mode the grid shows: one preset's face, or every preset compared. */
type ModeSelection = { readonly kind: 'preset'; readonly id: string } | { readonly kind: 'compare' }
/** Bucket a skill source into a segment (bundled→内置, runtime→插件, else→其他). */
const skillBucket = (source: string): SkillSegment =>
  source === 'bundled' ? 'builtin' : source === 'runtime' ? 'plugin' : 'other'

export function CapabilityCatalogCard({
  useCatalog, detail, readSkillFile, listDirSkills, pickDirectory, setCredential, addSkill, deleteSkill, refresh, refreshSettled,
  mcpSnapshot, mcpAdd, mcpRemove, mcpSetEnabled, mcpSetCredential, mcpSetToolEnabled, mcpDiscover, modeFaces,
  presetScopeStatus, presetScopeRoster, presetScopeSet, presetScopeAdopt, presetScopeRelease,
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
  // The modes that load the skill whose detail is open, when its scope section
  // cannot say (see loadDetailModes). null = not queried / not applicable.
  const [detailModes, setDetailModes] = useState<{ readonly loading: boolean; readonly ids: readonly string[] } | null>(null)
  // Preset-scoped delivery: the managed-root status and the roster the picker shows.
  const [scopeStatus, setScopeStatus] = useState<CatalogPresetScopeStatus | null>(null)
  const [presetOptions, setPresetOptions] = useState<readonly CatalogPresetOption[]>([])
  // The MODE the grid shows (one preset's face, or every mode compared) and the
  // comparison's faces. `null` mode means "not chosen yet": the store holds the
  // deployment default's face, so the grid renders it while the roster loads.
  const [mode, setMode] = useState<ModeSelection | null>(null)
  const [faces, setFaces] = useState<readonly CatalogModeFace[] | null>(null)
  const [modeBusy, setModeBusy] = useState(false)
  // The mode is mirrored in a ref because the mount effect and the mutation
  // handlers re-read the view they were installed for, not the one at render.
  const modeRef = useRef<ModeSelection | null>(null)

  /** Roster rows with display names localized for the active locale: the four
   * shipped presets publish no name (their copy resolves through the host's
   * built-in-preset keys), so every surface renders these, never the raw rows.
   * Identity fields (id/isDefault/broken) pass through untouched. */
  const localizedOptions = useMemo(
    () => presetOptions.map(option => ({ ...option, name: presetName(option, t) })),
    [presetOptions, t],
  )
  /** Mode faces with the same localization applied (their `name` feeds the
   * comparison's mode labels and the unavailable list). */
  const localizedFaces = useMemo(
    () => (faces === null ? null : faces.map(face => ({ ...face, name: presetName({ id: face.preset, name: face.name }, t) }))),
    [faces, t],
  )

  /** The preset a session naming none composes, i.e. the mode the store holds
   * before a human picks one — the store's first read is the default's face. */
  const defaultPreset = useMemo(
    () => localizedOptions.find(option => option.isDefault === true) ?? localizedOptions[0],
    [localizedOptions],
  )
  /** The preset id a read of THIS view should use (undefined = global fallback). */
  const presetIdOf = useCallback((selection: ModeSelection | null): string | undefined =>
    selection === null ? defaultPreset?.id : selection.kind === 'preset' ? selection.id : undefined,
  [defaultPreset])
  /** The comparison model, or null when the grid shows one mode's face. */
  const comparison = useMemo<ModeComparison | null>(
    () => (mode?.kind === 'compare' && localizedFaces !== null ? buildModeComparison(localizedFaces) : null),
    [mode, localizedFaces],
  )
  const comparing = mode?.kind === 'compare'

  const faceSkills = comparison !== null ? comparison.skills : (snapshot?.skills ?? [])
  /** The grid is the mode's UNFILTERED face — nothing is merged into it.
   *
   * The delivery work merged managed-root rows the current scope did not hold,
   * so they stayed editable from one grid. With a mode control that merge is a
   * lie: a skill scoped to 写作模式 appeared under 开发模式, and the tab's own
   * count was the union rather than the mode's. A managed skill is reachable by
   * selecting a mode that loads it (or the comparison), and `orphans` below
   * keeps the one case no mode can show reachable. */
  const skills = faceSkills
  /** Display name per preset id, for the managed badges. */
  const presetNames = useMemo(
    () => new Map(localizedOptions.map(option => [option.id, option.name ?? option.id])),
    [localizedOptions],
  )
  /** One chip per mode id a capability was found in (comparison view only). */
  const modeChipsFor = useCallback(
    (ids: readonly string[] | undefined): readonly CatalogModeChip[] =>
      ids === undefined ? [] : resolveModeChips(ids, localizedOptions),
    [localizedOptions],
  )
  /** The chips a card should render, or undefined when it has no row at all: an
   * EMPTY list must not claim the row, because the card gives that row its bottom
   * padding (see `.pvCard[data-modes]` in the stylesheet). */
  const cardModeChips = useCallback(
    (ids: readonly string[] | undefined): readonly CatalogModeChip[] | undefined => {
      if (comparison === null) return undefined
      const chips = modeChipsFor(ids)
      return chips.length === 0 ? undefined : chips
    },
    [comparison, modeChipsFor],
  )
  /** A managed skill's preset-scope badge, for the surfaces where that policy is
   * the point (the orphan list, the modal) — never the mode grid, where it would
   * impersonate a source. */
  const scopeTagOf = useCallback((name: string): string | undefined => {
    const row = scopeStatus?.skills.find(entry => entry.name === name)
    if (row === undefined) return undefined
    const names = row.presets.map(id => presetNames.get(id) ?? id)
    return `${t('scopePresetTag')} · ${names.length === 0 ? t('scopeAllPresets') : names.join('、')}`
  }, [scopeStatus, presetNames, t])
  /** Managed skills no readable mode can show (see {@link orphanManagedSkills}). */
  const orphans = useMemo(() => {
    if (scopeStatus === null) return []
    const failed = scopeStatus.presets.filter(row => row.error !== undefined).map(row => row.presetId)
    return orphanManagedSkills(scopeStatus.skills, localizedOptions, failed)
  }, [scopeStatus, localizedOptions])
  const tools = comparison !== null ? comparison.tools : (snapshot?.tools ?? [])
  const loading = snapshot == null && comparison === null

  /** Enter a mode: the store holds one face at a time, so a preset switch is a
   * re-read at that preset's scope and the comparison is a separate fetch. */
  const selectMode = (next: ModeSelection): void => {
    modeRef.current = next
    setMode(next)
    if (next.kind === 'compare') {
      void loadFaces()
      return
    }
    setModeBusy(true)
    void refresh(next.id).finally(() => setModeBusy(false))
  }
  /** Read every mode's face (the host composes a mode nothing has mounted yet).
   * `force` re-reads after a mutation; otherwise the shared cache answers. */
  const loadFaces = async (force = false): Promise<void> => {
    setModeBusy(true)
    try {
      setFaces(await modeFaces(force))
    } finally {
      setModeBusy(false)
    }
  }
  /** Re-read whatever the grid is showing: one mode's face, or every face. */
  const reloadView = async (): Promise<void> => {
    if (modeRef.current?.kind === 'compare') await loadFaces(true)
    else await refresh(presetIdOf(modeRef.current))
  }

  /** Re-fetch the catalog + MCP snapshots after any MCP mutation. MCP
   * add/remove/enable/discover changes which `mcp__` tools are registered on the
   * host tool registry, so the catalog grid must refresh too — not just the MCP
   * store — or a removed server's tools linger until a manual page refresh. */
  const refreshMcp = async (): Promise<void> => {
    await Promise.all([
      reloadView(),
      mcpSnapshot().then(setMcps),
    ])
  }
  /** Re-read the preset-scope status and roster after any scope write. */
  const refreshScope = async (): Promise<readonly CatalogPresetOption[]> => {
    const [status, roster] = await Promise.all([presetScopeStatus(), presetScopeRoster()])
    setScopeStatus(status ?? null)
    setPresetOptions(roster)
    return roster
  }

  useEffect(() => { void refreshMcp() }, [])
  useEffect(() => {
    // The roster lands after the first read; adopt its default as the initial
    // mode WITHOUT re-reading (the store already holds that face).
    void refreshScope().then((roster) => {
      const initial = roster.find(option => option.isDefault === true) ?? roster[0]
      if (initial === undefined) return
      const next: ModeSelection = { kind: 'preset', id: initial.id }
      modeRef.current = next
      setMode(next)
    })
  }, [])

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
   * + any live-registered (mcp-<server>__<tool>) tools grouped by server. The
   * comparison view feeds it the UNION of every mode's tools, so a server only
   * some modes see still appears. */
  const mcpGroups = useMemo(
    () => buildMcpGroups(
      comparison === null ? snapshot : { skills: [], tools, mcpServers: [], channels: [] },
      mcps,
      query,
    ),
    [comparison, snapshot, tools, mcps, query],
  )

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

  /**
   * The mode a READ of one capability should use. A preset view reads its own
   * mode. The comparison has no single mode, so it reads where the capability
   * actually lives — the default mode when that mode has it, else the first
   * mode that does — and never a mode that does not register it at all.
   */
  const readModeFor = (name: string): string | undefined => {
    const current = modeRef.current
    if (current === null || current.kind === 'preset') return current?.id
    const modes = comparison?.skillModes.get(name) ?? []
    if (defaultPreset !== undefined && modes.includes(defaultPreset.id)) return defaultPreset.id
    return modes[0] ?? defaultPreset?.id
  }

  /** The mode control's current value. */
  const modeValue = mode?.kind === 'compare' ? MODE_COMPARE : (presetIdOf(mode) ?? '')
  const handleModeChange = (value: string): void => {
    selectMode(value === MODE_COMPARE ? { kind: 'compare' } : { kind: 'preset', id: value })
  }
  /** Whether a selected mode fell back to the global layer (its read carries no
   * `preset` stamp), i.e. the preset could not compose — the grid is NOT that
   * mode's face and must say so. */
  const modeFellBack = !comparing
    && mode !== null
    && snapshot !== undefined
    && presetIdOf(mode) !== undefined
    && snapshot.preset !== presetIdOf(mode)

  /**
   * The modes that LOAD one skill, for a detail modal whose scope section
   * cannot tell: a plugin-provided or built-in skill has no preset editor, so
   * the modes that carry it are the only answer to "where does it apply".
   *
   * Read from the shared faces cache, so a panel that already compared modes
   * answers instantly and a first-time open pays for the composition once. The
   * question is asked only where it is otherwise unanswerable: a skill whose
   * scope IS editable shows its declared scope instead.
   */
  const loadDetailModes = async (name: string): Promise<void> => {
    if (presetScopeWritable(name, skills, scopeStatus)) {
      setDetailModes(null)
      return
    }
    setDetailModes({ loading: true, ids: [] })
    const all = await modeFaces()
    setDetailModes({
      loading: false,
      ids: all
        .filter(face => face.unavailable === undefined && face.skills.some(skill => skill.name === name))
        .map(face => face.preset),
    })
  }

  const openDetail = async (name: string): Promise<void> => {
    setSelectedName(name)
    setClaim({ status: 'loading', data: undefined })
    void loadDetailModes(name)
    const data = await detail(name, readModeFor(name))
    setClaim({ status: 'done', data })
  }
  const closeDetail = (): void => {
    setSelectedName(null)
    setClaim({ status: 'idle', data: undefined })
    setDetailModes(null)
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

      {/* The bar renders while a roster exists even when the current mode holds
          nothing: the mode control lives in it, so hiding it would strand the
          user in a mode they cannot leave from this tab. */}
      {!loading && kind === 'skills' && (skills.length > 0 || presetOptions.length > 0) ? (
        <>
          <div className={css.filterBar} role="search">
            <div className={css.searchBox}>
              <span className={css.searchIcon}><IconSearchOutlineMedium size={16} /></span>
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
            <ModeSelect options={localizedOptions} value={modeValue} busy={modeBusy} onSelect={handleModeChange} t={t} />
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

      {!loading && kind === 'tools' && (tools.length > 0 || presetOptions.length > 0) ? (
        <>
          <div className={css.filterBar} role="search">
            <div className={css.searchBox}>
              <span className={css.searchIcon}><IconSearchOutlineMedium size={16} /></span>
              <input
                className={css.searchInput}
                type="search"
                value={query}
                placeholder={t('toolSearchPlaceholder')}
                aria-label={t('toolSearchPlaceholder')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <ModeSelect options={localizedOptions} value={modeValue} busy={modeBusy} onSelect={handleModeChange} t={t} />
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

      {comparing ? (
        <div className={css.modeNote} aria-busy={modeBusy}>
          {modeBusy
            ? t('modeBusy')
            : t('modeCompareNote')
              .replace('{n}', String(comparison?.modes ?? 0))
              .replace('{skills}', String(skills.length))
              .replace('{tools}', String(tools.length))}
          {!modeBusy && comparison !== null && comparison.unavailable.length > 0 ? (
            <span
              className={css.modeWarn}
              title={comparison.unavailable.map(entry => `${entry.label}: ${entry.reason}`).join('\n')}
            >
              {t('modeUnavailableNote').replace('{n}', String(comparison.unavailable.length))}
            </span>
          ) : null}
          {!modeBusy ? <span className={css.modeHint}>{t('modeCompareCost')}</span> : null}
        </div>
      ) : null}
      {!comparing && modeBusy ? <div className={css.modeNote}>{t('modeBusy')}</div> : null}
      {modeFellBack ? <div className={css.modeNote}>{t('modeFallback')}</div> : null}

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
                  modes={cardModeChips(comparison?.skillModes.get(skill.name))}
                  modeTotal={comparison?.modes ?? 0}
                  onMode={handleModeChange}
                  onOpen={() => void openDetail(skill.name)}
                  onDelete={() => setDeleteTarget(skill.name)}
                  t={t}
                />
              ))}
            </div>
          )
      ) : null}

      {/* The one class the mode filter cannot reach: a managed skill no readable
          mode delivers (its scope names a preset this deployment does not have,
          or a duplicate refused delivery). Without this list it would be
          invisible everywhere and could never be released. */}
      {!loading && kind === 'skills' && orphans.length > 0 ? (
        <details className={css.orphanGroup}>
          <summary className={css.orphanSummary}>
            {t('orphanManaged').replace('{n}', String(orphans.length))}
          </summary>
          <p className={css.confHint}>{t('orphanManagedHint')}</p>
          <div className={css.grid}>
            {orphans.map(orphan => (
              <SkillPreviewCard
                key={orphan.name}
                skill={orphanSkillRow(orphan)}
                tag={scopeTagOf(orphan.name)}
                onMode={handleModeChange}
                onOpen={() => void openDetail(orphan.name)}
                onDelete={() => setDeleteTarget(orphan.name)}
                t={t}
              />
            ))}
          </div>
        </details>
      ) : null}

      {kind === 'tools' ? (
        <ToolCards
          loading={loading}
          visibleTools={visibleTools}
          mcpGroups={mcpGroups}
          segment={toolSegment}
          comparison={comparison}
          modeChipsFor={modeChipsFor}
          onMode={handleModeChange}
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
          scope={scopeEditorFor(selectedName, skills, scopeStatus, localizedOptions, {
            save: async (presets) => {
              const result = await presetScopeSet(selectedName, presets)
              await Promise.all([refreshScope(), reloadView()])
              return result
            },
            adopt: async (presets) => {
              const result = await presetScopeAdopt(selectedName, presets)
              await Promise.all([refreshScope(), reloadView()])
              return result
            },
            release: async () => {
              const result = await presetScopeRelease(selectedName)
              await Promise.all([refreshScope(), reloadView()])
              return result
            },
          })}
          modeChips={detailModes === null || detailModes.loading ? undefined : modeChipsFor(detailModes.ids)}
          modesLoading={detailModes?.loading === true}
          // Switching modes replaces the grid the modal is describing, so the
          // modal closes with the jump rather than outliving its subject.
          onModeSelect={(id) => { closeDetail(); handleModeChange(id) }}
        />
      ) : null}

      {showAdd ? (
        <AddSkillModal onClose={() => setShowAdd(false)} addSkill={addSkill} listDirSkills={listDirSkills} pickDirectory={pickDirectory} refreshSettled={refreshSettled} t={t} />
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
            // Deleting reads the file at the mode the card was opened from: the
            // same skill name can resolve to a different bundle in another mode.
            const targetMode = readModeFor(deleteTarget)
            const res = await deleteSkill(deleteTarget, targetMode)
            // The removal reaches the registry through the host's watcher after
            // the delete returns, so wait for the row to actually leave.
            if (res.ok) await refreshSettled(s => !s.skills.some(skill => skill.name === deleteTarget), targetMode)
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

/** One mode option's label: its published name, plus the two facts a picker must
 * not hide — it is the deployment default, or it cannot compose a session. */
function modeOptionLabel(option: CatalogPresetOption, t: (key: CapabilityCatalogKey) => string): string {
  const name = option.name ?? option.id
  if (option.broken !== undefined) return `${name}（${t('scopeBroken')}）`
  return option.isDefault === true ? `${name}（${t('modeDefault')}）` : name
}

/**
 * The mode control (`模式`): the grid's read position, beside the search and
 * sort controls. One option per agent preset plus the comparison, which is how
 * "which tools/skills does THIS mode load" and "which modes load THIS
 * capability" are both answered from one grid.
 *
 * A vanished roster (no agent-preset service) renders nothing: a mode picker
 * with no modes is noise, and the grid already reads the deployment default.
 */
function ModeSelect({ options, value, busy, onSelect, t }: {
  options: readonly CatalogPresetOption[]
  value: string
  busy: boolean
  onSelect: (value: string) => void
  t: (key: CapabilityCatalogKey) => string
}) {
  if (options.length === 0) return null
  return (
    <select
      className={css.select}
      value={value}
      disabled={busy}
      aria-label={t('modeLabel')}
      title={t('modeHint')}
      onChange={(e) => onSelect(e.target.value)}
    >
      {options.map(option => (
        <option key={option.id} value={option.id}>{modeOptionLabel(option, t)}</option>
      ))}
      <option value={MODE_COMPARE}>{t('modeAll')}</option>
    </select>
  )
}

/** Tool-origin guidance modal: explains why a plugin tool may show as builtin and
 * copies a ready-to-send instruction (referencing the convention doc) for the
 * user's agent to read and apply. */function ToolOriginGuideModal({ onClose, t }: { onClose: () => void; t: (key: CapabilityCatalogKey) => string }) {
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
      <code className={css.guideDocPath}>{t('toolOriginGuideCopy')}</code>
      <div className={css.guideFooter}>
        <span className={css.confHint}>{t('toolOriginGuideFooter')}</span>
        <button type="button" className={css.btnPrimary} onClick={() => void copyDoc()}>
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
    </ModalShell>
  )
}

/** Sources the catalog may move out of a default root into the managed root. */
/** Source label for a managed skill rendered outside the mode that delivers it.
 * Not a member of the deletable set: removal goes through `release`. */
const MANAGED_SOURCE = 'capability-catalog'

/** One orphan row as a card can render it. */
function orphanSkillRow(orphan: OrphanManagedSkill): CatalogSkillRow {
  return {
    name: orphan.name,
    description: orphan.description,
    source: MANAGED_SOURCE,
    provider: 'capability-catalog',
    modelInvocable: orphan.modelInvocable,
    userInvocable: orphan.userInvocable,
  }
}

/** Sources the catalog may move out of a default root into the managed root. */
const ADOPTABLE_SOURCES: ReadonlySet<string> = new Set([
  'user-dsh', 'user-agents', 'project-dsh', 'project-agents', 'custom',
])

/**
 * Whether a deployment can write THIS skill's preset scope at all: it lives in
 * the plugin's managed root, or in a default root the catalog may adopt into it.
 *
 * The same rule {@link scopeEditorFor} renders, as a boolean for callers that
 * only need to know whether the modes are knowable from the scope editor — a
 * caller asking "which modes load this skill?" should read the faces, not the
 * declared scope, exactly when this is false.
 */
export function presetScopeWritable(
  name: string,
  skills: readonly { readonly name: string; readonly source: string }[],
  status: CatalogPresetScopeStatus | null,
): boolean {
  if (status === null) return false
  if (status.skills.some(row => row.name === name)) return true
  const row = skills.find(entry => entry.name === name)
  return row !== undefined && ADOPTABLE_SOURCES.has(row.source)
}

/**
 * The scope editor for one skill, or undefined when the deployment has no
 * delivery surface at all (no roster, no managed root).
 *
 * `writable` is the honest half of this face. The host writes a preset scope
 * into the frontmatter of a skill in ITS OWN managed root (`setManagedPresetScope`
 * answers `"<name>" is not a managed skill` for anything else), so exactly two
 * shapes are configurable here: a skill already in that root, and one in a
 * default root the catalog may adopt INTO it. A plugin-provided skill (source
 * `runtime`) or a built-in one (source `bundled`) is neither: which modes see it
 * is decided by the plugin's own row in each mode's composition, and offering
 * the checkerboard with a Save button only produced a refusal. Those rows keep
 * their section and get an explanation instead — `provider` names the plugin
 * that decides.
 * @param name - the skill whose detail modal is open.
 * @param skills - the catalog rows, for the skill's own source.
 * @param status - the delivery status, or null before it first resolved.
 * @param options - the roster the picker offers.
 * @param actions - the three write paths, already bound to this skill.
 * @returns the editor face, or undefined when there is nothing to say.
 */
export function scopeEditorFor(
  name: string,
  skills: readonly { readonly name: string; readonly source: string; readonly provider?: string }[],
  status: CatalogPresetScopeStatus | null,
  options: readonly CatalogPresetOption[],
  actions: {
    readonly save: (presets: readonly string[]) => Promise<{ ok: boolean; error?: string }>
    readonly adopt: (presets: readonly string[]) => Promise<{ ok: boolean; error?: string }>
    readonly release: () => Promise<{ ok: boolean; error?: string }>
  },
): ScopeEditor | undefined {
  if (status === null) return undefined
  const managedRow = status.skills.find(row => row.name === name)
  const catalogRow = skills.find(row => row.name === name)
  if (managedRow === undefined && catalogRow === undefined) return undefined
  const adoptable = managedRow === undefined && catalogRow !== undefined && ADOPTABLE_SOURCES.has(catalogRow.source)
  return {
    managed: managedRow !== undefined,
    adoptable,
    writable: managedRow !== undefined || adoptable,
    ...catalogRow?.provider === undefined ? {} : { provider: catalogRow.provider },
    declared: managedRow?.presets ?? [],
    ...managedRow?.conflict === undefined ? {} : { conflict: managedRow.conflict },
    options,
    save: actions.save,
    adopt: actions.adopt,
    release: actions.release,
  }
}
