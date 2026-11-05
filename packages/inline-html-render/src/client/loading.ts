const STALL_TIMEOUT_MS = 10_000

function loadingLabels(): { loading: string; failed: string; retry: string } {
  return /^zh(?:-|$)/i.test(document.documentElement.lang || navigator.language)
    ? { loading: '卡片加载中…', failed: '卡片加载失败', retry: '重试' }
    : { loading: 'Loading card…', failed: 'Card failed to load', retry: 'Retry' }
}

/** Keep the mounting state outside the untrusted document so it covers first paint. */
export function attachFrameLoading(frame: HTMLIFrameElement, container: HTMLElement, srcdoc: string): () => void {
  const labels = loadingLabels()
  const status = document.createElement('div')
  status.className = 'dsh-inline-card-status'
  status.setAttribute('role', 'status')
  status.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;min-height:150px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-tertiary,#8a9199);font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif'
  const label = document.createElement('span')
  const retry = document.createElement('button')
  retry.className = 'dsh-inline-card-retry'
  retry.type = 'button'
  retry.textContent = labels.retry
  retry.hidden = true
  retry.style.cssText = 'padding:3px 10px;border:1px solid var(--dsw-alias-line-secondary,#dde1e6);border-radius:6px;background:var(--dsw-alias-bg-primary,#fff);color:inherit;font:inherit;cursor:pointer'
  status.append(label, retry)
  container.appendChild(status)

  let timer: number | undefined
  let disposed = false
  const clearTimer = (): void => {
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
  }
  const fail = (): void => {
    if (disposed) return
    clearTimer()
    container.setAttribute('aria-busy', 'false')
    frame.style.visibility = 'hidden'
    status.style.display = 'flex'
    label.textContent = labels.failed
    retry.hidden = false
  }
  const loaded = (): void => {
    if (disposed) return
    clearTimer()
    container.setAttribute('aria-busy', 'false')
    frame.style.visibility = 'visible'
    status.style.display = 'none'
    retry.hidden = true
  }
  const arm = (): void => {
    if (disposed) return
    clearTimer()
    container.setAttribute('aria-busy', 'true')
    frame.style.visibility = 'hidden'
    status.style.display = 'flex'
    label.textContent = labels.loading
    retry.hidden = true
    timer = window.setTimeout(fail, STALL_TIMEOUT_MS)
  }
  const onRetry = (): void => {
    arm()
    frame.srcdoc = srcdoc
  }
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return
    const data = event.data as { fn?: unknown } | null
    if (data?.fn === 'ready') loaded()
  }

  window.addEventListener('message', onMessage)
  frame.addEventListener('error', fail)
  retry.addEventListener('click', onRetry)
  arm()

  return () => {
    disposed = true
    clearTimer()
    window.removeEventListener('message', onMessage)
    frame.removeEventListener('error', fail)
    retry.removeEventListener('click', onRetry)
    status.remove()
    container.removeAttribute('aria-busy')
  }
}
