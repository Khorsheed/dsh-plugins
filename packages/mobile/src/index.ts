/** Mobile's host face uses the official authenticated Connection registry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { CONNECT_PATH, DIRECTORY_PATH, HANDSHAKE_PATH, mobileHandshake } from './protocol.ts'
import { connectResponse } from './connect.ts'

import { directoryResponse } from './directories.ts'

export const name = 'mobile'
export const inject: string[] = []

/** Attach only when the official Connection carrier is composed. */
export function apply(ctx: Context, config: { publicOrigin?: string } = {}): void {
  ctx.inject(['connection'], (web) => {
    web.connection.fetch.register({ path: CONNECT_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: connectResponse(web.connection, config.publicOrigin ?? process.env.DSH_MOBILE_PUBLIC_ORIGIN) })
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
