import { BRIDGE_VERSION } from '../protocol.ts'

export type NativeAction = 'settings' | 'scan'
/** Additive bridge features: older shells and ordinary browsers retain Web controls. */
export function hasNativeAction(action: NativeAction): boolean {
  return window.__DSH_MOBILE_SHELL__?.bridgeVersion === BRIDGE_VERSION
    && window.__DSH_MOBILE_SHELL__.capabilities?.includes(action) === true
    && !!window.webkit?.messageHandlers?.dshMobile
}
export function requestNativeAction(action: NativeAction): void {
  if (hasNativeAction(action)) window.webkit?.messageHandlers?.dshMobile?.postMessage({ type: action, bridgeVersion: BRIDGE_VERSION })
}
export function reportChrome(visible: boolean): void {
  if (hasNativeAction('settings')) window.webkit?.messageHandlers?.dshMobile?.postMessage({ type: 'chrome', bridgeVersion: BRIDGE_VERSION, visible })
}
