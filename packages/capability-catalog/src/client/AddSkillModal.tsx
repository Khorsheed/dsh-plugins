import { useState, type ChangeEvent, type DragEvent } from 'react'
  import { Button, IconFolderOpenOutlineMedium, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
  import type { CapabilityCatalogSnapshot, CatalogAddSkillRequest, CatalogDirSkillInfo } from '@khorsheed/dsh-capability-catalog/types'
  import type { CapabilityCatalogKey } from './locales.ts'
  import { ModalShell } from './ModalShell.tsx'
  import { installedNames } from './settle.ts'
  import css from './CapabilityCatalogCard.module.css'

/** Add-skill modal: file upload (drag-drop), clone-from-source, or local dir. */
export function AddSkillModal({ onClose, addSkill, listDirSkills, pickDirectory, refreshSettled, t }: {
  onClose: () => void
  addSkill: (request: CatalogAddSkillRequest) => Promise<{ ok: boolean; error?: string; name?: string; exists?: boolean }>
  listDirSkills: (dirPath: string) => Promise<readonly CatalogDirSkillInfo[]>
  pickDirectory: () => Promise<string | null>
  refreshSettled: (settled: (snapshot: CapabilityCatalogSnapshot) => boolean) => Promise<boolean>
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

  /**
   * Wait for the installed skill(s) to reach the catalog snapshot. The host
   * writes the files before its watcher invalidates the registry, so a single
   * refresh here returns the pre-install snapshot and the new card stays absent
   * until the panel is reopened.
   */
  const settleInstalled = async (name: string | undefined): Promise<void> => {
    const wanted = installedNames(name)
    await refreshSettled(s => wanted.every(n => s.skills.some(skill => skill.name === n)))
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
      await settleInstalled(res.name)
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
      await settleInstalled(res.name)
      setMsg({ ok: true, text: `${t('addSuccess')}${res.name ?? ''}` })
    } else {
      setMsg({ ok: false, text: res.error ?? t('addError') })
    }
    setBusy(false)
  }

  return (
    <>
    <ModalShell title={t('addSkill')} onClose={onClose} className={css.addModal} closeOnMask={false} t={t}>
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
          <span className={css.dropzoneIcon}><IconFolderOpenOutlineMedium size={28} /></span>
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
    </ModalShell>
    {confirm !== null ? (
      <Modal
        open
        onClose={() => setConfirm(null)}
        title={t('addExistsTitle')}
        closeLabel={t('close')}
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
