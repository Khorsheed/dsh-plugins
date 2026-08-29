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
import { useMemo, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
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
import type { CatalogAddSkillRequest, CatalogDirSkillInfo, CatalogSkillDetail, CatalogSkillFileRead, CatalogSkillRow, CatalogToolChannel, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
import css from './CapabilityCatalogCard.module.css'

type Kind = 'skills' | 'tools'
type DetailClaim = { status: 'idle' | 'loading' | 'done'; data: CatalogSkillDetail | undefined }
type SortBy = 'name' | 'updated'
type ToolChannelFilter = 'all' | CatalogToolChannel

/** Built-in / plugin-provided skill sources — never deletable, shown with the 内置 tag. */
const BUILTIN_SOURCES: ReadonlySet<string> = new Set(['runtime', 'bundled', 'skill-badge'])
const isBuiltin = (skill: CatalogSkillRow): boolean => BUILTIN_SOURCES.has(skill.source)

export function CapabilityCatalogCard({ useCatalog, detail, readSkillFile, listDirSkills, pickDirectory, setCredential, addSkill, deleteSkill, refresh, t }: CapabilityCatalogCardProps) {
  const snapshot = useCatalog((s) => s)
  const [kind, setKind] = useState<Kind>('skills')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [claim, setClaim] = useState<DetailClaim>({ status: 'idle', data: undefined })
  const [showAdd, setShowAdd] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // Grid filter / sort state.
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  // Tool channel filter state.
  const [toolChannel, setToolChannel] = useState<ToolChannelFilter>('all')
  // Tool detail (click a tool card to view its full detail).
  const [toolDetail, setToolDetail] = useState<CatalogToolRow | null>(null)

  const skills = snapshot?.skills ?? []
  const tools = snapshot?.tools ?? []
  const loading = snapshot == null

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = skills.filter((s) =>
      q === '' || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    const sorted = [...matched]
    if (sortBy === 'updated') sorted.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    else sorted.sort((a, b) => a.name.localeCompare(b.name))
    return sorted
  }, [skills, query, sortBy])

  /** Visible tools filtered by query + channel, then sorted (flat, no grouping). */
  const visibleTools = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = tools.filter((tool) => {
      if (toolChannel !== 'all' && tool.channel !== toolChannel) return false
      if (q === '') return true
      return tool.name.toLowerCase().includes(q)
        || tool.description.toLowerCase().includes(q)
        || (tool.serverName ?? '').toLowerCase().includes(q)
        || (tool.owner ?? '').toLowerCase().includes(q)
    })
    return matched.sort((a, b) => a.name.localeCompare(b.name))
  }, [tools, query, toolChannel])

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
    setToolChannel('all')
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
        <button type="button" className={css.addBtn} onClick={() => setShowAdd(true)}>{t('addSkill')}</button>
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
          <select className={css.select} value={toolChannel} aria-label={t('source')} onChange={(e) => setToolChannel(e.target.value as ToolChannelFilter)}>
            <option value="all">{t('filterAll')}</option>
            <option value="builtin">{t('toolBuiltin')}</option>
            <option value="plugin">{t('toolPlugin')}</option>
            <option value="mcp">MCP</option>
          </select>
        </div>
      ) : null}

      {loading ? <div className={css.empty}>{t('loading')}</div> : null}
      {!loading && kind === 'skills' && skills.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}
      {!loading && kind === 'tools' && tools.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}

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

      {!loading && kind === 'tools' && tools.length > 0 ? (
        visibleTools.length === 0
          ? <div className={css.empty}>{t('toolNoMatch')} <button type="button" className={css.ghostLink} onClick={resetFilter}>{t('filterAll')}</button></div>
          : (
            <div className={css.grid}>
              {visibleTools.map((tool) => (
                <ToolCard key={tool.name} tool={tool} onOpen={() => setToolDetail(tool)} t={t} />
              ))}
            </div>
          )
      ) : null}

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

/** Tool preview card (dsh-card anatomy): name + channel pill + 2-line desc +
 * origin subtitle; click to open the tool detail modal. */
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

/** Tool detail modal (host Modal): description + channel/origin + parameter schema. */
function ToolDetailModal({ tool, onClose, t }: { tool: CatalogToolRow; onClose: () => void; t: (key: CapabilityCatalogKey) => string }) {
  return (
    <Modal open onClose={onClose} title={tool.name} description={tool.description} footer={(
      <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
    )}>
      <div className={css.meta}>
        <span className={css.metaKey}>{t('source')}</span>
        <span className={css.metaVal}>{toolTag(tool, t)}</span>
        <span className={css.metaKey}>{t('provider')}</span>
        <span className={css.metaVal}>{toolOrigin(tool, t)}</span>
      </div>
      <div className={css.toolDetailParamsTitle}>{t('toolParams')}</div>
      <div className={css.toolParamsBody}>{formatParams(tool.parameters, t)}</div>
    </Modal>
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
              <p className={css.detailDesc}>{data.description}</p>
              <div className={css.meta}>
                <span className={css.metaItem}><span className={css.metaKey}>{t('source')}</span><span className={css.metaVal}>{data.source}</span></span>
                <span className={css.metaItem}><span className={css.metaKey}>{t('provider')}</span><span className={css.metaVal}>{data.provider}</span></span>
                <span className={css.metaItem}><span className={css.metaKey}>{t('modelInvocable')}</span><span className={css.metaVal}>{data.modelInvocable ? t('yes') : t('no')}</span></span>
                {data.whenToUse !== undefined ? <span className={css.metaItem}><span className={css.metaKey}>{t('whenToUse')}</span><span className={css.metaVal}>{data.whenToUse}</span></span> : null}
              </div>

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
