import { useRef, useState, type ReactNode } from 'react'
import { Button, Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { browserOnHost } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { NOVEL_GENRE_ID } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { parseNovelBinaryDocuments, parseNovelFiles, type NovelImportDraft, type NovelImportIssue, type NovelImportParseResult } from './import-documents.ts'
import { errorKey } from './use-novel.ts'
import css from './import.module.css'

type ImportedChapters = Readonly<Record<string, number>>
type DirectoryInfo = { readonly rootName: string; readonly skipped: number; readonly truncated: boolean }

/** The document and directory import launchers with their shared chapter preview. */
export function ImportNovel(props: NovelSurfaceProps): ReactNode {
  const { canvasId, remote, sessionId, navigate, t } = props
  const api = remote()
  const input = useRef<HTMLInputElement>(null)
  const operation = useRef(0)
  const [open, setOpen] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [drafts, setDrafts] = useState<readonly NovelImportDraft[]>([])
  const [issues, setIssues] = useState<readonly NovelImportIssue[]>([])
  const [directory, setDirectory] = useState<DirectoryInfo | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [imported, setImported] = useState<ImportedChapters>({})
  const [progress, setProgress] = useState<{ readonly done: number; readonly total: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [completed, setCompleted] = useState<'done' | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [browsing, setBrowsing] = useState(false)
  if (api === undefined || sessionId === undefined || props.board.genre?.id !== NOVEL_GENRE_ID) return null
  const DirectoryFlow = props.directoryFlow?.()

  const close = (): void => {
    if (progress !== null) return
    operation.current += 1
    setOpen(false)
  }
  const begin = (): number => {
    const ticket = ++operation.current
    setOpen(true)
    setBrowsing(false)
    setParsing(true)
    setDrafts([])
    setIssues([])
    setDirectory(null)
    setSelected(new Set())
    setFailure(null)
    setCompleted(null)
    setCopyState('idle')
    setImported({})
    return ticket
  }
  const present = (result: NovelImportParseResult): void => {
    setDrafts(result.drafts)
    setIssues(result.issues)
    setSelected(new Set(result.drafts.map(draft => draft.id)))
  }
  const pick = async (files: readonly File[]): Promise<void> => {
    if (files.length === 0 || progress !== null) return
    const ticket = begin()
    try {
      const result = await parseNovelFiles(files)
      if (ticket === operation.current) present(result)
    } finally {
      if (ticket === operation.current) setParsing(false)
    }
  }
  const pickFolder = async (path?: string): Promise<void> => {
    if (progress !== null) return
    const ticket = begin()
    try {
      const result = await api.importDirectory(sessionId, path === undefined ? undefined : { path })
      if (ticket !== operation.current) return
      if (!result.ok) {
        setFailure(t('error.generic', { message: result.error.message }))
      } else if (!result.value.ok) {
        if (result.value.error === 'cancelled') setOpen(false)
        else if (result.value.error === 'browse' && DirectoryFlow !== undefined) {
          setOpen(false)
          setBrowsing(true)
        } else setFailure(t(result.value.error === 'unsupported' || result.value.error === 'browse' ? 'import.directoryUnsupported' : 'import.directoryFailed'))
      } else {
        setDirectory({ rootName: result.value.rootName ?? '', skipped: result.value.skipped, truncated: result.value.truncated })
        const parsed = await parseNovelBinaryDocuments(result.value.files)
        if (ticket !== operation.current) return
        present({ drafts: parsed.drafts, issues: [...result.value.issues, ...parsed.issues] })
      }
    } catch (error) {
      if (ticket === operation.current) setFailure(t('error.generic', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      if (ticket === operation.current) setParsing(false)
    }
  }
  const pending = drafts.filter(draft => selected.has(draft.id) && imported[draft.id] === undefined)
  const fileCount = new Set(drafts.map(draft => draft.file)).size
  const importedNumbers = (byId: ImportedChapters): number[] => drafts.flatMap(draft => byId[draft.id] === undefined ? [] : [byId[draft.id]!])

  const run = async (): Promise<void> => {
    if (pending.length === 0 || progress !== null) return
    setFailure(null)
    setProgress({ done: 0, total: pending.length })
    const byId = { ...imported }
    let current: NovelImportDraft | undefined
    try {
      for (const [index, draft] of pending.entries()) {
        current = draft
        setProgress({ done: index, total: pending.length })
        const result = await api.importOwnChapter(sessionId, { canvasId, title: draft.title, text: draft.text })
        if (!result.ok) throw new Error(result.error.message)
        if (!result.value.ok || result.value.n === undefined) {
          setImported(byId)
          setFailure(t('import.failure', { count: Object.keys(byId).length, title: draft.title, message: t(errorKey(result.value.error)) }))
          navigate.refresh()
          setProgress(null)
          return
        }
        byId[draft.id] = result.value.n
        setImported({ ...byId })
      }
      setProgress(null)
      navigate.refresh()
      setCompleted('done')
    } catch (error) {
      setImported(byId)
      setFailure(t('import.failure', { count: Object.keys(byId).length, title: current?.title ?? '', message: error instanceof Error ? error.message : String(error) }))
      navigate.refresh()
      setProgress(null)
    }
  }

  const copyRequest = async (): Promise<void> => {
    const list = importedNumbers(imported).join('、')
    try {
      setCopyState(await writeClipboard(t('import.ask', { list })) ? 'copied' : 'failed')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <>
      <div className={css.launchers}>
        <button type="button" className={css.launch} onClick={() => { input.current?.click() }}>{t('import.open')}</button>
        {browserOnHost() && <button type="button" className={css.launch} onClick={() => { void pickFolder() }}>{t('import.directory')}</button>}
      </div>
      <input
        ref={input}
        className={css.fileInput}
        type="file"
        multiple
        accept=".txt,.md,.markdown"
        aria-label={t('import.choose')}
        onChange={event => {
          void pick([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
      <Modal
        open={open}
        onClose={close}
        title={t('import.title')}
        closeLabel={t('import.close')}
        description={t('import.hint')}
        footer={(
          <>
            {completed !== null && (
              <Button size="sm" variant="outline" onClick={() => { void copyRequest() }}>{t(copyState === 'copied' ? 'import.copied' : 'import.copyAsk')}</Button>
            )}
            {completed === null
              ? <Button size="sm" disabled={progress !== null} onClick={close}>{t('import.cancel')}</Button>
              : <Button size="sm" variant="primary" onClick={close}>{t('import.done')}</Button>}
            {completed === null && pending.length > 0 && (
              <Button size="sm" variant="primary" disabled={progress !== null} onClick={() => { void run() }}>
                {t(Object.keys(imported).length === 0 ? 'import.go' : 'import.retry', { count: pending.length })}
              </Button>
            )}
          </>
        )}
      >
        <div className={css.body}>
          <Button size="sm" disabled={parsing || progress !== null} onClick={() => { input.current?.click() }}>{t('import.choose')}</Button>
          <p className={css.muted}>{t('import.formats')}</p>
          {parsing && <p className={css.status}>{t('import.parsing')}</p>}
          {!parsing && directory !== null && (
            <div className={css.directory}>
              <b>{t('import.directoryRoot', { root: directory.rootName })}</b>
              {directory.skipped > 0 && <p>{t('import.directorySkipped', { count: directory.skipped })}</p>}
              {directory.truncated && <p className={css.failure}>{t('import.directoryTruncated')}</p>}
            </div>
          )}
          {!parsing && drafts.length > 0 && (
            <>
              <p className={css.summary}>{t('import.summary', { files: fileCount, count: drafts.length })}</p>
              <div className={css.list}>
                {drafts.map(draft => {
                  const done = imported[draft.id] !== undefined
                  return (
                    <label key={draft.id} className={css.row} data-done={done || undefined}>
                      <input
                        type="checkbox"
                        checked={selected.has(draft.id)}
                        disabled={done || progress !== null || completed !== null}
                        aria-label={t('import.select', { title: draft.title })}
                        onChange={() => {
                          setSelected(current => {
                            const next = new Set(current)
                            if (next.has(draft.id)) next.delete(draft.id)
                            else next.add(draft.id)
                            return next
                          })
                        }}
                      />
                      <span className={css.chapter}>
                        <b>{draft.title}</b>
                        <small>{draft.file} · {t('import.chars', { count: draft.chars.toLocaleString() })}{draft.noHeadings === true ? ` · ${t('import.noHeadings')}` : ''}</small>
                      </span>
                      {done && <span className={css.done}>{t('import.imported', { n: imported[draft.id]! })}</span>}
                    </label>
                  )
                })}
              </div>
            </>
          )}
          {!parsing && drafts.length === 0 && issues.length > 0 && <p className={css.status}>{t('import.none')}</p>}
          {issues.length > 0 && (
            <div className={css.issues}>
              <b>{t('import.issues')}</b>
              {issues.map((issue, index) => <p key={`${issue.file}:${issue.title ?? ''}:${index}`}>{t(`import.issue.${issue.reason}` as 'import.issue.empty', { file: issue.file, title: issue.title ?? '' })}</p>)}
            </div>
          )}
          {progress !== null && <p className={css.status} role="status">{t('import.progress', { done: progress.done, total: progress.total })}</p>}
          {failure !== null && <p className={css.failure} role="alert">{failure}</p>}
          {completed !== null && (
            <p className={copyState === 'failed' ? css.failure : css.success} role="status">
              {copyState === 'failed'
                ? t('import.copyFailed')
                : t('import.completed', { count: Object.keys(imported).length, list: importedNumbers(imported).join('、') })}
            </p>
          )}
        </div>
      </Modal>
      {DirectoryFlow !== undefined && (
        <DirectoryFlow
          open={browsing}
          busy={parsing}
          onPicked={path => { void pickFolder(path) }}
          onCancel={() => {
            operation.current += 1
            setBrowsing(false)
          }}
          onError={message => {
            operation.current += 1
            setBrowsing(false)
            setOpen(true)
            setFailure(t('error.generic', { message }))
          }}
        />
      )}
    </>
  )
}
