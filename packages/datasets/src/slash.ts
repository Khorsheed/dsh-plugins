/**
 * The `/datasets` slash face — the human interface over {@link DatasetsService},
 * a thin adapter exactly like the CLI: the handler parses `invocation.rawInput`
 * itself and takes the session from `invocation.agent` (bind/unbind write the
 * invoking session's binding record).
 *
 * The REGISTRATION no longer happens in this core: it moved to the companion
 * `@khorsheed/dsh-datasets-tool` row (preset-visibility rollout A3), which an
 * agent preset mounts per session — registering from the preset's mount lands
 * the command in that preset's scope layer, so only granted sessions see it
 * (the official `/goal` `/plan` `/compact` shape). This module keeps the
 * handler and the definition; {@link registerDatasetsSlash} is what the
 * companion calls with its scoped context. The grant backstop inside the
 * handler is the second gate for the paths the scope layer cannot cover.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { DatasetBinding } from './binding.ts'
import { DatasetsError } from './dataset.ts'
import { formatBindReceipt, formatList, formatShow, formatWarnings } from './format.ts'
import { resolveScope, type DatasetsService } from './service.ts'

const USAGE = 'usage: /datasets list [dataset] | show <dataset> [item] | bind <repoPath> [--datasets a,b] [--layers x,y] | unbind'

/** The companion row whose preset grant admits this command. */
const TOOL_ROW_MODULE = '@khorsheed/dsh-datasets-tool'

/** The agentPresets slice the grant backstop reads (duck-typed; probed, never injected). */
interface AgentPresetsProbe {
  composedPreset(agentCtx: Context): string | undefined
  compositionInventory(): Promise<readonly { id: string; broken?: string; rows: readonly { moduleName: string }[] }[]>
}

/**
 * The execution backstop behind the preset-scope registration: refuse only
 * when the session's preset composition is READABLE and names no companion
 * row — a direct invocation in an ungranted session (a stale completion
 * replayed, a root-mounted companion) gets an honest refusal instead of
 * running. Every unreadable path fails OPEN — no roster service, no agent
 * scope context, no joined preset, an inventory that throws, a missing or
 * `broken` group — because the registration layer is the real gate and this
 * guard must never condemn a grant it cannot see.
 */
async function slashGrantRefusal(invocation: CommandInvocation): Promise<CommandResult | null> {
  try {
    const agentCtx = invocation.agent.ctx as Context | undefined
    if (agentCtx === undefined || agentCtx === null) return null
    const presets = agentCtx.get('agentPresets') as AgentPresetsProbe | undefined | null
    if (presets == null || typeof presets.composedPreset !== 'function' || typeof presets.compositionInventory !== 'function') return null
    const presetId = presets.composedPreset(agentCtx)
    if (presetId === undefined) return null
    const inventory = await presets.compositionInventory()
    const group = inventory.find(candidate => candidate.id === presetId)
    if (group === undefined || group.broken !== undefined) return null
    if (group.rows.some(row => row.moduleName === TOOL_ROW_MODULE)) return null
    return {
      kind: 'error',
      text: `/datasets is not granted to this session: its agent preset (${presetId}) composes no ${TOOL_ROW_MODULE} row. `
        + 'The slash face moved to that companion row — run the command from a session whose preset grants it, '
        + 'or name the row in this preset\'s agent.cordis.yml.',
    }
  } catch {
    return null
  }
}

/**
 * Handle one `/datasets` invocation. Usage problems answer with the usage
 * text; service failures surface as error results — the slash face never
 * throws across the registry.
 * @param service - the datasets service (its `defaultRepo` is the scope
 *   fallback the core's plugin config set).
 * @param invocation - the command invocation (the calling session is the
 *   binding owner).
 */
