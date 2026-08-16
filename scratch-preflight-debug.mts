import { join } from 'node:path'
import { boot, loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { allPatches, composeProfile, PROFILE_ROOT_FILENAME } from '/Users/zhuyudan/code/deepseek-harness/apps/cli/src/profile-boot.ts'

const composed = composeProfile('web', [])
const patches = allPatches(composed)
const webserver = composed.rows.get('webserver')
if (webserver !== undefined) {
  patches.push({ id: 'webserver', config: { ...(webserver.config ?? {}) as Record<string, unknown>, port: 0 } })
}
const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
try {
  const environment = loadLayeredEnv('dsh')
  const ctx = await boot('dsh', rootConfig, structuredClone(patches), (hostCtx) => {
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, { args: [], exit: () => {} })
  })
  await ctx.fiber.dispose()
  console.log('BOOT OK')
} catch (error) {
  const seen = new Set()
  const walk = (e: unknown, depth: number): void => {
    if (e === null || typeof e !== 'object' || seen.has(e)) return
    seen.add(e)
    if (e instanceof Error) console.error('  '.repeat(depth) + 'ERR:', e.message.split('\n')[0])
    const errs = (e as { errors?: unknown[] }).errors
    if (Array.isArray(errs)) for (const i of errs) walk(i, depth + 1)
    walk((e as { cause?: unknown }).cause, depth + 1)
  }
  walk(error, 0)
}
