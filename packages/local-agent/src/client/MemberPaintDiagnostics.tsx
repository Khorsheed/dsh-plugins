import { useLayoutEffect, useRef } from 'react'
import type { LivePaintDiagnostics } from './live-paint.ts'

/** Read-only DOM probe retained in the composer after transient output settles. */
export function MemberPaintDiagnostics({ diagnostics, sessionId }: { diagnostics: LivePaintDiagnostics; sessionId: string }) {
  const element = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = (): void => {
      timer = undefined
      if (element.current) element.current.dataset.livePaintReport = JSON.stringify(diagnostics.report(sessionId))
    }
    update()
    // Exporting a long round must not serialize its samples on every token.
    const unsubscribe = diagnostics.subscribe(() => { timer ??= setTimeout(update, 250) })
    return () => { unsubscribe(); if (timer !== undefined) clearTimeout(timer) }
  }, [diagnostics, sessionId])
  return <span hidden ref={element} data-member-paint-diagnostics={sessionId} />
}
