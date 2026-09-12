/** Resume the official connection once after native, PWA or browser suspension.
 * Reopening follow obtains the host's live baseline; no prompt is replayed. */
export function installForegroundRecovery(win: Window, reconnect: () => void): () => void {
  let suspended = win.document.visibilityState === 'hidden'
  let timer: number | undefined
  const resume = () => {
    if (timer !== undefined) win.clearTimeout(timer)
    timer = win.setTimeout(() => { timer = undefined; reconnect() }, 150)
  }
  const visibility = () => {
    if (win.document.visibilityState === 'hidden') { suspended = true; return }
    if (suspended) { suspended = false; resume() }
  }
  const page = (event: PageTransitionEvent) => { if (event.persisted) resume() }
  win.document.addEventListener('visibilitychange', visibility)
  win.addEventListener('pageshow', page)
  win.addEventListener('dsh-mobile-foreground', resume)
  return () => { if (timer !== undefined) win.clearTimeout(timer); win.document.removeEventListener('visibilitychange', visibility); win.removeEventListener('pageshow', page); win.removeEventListener('dsh-mobile-foreground', resume) }
}
