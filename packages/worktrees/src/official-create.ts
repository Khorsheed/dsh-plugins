import { isAbsolute, join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { CreatedWorktree } from '@deepseek-ai/dsh-experimental-worktree/types'

/** The optional official creator, accessed only through its public create method. */
export interface OfficialWorktreeCreator {
  create(agent: Agent, request: { name: string }, signal?: AbortSignal): Promise<CreatedWorktree>
}

/** Create only a named new branch in the official pool; other requests keep the legacy semantics. */
export async function createInOfficialPool(options: {
  repo: string
  path: string
  branch: string | undefined
  agent: Agent | undefined
  signal?: AbortSignal | undefined
  official: OfficialWorktreeCreator | undefined
}): Promise<CreatedWorktree | undefined> {
  const { repo, path, branch, agent, signal, official } = options
  if (official === undefined || agent === undefined || branch === undefined || branch === '' || !isAbsolute(path)) return undefined
  if (path !== join(repo, '.agents/worktrees', branch)) return undefined
  return official.create(agent, { name: branch }, signal)
}
