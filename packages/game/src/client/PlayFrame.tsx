/**
 * The play area: the deployed version in a `sandbox="allow-scripts"` iframe
 * (an opaque origin — no cookies, no host storage, no network by the frame's
 * own CSP), fed by postMessage through the shared loader. Saves live in this
 * browser's localStorage per project; the frame sees them as its own
 * `localStorage`. When a play session ends (version change, restart, the tab
 * closing) its length and errors go to the playtest log.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { BundleFile } from '../types.ts'
import { shellHtml, type FrameMessage } from '../vfs.ts'
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

/** Play-session report handed to the playtest log. */
export interface PlayReport {
  readonly version: number
  readonly seconds: number
  readonly errors: string[]
}

/** Props of the play frame. */
export interface PlayFrameProps {
  readonly projectId: string
  readonly version: number
  readonly files: Readonly<Record<string, BundleFile>>
  readonly t: TranslateNS<'game'>
  readonly onReport: (report: PlayReport) => void
}

/** The sandboxed play frame plus its small toolbar. */
export function PlayFrame({ projectId, version, files, t, onReport }: PlayFrameProps): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null)
  const [run, setRun] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const shell = useMemo(() => shellHtml(), [])
  const report = useRef(onReport)
  report.current = onReport

  useEffect(() => {
    const started = Date.now()
    const seen: string[] = []
    setErrors([])
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data as FrameMessage | undefined
      if (data?.gamedev === 'error') {
        seen.push(`${data.msg}`)
        setErrors(list => (list.length >= 20 ? list : [...list, data.msg]))
      } else if (data?.gamedev === 'save') {
        writeSaves(projectId, data.saves)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      const seconds = (Date.now() - started) / 1000
      if (seconds >= 5 || seen.length > 0) report.current({ version, seconds, errors: seen })
    }
  }, [projectId, version, run])

  const boot = (): void => {
    frame.current?.contentWindow?.postMessage({ gamedev: 'files', files, saves: readSaves(projectId) }, '*')
  }

  return <div className={css.play}>
    <div className={css.stage}>
      <iframe
        key={`${version}:${run}`}
        ref={frame}
        className={css.frame}
        title={`v${version}`}
        sandbox="allow-scripts"
        srcDoc={shell}
        onLoad={boot}
      />
    </div>
    <div className={css.playBar}>
      <button type="button" className={css.button} onClick={() => { setRun(n => n + 1) }}>{t('play.restart')}</button>
      <span className={css.hint}>{t('play.focus')}</span>
      {errors.length > 0 && <span className={css.errorText} title={errors.join('\n')}>{t('play.errors', { count: errors.length })}</span>}
    </div>
  </div>
}
