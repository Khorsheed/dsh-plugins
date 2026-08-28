/**
 * Capability-catalog settings section (工具与技能): a standalone nav tab.
 *
 * Layout: a heading + intro, an add-skill button, a 技能 / 工具 tab switch.
 * - 技能 tab renders a three-column grid of preview cards (name + description
 *   preview + source/provider). Clicking a card opens a centered modal with the
 *   full detail, the SKILL.md source, the frontmatter metadata, and a config
 *   block for every credential the skill's metadata declares (e.g. an API key).
 * - 工具 tab renders collapsible tool cards (name + channel attribution).
 * - The add-skill button opens a modal that installs a skill from an uploaded
 *   zip archive or a pasted SKILL.md, then refreshes the catalog.
 */
import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconFolderClose16,
  IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityCatalogCardProps } from './slots.ts'
import type { CapabilityCatalogKey } from './locales.ts'
import type { CatalogSkillDetail, CatalogSkillFileRead, CatalogSkillRow, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
import css from './CapabilityCatalogCard.module.css'

type Kind = 'skills' | 'tools'
type DetailClaim = { status: 'idle' | 'loading' | 'done'; data: CatalogSkillDetail | undefined }

export function CapabilityCatalogCard({ useCatalog, detail, readSkillFile, setCredential, addSkill, refresh, t }: CapabilityCatalogCardProps) {
  const snapshot = useCatalog((s) => s)
  const [kind, setKind] = useState<Kind>('skills')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [claim, setClaim] = useState<DetailClaim>({ status: 'idle', data: undefined })
  const [showAdd, setShowAdd] = useState(false)

  const skills = snapshot?.skills ?? []
  const tools = snapshot?.tools ?? []
  const loading = snapshot == null

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
  const toggleTool = (name: string): void => setOpenTool((prev) => (prev === name ? null : name))

  return (
    <div className={css.section}>
      <div className={css.headRow}>
        <h2 className={css.heading}>{t('title')}</h2>
        <button type="button" className={css.addBtn} onClick={() => setShowAdd(true)}>{t('addSkill')}</button>
      </div>
      <p className={css.intro}>{t('intro')}</p>

      <div className={css.tabs} role="tablist">
        <button type="button" className={css.tab} data-active={kind === 'skills'} role="tab" onClick={() => setKind('skills')}>
          {t('skillTab')}<span className={css.tabCnt}>{skills.length}</span>
        </button>
        <button type="button" className={css.tab} data-active={kind === 'tools'} role="tab" onClick={() => setKind('tools')}>
          {t('toolTab')}<span className={css.tabCnt}>{tools.length}</span>
        </button>
      </div>

      {loading ? <div className={css.empty}>{t('loading')}</div> : null}
      {!loading && kind === 'skills' && skills.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}
      {!loading && kind === 'tools' && tools.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}

      {!loading && kind === 'skills' && skills.length > 0 ? (
        <div className={css.grid}>
          {skills.map((skill) => (
            <SkillPreviewCard key={skill.name} skill={skill} onOpen={() => void openDetail(skill.name)} t={t} />
          ))}
        </div>
      ) : null}

      {!loading && kind === 'tools' ? tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} open={openTool === tool.name} onToggle={() => toggleTool(tool.name)} t={t} />
      )) : null}

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
        <AddSkillModal onClose={() => setShowAdd(false)} addSkill={addSkill} refresh={refresh} t={t} />
      ) : null}
    </div>
  )
}

