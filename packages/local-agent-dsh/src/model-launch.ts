import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LocalAgentDshConfig } from './index.ts'

/** Private launch environment: never persisted in a profile, transcript or argv. */
export const MODEL_CONFIG_ENV = 'DSH_LOCAL_AGENT_MODEL_CONFIG'
const MODEL_KEY_ENV = 'DSH_LOCAL_AGENT_MODEL_API_KEY'
type ObjectValue = Record<string, unknown>
function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined
}
function settings(ctx: Context): Map<string, ObjectValue> {
  return new Map((ctx.get('settings')?.describe?.() ?? []).flatMap(row => {
    const value = object(row.value)
    return value === undefined ? [] : [[String(row.ns), value] as const]
  }))
}
function piProfile(ctx: Context, provider: string, values: Map<string, ObjectValue>): ObjectValue | undefined {
  const directory = ctx.get('llm')?.listConfigurableProviders?.().find(row => row.provider === provider)
  // Only the official pi-ai providers dictionary has this inheritance contract.
  // Other adapter families must explicitly provide a transport before being advertised.
  const ns = directory?.settingsNs ?? 'llm-pi-ai'
  if (ns !== 'llm-pi-ai') return undefined
  if (directory && (directory.settingsPath.length !== 2 || directory.settingsPath[0] !== 'providers' || directory.settingsPath[1] !== provider)) return undefined
  return object(object(values.get(ns)?.providers)?.[provider])
}

/** Whether this provider has a supported local configuration transfer contract. */
export function canInheritModelProvider(ctx: Context, provider: string): boolean {
  if (provider === 'deepseek-official') return true
  const profile = piProfile(ctx, provider, settings(ctx))
  return typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv.trim() !== ''
}

export interface LocalModelLaunch {
  readonly env: Record<string, string>
  /** In-memory fingerprint also retires a resident process after endpoint/key changes. */
  readonly fingerprint: string
}

/** Snapshot only the selected local route and resolve only its explicitly named credential. */
export async function localModelLaunch(ctx: Context, config: LocalAgentDshConfig, model?: string): Promise<LocalModelLaunch> {
  const provider = model?.includes('/') ? model.slice(0, model.indexOf('/')) : 'deepseek-official'
  const values = settings(ctx)
  let inherited: ObjectValue, ref: string, keyName: string
  if (provider === 'deepseek-official') {
    const profile = structuredClone(values.get('llm-deepseek') ?? {})
    ref = config.apiKeyRef ?? (typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : 'DEEPSEEK_API_KEY')
    inherited = { deepseek: { ...profile, apiKeyEnv: 'DEEPSEEK_API_KEY' } }
    keyName = 'DEEPSEEK_API_KEY'
  } else {
    const profile = piProfile(ctx, provider, values)
    if (typeof profile?.apiKeyEnv !== 'string' || profile.apiKeyEnv.trim() === '') {
      throw new Error(`subagent-dsh: model provider "${provider}" has no inheritable API-key route; configure its credential reference in the host Models settings`)
    }
    ref = profile.apiKeyEnv
    inherited = { piAi: { providers: { [provider]: { ...structuredClone(profile), apiKeyEnv: MODEL_KEY_ENV } } } }
    keyName = MODEL_KEY_ENV
  }
  const credential = await ctx.get('credentials')?.resolve(credentialRef(ref))
  if (!credential?.value) throw new Error(`subagent-dsh: credential ${ref} is unavailable for model provider "${provider}"`)
  const env = { [MODEL_CONFIG_ENV]: JSON.stringify(inherited), [keyName]: credential.value }
  return { env, fingerprint: createHash('sha256').update(JSON.stringify(env)).digest('hex') }
}
