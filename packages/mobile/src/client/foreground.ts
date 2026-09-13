/** Resume a stale official follow generation, preserving live reply baselines.
 * Brief interruptions and duplicate native/browser signals leave healthy streams alone. */
export function installForegroundRecovery(win: Window, reconnect: () => void, getState: () => string | undefined = () => undefined): () => void {
  let hiddenAt = win.document.visibilityState === 'hidden' ? Date.now() : undefined
  let lastSignalAt = Date.now(), lastReconnectAt = -Infinity
  let timer: number | undefined, needsRecovery = false
  const resume = (awayMs: number) => {
    if (win.document.visibilityState === 'hidden' || win.navigator.onLine === false) return
    const state = getState()
    needsRecovery ||= awayMs >= 5000 || (state !== 'connected' && state !== 'connecting')
    lastSignalAt = Date.now()
    if (timer !== undefined) win.clearTimeout(timer)
    timer = win.setTimeout(() => {
      timer = undefined
      if (needsRecovery && Date.now() - lastReconnectAt >= 1000) { lastReconnectAt = Date.now(); reconnect() }
      needsRecovery = false
    }, 150)
  }
  const native = () => resume(Date.now() - (hiddenAt ?? lastSignalAt))
  const visibility = () => {
    if (win.document.visibilityState === 'hidden') {
      hiddenAt = Date.now(); needsRecovery = false
      if (timer !== undefined) win.clearTimeout(timer)
      timer = undefined; return
    }
    if (hiddenAt !== undefined) { const elapsed = Date.now() - hiddenAt; hiddenAt = undefined; resume(elapsed) }
  }
  const page = (event: PageTransitionEvent) => { if (event.persisted) resume(Infinity) }
  win.document.addEventListener('visibilitychange', visibility)
  win.addEventListener('pageshow', page)
  win.addEventListener('dsh-mobile-foreground', native)
  return () => { if (timer !== undefined) win.clearTimeout(timer); win.document.removeEventListener('visibilitychange', visibility); win.removeEventListener('pageshow', page); win.removeEventListener('dsh-mobile-foreground', native) }
}
