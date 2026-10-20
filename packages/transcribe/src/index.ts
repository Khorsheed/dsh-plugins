/**
 * Local transcription, host half: provides the `transcribe` service — long
 * recordings to timed, optionally speaker-separated text on this machine.
 * Consumers (video-studio, dsh-reader) probe `ctx.get('transcribe')` when they
 * need it and degrade when it is absent; nothing here is model-facing.
 * State (the models, temporary WAVs) lives under $DSH_HOME/state/transcribe.
 *
 * @module @khorsheed/dsh-transcribe
 */
import type { Context } from '@deepseek-ai/cordis'
import { TranscribeService, type TranscribeConfig } from './service.ts'

export { TranscribeService, segmentText } from './service.ts'
export type { TranscribeConfig } from './service.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    transcribe: TranscribeService
  }
}

export const name = 'transcribe'

export function apply(ctx: Context, config: TranscribeConfig = {}): void {
  const service = new TranscribeService(config, ctx.logger as unknown as Console)
  ctx.provide('transcribe', service)
  ctx.effect(() => () => service.dispose(), 'transcribe: queue')
}