export async function handleDatasetsCommand(service: DatasetsService, invocation: CommandInvocation): Promise<CommandResult> {
  const refusal = await slashGrantRefusal(invocation)
  if (refusal !== null) return refusal
  const session = invocation.agent.session
  const parts = invocation.rawInput.trim().split(/\s+/).filter(part => part !== '')
  const verb = parts[0]
  const flags = parseSlashFlags(parts.slice(1))
  const defaultRepo = service.defaultRepo
  try {
    switch (verb) {
      case 'list': {
        const scope = resolveScope({}, service.binding(session), defaultRepo)
        const result = await service.list(scope, flags.positionals[0])
        const warnings = result.kind === 'datasets'
          ? result.datasets.flatMap(dataset => dataset.warnings)
          : result.dataset.warnings
        const suffix = warnings.length === 0 ? '' : `\n${formatWarnings(warnings)}`
        return { kind: 'success', text: `${formatList(result)}${suffix}` }
      }
      case 'show': {
        const dataset = flags.positionals[0]
        if (dataset === undefined) return { kind: 'error', text: 'usage: /datasets show <dataset> [item]' }
        const scope = resolveScope({}, service.binding(session), defaultRepo)
        const result = await service.show(scope, dataset, flags.positionals[1])
        const suffix = result.dataset.warnings.length === 0 ? '' : `\n${formatWarnings(result.dataset.warnings)}`
        return { kind: 'success', text: `${formatShow(result)}${suffix}` }
      }
      case 'bind': {
        const repoPath = flags.positionals[0]
        if (repoPath === undefined) {
          return { kind: 'error', text: 'usage: /datasets bind <repoPath> [--datasets a,b] [--layers x,y]' }
        }
        const binding: DatasetBinding = {
          repoPath,
          ...(flags.datasets !== undefined ? { datasets: flags.datasets } : {}),
          ...(flags.layers !== undefined ? { layers: flags.layers } : {}),
        }
        const recorded = service.bind(session, binding)
        return { kind: 'success', text: formatBindReceipt(recorded) }
      }
      case 'unbind': {
        service.unbind(session)
        return { kind: 'success', text: 'dataset binding cleared' }
      }
      default:
        return { kind: 'error', text: USAGE }
    }
  } catch (error) {
    return { kind: 'error', text: error instanceof DatasetsError ? `${error.message} [${error.code}]` : String(error) }
  }
}

/**
 * The `/datasets` command definition and registration. The caller's context
 * decides the layer the command lands in: the companion row calls this with
 * its preset-scoped context, so the command exists exactly for the sessions
 * of every preset that names the row.
 * @param ctx - the registering context (the companion's command-injected child).
 * @param service - the probed core service.
 */
export function registerDatasetsSlash(ctx: Context, service: DatasetsService): void {
  ctx.commands.register({
    name: 'datasets',
    description:
      'Session dataset binding and browsing: /datasets list [dataset] | show <dataset> [item] | '
      + 'bind <repoPath> [--datasets a,b] [--layers x,y] | unbind. '
      + 'bind without --layers keeps the agent to each dataset\'s model-facing layers; naming layers opens exactly those.',
    // WITHOUT this descriptor a capable composer has no reason to believe the
    // command takes anything: picking `/datasets` from the completion strip
    // submits a bare invocation and leaves everything the human typed after it
    // in the MESSAGE body, so `bind <path>` arrived here as an empty argument
    // list and answered with the usage line (found during T36's live pass).
    // Declaring the free-form input is what makes the composer forward the
    // rest of the line; `rawInput` below is unchanged either way.
    input: {
      hint: 'list [dataset] | show <dataset> [item] | bind <repoPath> [--datasets a,b] [--layers x,y] | unbind',
    },
    handler: invocation => handleDatasetsCommand(service, invocation),
  })
}

/** Parsed slash flags: `--datasets a,b` / `--layers x,y` plus positionals. */
function parseSlashFlags(args: readonly string[]): { positionals: string[]; datasets?: string[]; layers?: string[] } {
  const positionals: string[] = []
  let datasets: string[] | undefined
  let layers: string[] | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--datasets' || arg === '--layers') {
      const value = args[i + 1]
      if (value === undefined) continue
      i++
      const list = value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
      if (arg === '--datasets') datasets = list
      else layers = list
    } else {
      positionals.push(arg)
    }
  }
  return {
    positionals,
    ...(datasets !== undefined ? { datasets } : {}),
    ...(layers !== undefined ? { layers } : {}),
  }
}
