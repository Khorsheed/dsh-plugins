/** Mobile's host face contributes one authenticated browser discovery resource. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { HANDSHAKE_PATH, mobileHandshake } from './protocol.ts'

export const name = 'mobile'
export const inject: string[] = []

/** Attach only when the official Connection carrier is composed. */
export function apply(ctx: Context): void {
  ctx.inject(['connection'], (web) => {
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
