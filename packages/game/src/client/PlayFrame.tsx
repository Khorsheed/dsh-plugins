/**
 * The play frame: one version in a `sandbox="allow-scripts"` iframe (an
 * opaque origin — no cookies, no host storage, no network by the frame's own
 * CSP), fed by postMessage through the shared loader. Saves live in this
 * browser's localStorage per project; slider values and element edits are
 * pushed in live; the pick overlay asks the game what is under a click.
 * When a play session ends (version change, restart, unmount) its length and
 * errors go to the playtest log.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { BundleFile } from '../types.ts'
import { shellHtml, type FrameMessage, type PickRef } from '../vfs.ts'
import css from './GameTab.module.css'

/** localStorage key for one project's saves. */
const savesKey = (projectId: string): string => `dsh-game:saves:${projectId}`

function readSaves(projectId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(savesKey(projectId))
    const parsed = raw === null ? {} : JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

function writeSaves(projectId: string, saves: Readonly<Record<string, string>>): void {
  try {
    localStorage.setItem(savesKey(projectId), JSON.stringify(saves))
  } catch {
    // Storage blocked or full: the game keeps its in-frame copy for this session.
  }
}

/** Forget a project's saves (重开存档). */
export function clearSaves(projectId: string): void {
  try {
    localStorage.removeItem(savesKey(projectId))
  } catch {
    // Nothing to clear.
  }
}

/** Play-session report handed to the playtest log. */
export interface PlayReport {
  readonly version: number
  readonly seconds: number
  readonly errors: string[]
}

/** One answered pick: the game's reference (a bare id becomes `{ id }`), and how the click was made. */
export interface PickAnswer {
  readonly ref: PickRef | null
  readonly supported: boolean
  /** Shift held: keep picking (several references in one message). */
  readonly shift: boolean
}

/** Rings for the candidate's changes, as the game's `highlight` takes them. */
export type HighlightList = readonly { readonly id: string; readonly tone: 'changed' | 'added' }[]

/** Props of the play frame. */
export interface PlayFrameProps {
  readonly projectId: string
  readonly version: number
  readonly files: Readonly<Record<string, BundleFile>>
  /** Restart counter: bump to reload the frame. */
  readonly run: number
  /** Live slider values (key → value), pushed on every change. */
  readonly params: Readonly<Record<string, number>>
  /** The last edited element, pushed in when it changes. */
  readonly element: Record<string, unknown> | null
  readonly picking: boolean
  readonly onPicked: (answer: PickAnswer) => void
  /** The hover hint's text for what is under the pointer while picking. */
  readonly hoverLabel: (ref: PickRef) => string
  /** Candidate diff rings; null clears them. */
  readonly highlight: HighlightList | null
  readonly onErrors: (errors: readonly string[]) => void
  readonly onReport: (report: PlayReport) => void
  readonly label: string
}

/** The sandboxed frame with a pick overlay. */
export function PlayFrame({ projectId, version, files, run, params, element, picking, onPicked, hoverLabel, highlight, onErrors, onReport, label }: PlayFrameProps): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null)
  const shell = useMemo(() => shellHtml(), [])
  const report = useRef(onReport)
  report.current = onReport
  const errorsCb = useRef(onErrors)
  errorsCb.current = onErrors
  const pickedCb = useRef(onPicked)
  pickedCb.current = onPicked
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [booted, setBooted] = useState(false)
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null)
  const hoverLabelRef = useRef(hoverLabel)
  hoverLabelRef.current = hoverLabel
  const shiftRef = useRef(false)
  const pointer = useRef({ x: 0, y: 0 })
  const hoverTimer = useRef(0)

  useEffect(() => {
    const started = Date.now()
    const seen: string[] = []
    errorsCb.current([])
    setBooted(false)
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data as FrameMessage | undefined
      if (data?.gamedev === 'error') {
        if (seen.length < 50) seen.push(data.msg)
        errorsCb.current([...seen])
      } else if (data?.gamedev === 'save') {
        writeSaves(projectId, data.saves)
      } else if (data?.gamedev === 'picked') {
        const ref: PickRef | null = data.ref ?? (data.id === null ? null : { id: data.id })
        if (data.hover) setHover(ref === null ? null : { text: hoverLabelRef.current(ref), ...pointer.current })
        else pickedCb.current({ ref, supported: data.supported, shift: shiftRef.current })
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      const seconds = (Date.now() - started) / 1000
      if (seconds >= 5 || seen.length > 0) report.current({ version, seconds, errors: seen })
    }
  }, [projectId, version, run])

  const post = (message: unknown): void => { frame.current?.contentWindow?.postMessage(message, '*') }

  useEffect(() => { if (booted) post({ gamedev: 'params', values: params }) }, [params, booted])
  useEffect(() => { if (booted && element !== null) post({ gamedev: 'element', element }) }, [element, booted])
  // 「指一下」 freezes the game (games that implement pause); leaving it resumes.
  useEffect(() => { if (booted) post({ gamedev: 'pause', on: picking }) ; if (!picking) setHover(null) }, [picking, booted])
  const highlightKey = JSON.stringify(highlight)
  useEffect(() => { if (booted) post({ gamedev: 'highlight', list: highlight ?? [] }) }, [highlightKey, booted]) // eslint-disable-line react-hooks/exhaustive-deps -- the key stands for the list

  const boot = (): void => {
    if (booted) return
    post({ gamedev: 'files', files, saves: readSaves(projectId), params: paramsRef.current })
    setBooted(true)
  }

  const pick = (event: MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    shiftRef.current = event.shiftKey
    post({ gamedev: 'pick', x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })
  }
  // Hover asks the game too (throttled), so the user sees what a click would pick.
  const hoverAt = (event: MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const now = Date.now()
    if (now - hoverTimer.current < 90) return
    hoverTimer.current = now
    post({ gamedev: 'pick', hover: true, x: pointer.current.x / rect.width, y: pointer.current.y / rect.height })
  }

  return <div className={css.stageInner} data-picking={picking ? 'true' : 'false'}>
    <iframe
      key={`${version}:${run}`}
      ref={frame}
      className={css.frame}
      title={label}
      sandbox="allow-scripts"
      srcDoc={shell}
      onLoad={boot}
    />
    {picking && <div className={css.pickLayer} onClick={pick} onMouseMove={hoverAt} onMouseLeave={() => { setHover(null) }} role="presentation" />}
    {picking && hover !== null && <span className={css.pickHover} style={{ left: hover.x, top: hover.y }}>{hover.text}</span>}
  </div>
}
