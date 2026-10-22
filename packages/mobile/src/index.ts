/** Mobile's host face uses the official authenticated Connection registry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { CONNECT_PATH, DIRECTORY_PATH, HANDSHAKE_PATH, TUNNEL_PATH, mobileHandshake } from './protocol.ts'
import { connectResponse } from './connect.ts'
import { createTunnelSupervisor, tunnelResponse, type ConfigEditorLike, type WebServerLike, type WebStartupLike } from './tunnel.ts'

import { directoryResponse } from './directories.ts'

export const name = 'mobile'
export const inject: string[] = []

interface ProfileContextLike { home?: string }

/** Attach only when the official Connection carrier is composed. */
export function apply(ctx: Context, config: { publicOrigin?: string; cloudflaredPath?: string } = {}): void {
  // The supervisor lives at apply root, outside the connection inject: a
  // hot-rebind re-applies the connection row, which would dispose anything
  // registered inside the callback — including the re-binder itself.
  const tunnel = createTunnelSupervisor({
    locate: {
      configEditor: () => ctx.get('configEditor') as ConfigEditorLike | undefined,
      webStartup: () => ctx.get('webStartup') as WebStartupLike | undefined,
      webServer: () => ctx.get('webServer') as WebServerLike | undefined,
      profileHome: () => (ctx.get('profileContext') as ProfileContextLike | undefined)?.home,
    },
    cloudflaredPath: config.cloudflaredPath,
  })
  ctx.effect(() => () => tunnel.dispose())
  ctx.inject(['connection'], (web) => {
    web.connection.fetch.register({ path: CONNECT_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: connectResponse(web.connection, () => tunnel.managedOrigin() ?? config.publicOrigin ?? process.env.DSH_MOBILE_PUBLIC_ORIGIN) })
    web.connection.fetch.register({ path: TUNNEL_PATH, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: tunnelResponse(tunnel) })
    web.connection.fetch.register({ path: DIRECTORY_PATH, methods: ['GET'], requestBody: 'buffered', fetch: directoryResponse })
    web.connection.fetch.register({
      path: HANDSHAKE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => Response.json(mobileHandshake(), {
        headers: { 'cache-control': 'no-store' },
      }),
    })
  })
}
