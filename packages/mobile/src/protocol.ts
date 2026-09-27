/** Identifiers shared by the plugin and its optional native shell. */
export const MOBILE_VERSION = '0.1.0'
export const BRIDGE_VERSION = 1
export const HANDSHAKE_PATH = '/api/mobile/handshake'
export const CONNECT_PATH = '/api/mobile/connect'
export interface MobileConnectInfo {
  state: 'ready' | 'not-configured' | 'invalid-origin' | 'untrusted-origin' | 'unsupported' | 'unreachable'
  origin: string | null
}

/** Read-only feature discovery; this does not create a login or grant access. */
export function mobileHandshake() {
  return {
    mobileVersion: MOBILE_VERSION,
    bridgeVersion: BRIDGE_VERSION,
    capabilities: ['responsive-layout', 'official-composer', 'browser-session-auth'],
    authentication: 'official-browser-session',
    devicePairing: false,
    pushNotifications: false,
  } as const
}

export const DIRECTORY_PATH = '/api/mobile/directories'
export interface MobileDirectoryListing {
  path: string
  parent: string | null
  entries: { name: string; path: string; hidden: boolean }[]
  truncated: boolean
}
