import type { Context } from '@deepseek-ai/cordis'

export type MobileDirectoryFlowSlot =
  | 'conversation.hero.workspace.directoryFlow'
  | 'sidebar.workspaces.directoryFlow'
  | 'workspace.picker.directoryFlow'

type LegacyDirectoryFlowSlot = Exclude<MobileDirectoryFlowSlot, 'workspace.picker.directoryFlow'>
type DirectoryFlowEffect = () => void
type DirectoryFlowContribution = (name: LegacyDirectoryFlowSlot) => DirectoryFlowEffect

/** Forward the version-dependent key without losing declaration-order handling. */
export function injectMobileDirectoryFlow(
  ctx: Context,
  name: MobileDirectoryFlowSlot,
  contribute: DirectoryFlowContribution,
): () => void {
  // All three slots accept the same contribution. The older type is used only
  // inside this boundary; the runtime key remains the requested dynamic key.
  // slots.inject stays inert before a declaration and handles later redeclarations.
  return ctx.slots.inject(name as LegacyDirectoryFlowSlot, () => contribute(name as LegacyDirectoryFlowSlot))
}
