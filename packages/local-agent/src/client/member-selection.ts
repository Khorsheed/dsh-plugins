/**
 * The member control's selection as an edit form's plain draft and back:
 * '' stands for "follow the default" (an inherited choice reads the same —
 * the form offers no third state).
 * @module @khorsheed/dsh-local-agent/client/member-selection
 */
import type { LocalAgentConfigurationChoice, LocalAgentMemberConfiguration, LocalAgentResolvedConfiguration } from '../types.ts'

const valueOf = (choice: LocalAgentConfigurationChoice): string => choice.mode === 'value' ? choice.value : ''
const choiceOf = (value: string): LocalAgentConfigurationChoice => value.trim() === '' ? { mode: 'default' } : { mode: 'value', value: value.trim() }

/**
 * A following choice drafts as what it resolves to: the form's selects pick
 * a concrete entry for an empty value, and the draft equals its own baseline
 * until the human changes it, so an untouched form saves nothing.
 * @param selection - a control selection.
 * @param resolved - what the current configuration resolved to.
 * @returns the form draft.
 */
export function draftOf(selection: LocalAgentMemberConfiguration, resolved: LocalAgentResolvedConfiguration = {}): { readonly model: string; readonly effort: string } {
  return { model: valueOf(selection.model) || (resolved.model ?? ''), effort: valueOf(selection.effort) || (resolved.effort ?? '') }
}

/**
 * @param draft - the form draft.
 * @returns the control selection.
 */
export function selectionOf(draft: { readonly model: string; readonly effort: string }): LocalAgentMemberConfiguration {
  return { model: choiceOf(draft.model), effort: choiceOf(draft.effort) }
}
