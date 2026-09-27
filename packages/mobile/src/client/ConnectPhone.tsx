import { useEffect, useMemo, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CONNECT_PATH, type MobileConnectInfo } from '../protocol.ts'

/** Encode entirely in this browser; the login credential never visits a QR service. */
export function LoginQR({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M'); code.addData(value); code.make()
    const n = code.getModuleCount(), cells: string[] = []
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.isDark(y, x)) cells.push(`M${x + 4} ${y + 4}h1v1h-1z`)
    return { size: n + 8, path: cells.join('') }
  }, [value])
  return <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width="256" height="256" shapeRendering="crispEdges"><rect width={size} height={size} fill="white"/><path d={path} fill="black"/></svg>
}

/** Settings owns this page's lifetime; no credential is persisted or put in the URL. */
export function ConnectPhone({ t }: PropsLocale<'mobile'>) {
  const [info, setInfo] = useState<MobileConnectInfo>(), [login, setLogin] = useState<string>()
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const request = useRef<AbortController>(), timer = useRef<ReturnType<typeof setTimeout>>()
  const hide = () => { request.current?.abort(); clearTimeout(timer.current); setLogin(undefined); setBusy(false) }
  const load = async (generate = false) => {
    hide(); setFailed(false); setBusy(true)
    const controller = new AbortController(); request.current = controller
    try {
      const response = await fetch(CONNECT_PATH, { method: generate ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(generate ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) })
      const result = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) {
        if (result.state === 'unreachable') { setInfo(result); return }
        throw new Error('unavailable')
      }
      if (controller.signal.aborted) return
      if (generate) {
        const url = new URL(result.loginUrl)
        if (!info?.origin || url.origin !== info.origin || url.protocol !== 'https:' || !url.searchParams.get('token')) throw new Error('invalid')
        setLogin(url.href); timer.current = setTimeout(hide, 120_000)
      } else setInfo(result)
    } catch { if (!controller.signal.aborted) setFailed(true) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    void load()
    const conceal = () => { if (document.visibilityState === 'hidden') hide() }
    document.addEventListener('visibilitychange', conceal); window.addEventListener('pagehide', hide)
    return () => { request.current?.abort(); clearTimeout(timer.current); document.removeEventListener('visibilitychange', conceal); window.removeEventListener('pagehide', hide) }
  }, [])
  useEffect(() => {
    if (!login) return
    const controller = new AbortController()
    let checking = false
    const poll = setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const response = await fetch(CONNECT_PATH, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('unavailable')
        const next: MobileConnectInfo = await response.json()
        if (controller.signal.aborted) return
        setInfo(next)
        if (next.state !== 'ready' || next.origin !== new URL(login).origin) hide()
      } catch { if (!controller.signal.aborted) { hide(); setFailed(true) } }
      finally { checking = false }
    }, 15_000)
    return () => { controller.abort(); clearInterval(poll) }
  }, [login])
  return <section data-mobile-connect>
    <style>{styles}</style>
    <h2>{t('connectPhone')}</h2><p>{t('connectIntro')}</p>
    {info?.origin && <div data-connect-host><span>{t('server')}</span><strong>{new URL(info.origin).host}</strong></div>}
    {info && info.state !== 'ready' && <div role="status"><p>{t(info.state === 'unreachable' ? 'connectUnreachable' : info.state === 'untrusted-origin' ? 'connectUntrusted' : info.state === 'unsupported' ? 'connectUnsupported' : 'connectSetup')}</p></div>}
    {failed && <p role="alert">{t('connectError')}</p>}
    {busy && <p role="status">{t('connectLoading')}</p>}
    {login ? <div data-connect-code><LoginQR value={login} label={t('connectQR')}/><p>{t('connectConceal')}</p><button type="button" onClick={hide}>{t('connectHide')}</button></div>
      : <button type="button" disabled={busy} onClick={() => { void load(info?.state === 'ready') }}>{t(info?.state === 'ready' ? 'connectGenerate' : 'directoryRetry')}</button>}
    <ol><li>{t('connectStepOpen')}</li><li>{t('connectStepScan')}</li><li>{t('connectStepConfirm')}</li></ol>
    <p data-connect-note>{t('connectPrivacy')}</p><p data-connect-note>{t('connectNetwork')}</p>
  </section>
}

const styles = `
[data-mobile-connect]{max-width:640px;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.6}
[data-mobile-connect] h2{font-size:20px;margin:0 0 12px}
[data-mobile-connect] p{margin:12px 0}
[data-connect-host]{display:flex;gap:16px;justify-content:space-between;flex-wrap:wrap;padding:16px 0;margin:16px 0;border-block:1px solid var(--dsw-alias-border-l2)}
[data-connect-host] strong{overflow-wrap:anywhere;font-weight:500}
[data-mobile-connect] button{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-secondary,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 18px;min-height:44px;cursor:pointer}
[data-mobile-connect] button:disabled{opacity:.5;cursor:default}
[data-mobile-connect] button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#527cff);outline-offset:3px}
[data-connect-code]{display:flex;align-items:center;flex-direction:column;gap:8px;padding:24px 0}
[data-connect-code] svg{max-width:100%;height:auto;border:12px solid white;border-radius:12px;box-sizing:content-box}
[data-mobile-connect] ol{padding-left:24px;margin:24px 0}[data-mobile-connect] li{padding:5px 0}
[data-connect-note]{font-size:13px;color:var(--dsw-alias-label-secondary)}
`
