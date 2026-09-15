import type { LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'
import { kimiNativeConfiguration, type KimiNativeConfiguration } from './model-catalog.ts'

/** Confirm model first: its returned options determine which efforts are valid. */
export async function configureKimiSession(
  sessionId: string,
  initial: KimiNativeConfiguration | undefined,
  desired: LocalAgentResolvedConfiguration,
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): Promise<KimiNativeConfiguration | undefined> {
  let current = initial
  if (desired.model !== undefined && current?.currentModel !== desired.model) {
    if (current?.modelConfigId === undefined) throw new Error('This Kimi ACP session exposes no verified model selection control')
    if (!current.directory.entries.some(entry => entry.value === desired.model)) throw new Error('The running Kimi session does not advertise this model')
    current = kimiNativeConfiguration(await request('session/set_config_option', { sessionId, configId: current.modelConfigId, value: desired.model }))
    if (current?.currentModel !== desired.model) throw new Error('Kimi did not confirm the requested model')
  }
  if (desired.effort !== undefined && current?.currentEffort !== desired.effort) {
    const currentModel = current?.currentModel
    const entry = current?.directory.entries.find(entry => entry.value === currentModel)
    if (current?.effortConfigId === undefined || !entry?.reasoning?.options.some(option => option.value === desired.effort)) {
      throw new Error('The running Kimi session does not advertise this model/effort combination')
    }
    current = kimiNativeConfiguration(await request('session/set_config_option', { sessionId, configId: current.effortConfigId, value: desired.effort }))
    if (current?.currentEffort !== desired.effort || (desired.model !== undefined && current.currentModel !== desired.model)) {
      throw new Error('Kimi did not confirm the requested model/effort configuration')
    }
  }
  return current
}