/** Preview card in the skills grid: name + one-line description + source/provider. */
function SkillPreviewCard({ skill, onOpen, t }: {
  skill: CatalogSkillRow
  onOpen: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  return (
    <button type="button" className={css.pvCard} onClick={onOpen}>
      <div className={css.pvTitle}>{skill.name}</div>
      <div className={css.pvDesc}>{skill.description}</div>
      <div className={css.pvMeta}>
        <span className={css.badge}>{skill.source}</span>
        <span className={css.pvProvider}>{skill.provider}</span>
        {!skill.modelInvocable ? <span className={`${css.badge} ${css.badgeWarn}`}>{t('userOnly')}</span> : null}
      </div>
    </button>
  )
}

/** Collapsible tool card (name + channel attribution). */
function ToolCard({ tool, open, onToggle, t }: {
  tool: CatalogToolRow
  open: boolean
  onToggle: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  return (
    <div className={`${css.card} ${open ? css.open : ''}`}>
      <button type="button" className={css.cardHead} onClick={onToggle}>
        <span className={css.title}>{tool.name}</span>
        <span className={css.scroll}><IconChevronDownOutline14 size={16} /></span>
      </button>
      <div className={css.preview}>{tool.description}</div>
      <div className={css.body}>
        <div className={css.divider} />
        <div className={css.meta}>
          <span className={css.metaKey}>{t('source')}</span>
          <span className={css.metaVal}>{tool.channel}</span>
          {tool.owner !== undefined ? (
            <>
              <span className={css.metaKey}>{t('provider')}</span>
              <span className={css.metaVal}>{tool.owner}</span>
            </>
          ) : null}
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

        {claim.status === 'loading' ? <div className={css.empty}>{t('loading')}</div> : null}
        {claim.status === 'done' && data === undefined ? <div className={css.empty}>{t('loadFailed')}</div> : null}

        {claim.status === 'done' && data !== undefined ? (
          <div className={css.modalBody}>
            <p className={css.detailDesc}>{data.description}</p>
            <div className={css.meta}>
              <span className={css.metaKey}>{t('source')}</span><span className={css.metaVal}>{data.source}</span>
              <span className={css.metaKey}>{t('provider')}</span><span className={css.metaVal}>{data.provider}</span>
              <span className={css.metaKey}>{t('modelInvocable')}</span><span className={css.metaVal}>{data.modelInvocable ? t('yes') : t('no')}</span>
              {data.whenToUse !== undefined ? (<><span className={css.metaKey}>{t('whenToUse')}</span><span className={css.metaVal}>{data.whenToUse}</span></>) : null}
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
                        <input className={css.input} type="password" value={credValues[key] ?? ''} placeholder={t('credPlaceholder')}
                          onChange={(e) => setCredValues((s) => ({ ...s, [key]: e.target.value }))} />
                        <button type="button" className={css.btnPrimary} disabled={state === 'saving' || (credValues[key] ?? '') === ''}
                          onClick={() => void saveCred(key)}>{t('save')}</button>
                      </div>
                      {state === 'fail' ? <div className={css.credFail}>{t('saveFailed')}</div> : null}
                    </div>
                  )
                })}
              </details>
            ) : null}

            <details className={css.source} open>
              <summary className={css.sourceTitle}>{t('viewSource')}</summary>
              {data.files !== undefined && data.files.length > 0 ? (
                <div className={css.split}>
                  <div className={css.treePane}>
                    <BundleFileTree
                      files={data.files}
                      selectedPath={srcFile === '' ? 'SKILL.md' : srcFile}
                      onSelect={selectSource}
                    />
                  </div>
                  <div className={css.detailPane}>
                    {srcLoading ? <div className={css.empty}>{t('loading')}</div>
                      : (srcFile === '' || srcFile === 'SKILL.md') ? <pre className={css.codeBlk}>{data.content}</pre>
                        : srcContent === undefined ? <div className={css.empty}>{t('loadFailed')}</div>
                          : <pre className={css.codeBlk}>{srcContent}</pre>}
                  </div>
                </div>
              ) : (
                <pre className={css.codeBlk}>{data.content}</pre>
              )}
            </details>

            {data.metadataText !== undefined ? (
              <details className={css.source}>
                <summary className={css.sourceTitle}>{t('metadata')}</summary>
                <pre className={css.codeBlk}>{formatMetadata(data.metadataText)}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Add-skill modal: install from a zip archive or a pasted SKILL.md. */
function AddSkillModal({ onClose, addSkill, refresh, t }: {
  onClose: () => void
  addSkill: (payload: string, modelInvocable: boolean, root: 'user' | 'project') => Promise<{ ok: boolean; error?: string; name?: string }>
  refresh: () => Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  const [tab, setTab] = useState<'zip' | 'text'>('zip')
  const [zipBase64, setZipBase64] = useState<string | null>(null)
  const [zipName, setZipName] = useState<string>('')
  const [text, setText] = useState('')
  const [modelInvocable, setModelInvocable] = useState(true)
  const [root, setRoot] = useState<'user' | 'project'>('user')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const canSubmit = tab === 'zip' ? zipBase64 !== null : text.trim() !== ''

  const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => setZipBase64(arrayBufferToBase64(reader.result as ArrayBuffer))
    reader.onerror = () => setMsg({ ok: false, text: t('readFailed') })
    reader.readAsArrayBuffer(file)
    setZipName(file.name)
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit || busy) return
    setBusy(true)
    setMsg(null)
    const payload = tab === 'zip' ? zipBase64 as string : utf8ToBase64(text)
    const res = await addSkill(payload, modelInvocable, root)
    if (res.ok) {
      await refresh()
      setMsg({ ok: true, text: `${t('addSuccess')}${res.name ?? ''}` })
    } else {
      setMsg({ ok: false, text: res.error ?? t('addError') })
    }
    setBusy(false)
  }

  return (
    <div className={css.overlay} role="dialog" aria-modal="true">
      <div className={css.modal}>
        <div className={css.modalHead}>
          <h3 className={css.modalTitle}>{t('addSkill')}</h3>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('detailClose')}>×</button>
        </div>
        <div className={css.modalBody}>
          <p className={css.confHint}>{t('addSkillHint')}</p>

          <div className={`${css.tabs} ${css.innerTabs}`} role="tablist">
            <button type="button" className={css.tab} data-active={tab === 'zip'} role="tab" onClick={() => setTab('zip')}>{t('addTabUpload')}</button>
            <button type="button" className={css.tab} data-active={tab === 'text'} role="tab" onClick={() => setTab('text')}>{t('addTabPaste')}</button>
          </div>

          {tab === 'zip' ? (
            <div>
              <input type="file" accept=".zip" className={css.file} onChange={onFile} />
              {zipName !== '' ? <div className={css.fileName}>{zipName}</div> : null}
            </div>
          ) : (
            <textarea className={css.textarea} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('addPastePlaceholder')} rows={12} spellCheck={false} />
          )}

          <label className={css.switchRow}>
            <span className={css.enableLabel}>{t('addModelInvocable')}</span>
            <span className={css.switch}>
              <input type="checkbox" checked={modelInvocable} onChange={(e) => setModelInvocable(e.target.checked)} />
              <span className={css.track} />
              <span className={css.thumb} />
            </span>
          </label>
          <p className={css.confHint}>{t('addModelInvocableHint')}</p>

          <label className={css.rootRow}>
            <span className={css.enableLabel}>{t('addRoot')}</span>
            <select className={css.select} value={root} onChange={(e) => setRoot(e.target.value as 'user' | 'project')}>
              <option value="user">{t('rootUser')}</option>
              <option value="project">{t('rootProject')}</option>
            </select>
          </label>

          {msg !== null ? <div className={`${css.addMsg} ${msg.ok ? css.addMsgOk : css.addMsgErr}`}>{msg.text}</div> : null}

          <div className={css.actions}>
            <button type="button" className={css.btnGhost} onClick={onClose}>{t('cancel')}</button>
            <span className={css.spacer} />
            <button type="button" className={css.btnPrimary} disabled={!canSubmit || busy} onClick={() => void submit()}>{t('addSubmit')}</button>
          </div>
        </div>
      </div>
    </div>
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

/** Encode a UTF-8 string to base64. */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
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
