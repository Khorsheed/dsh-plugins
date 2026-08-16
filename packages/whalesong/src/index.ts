/**
 * Whalesong host half: a config-serving mount anchor. All interactive behavior
 * lives in `src/client/`; this module exists because the client-modules node
 * half discovers browser bundles by scanning the host Loader's entries for
 * packages declaring `dsh.client` (packages/client/modules/src/index.ts):
 * no entry row, no client.js route. Its one real job is holding the cordis
 * plugin Config (`enabled` / `volume`) and serving it to the browser half
 * over a plugin-owned route — the official settings RPC refuses external
 * namespaces (allowlist), so cordis Config + own route is the channel
 * (agent-profiles / plugin-toggle precedent). Cordis hot config updates
 * dispose and re-apply the entry, so the route closure always reflects the
 * latest resolved config without any listener plumbing.
 * @module @khorsheed/dsh-whalesong
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Plugin name for the Loader. */
export const name = 'whalesong'
/** The config route needs the webserver; everything else stays client-side. */
export const inject = ['webServer']

/** The browser half's config endpoint (kept in sync with src/client/config.ts). */
export const WHALESONG_CONFIG_PATH = '/whalesong/config'

/**
 * Plugin config. Both fields optional; everything defaults to v1 behavior.
 * Volume maps onto the oscillator gain as `0.1 × volume`, so the default 1
 * reproduces v1's restrained loudness and 0 mutes without disabling.
 */
export interface Config {
  /** False = no whalesong overlay, no chimes, no session subscription. */
  enabled?: boolean
  /** Loudness 0..1 (clamped at resolve; schema stays lenient for hot updates). */
  volume?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean(),
  volume: z.number(),
})

/** Fully-resolved runtime config (the route payload shape). */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly volume: number
}

/**
 * Normalize the validated plugin config. Volume is clamped rather than
 * schema-rejected so a stray out-of-range value degrades to a bound instead
 * of failing the entry's hot update.
 * @param config - the validated plugin config.
 * @returns the resolved config the browser half consumes.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const volume = config.volume ?? 1
  return {
    enabled: config.enabled ?? true,
    volume: Math.min(1, Math.max(0, volume)),
  }
}

/** JSON response helper (no framework on the host side). */
function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Mount the anchor: serve the resolved config to the browser half.
 * @param ctx - Host context.
 * @param config - resolved plugin config (re-supplied on every hot update).
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const route: WebRoute = {
    kind: 'exact',
    path: WHALESONG_CONFIG_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        respondJson(res, 405, { error: { code: 'method-not-allowed', message: 'config is a GET endpoint' } })
        return
      }
      respondJson(res, 200, resolved)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'whalesong: config route')
}
