/**
 * The `/datasets` slash face — the human interface over {@link DatasetsService},
 * a thin adapter exactly like the CLI: the handler parses `invocation.rawInput`
 * itself. Every set is addressed by its registry reference `<id>/<set>`, the
 * same one the model tools take (bind is retired and says where registration
 * lives).
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
import { DatasetsError } from './dataset.ts'
import { formatList, formatShow, formatWarnings } from './format.ts'
import type { DatasetsService } from './service.ts'
import { registryScope } from './tool.ts'

const USAGE = 'usage: /datasets list [<id>/<set>] | show <id>/<set> [item]'

/** What `/datasets bind` answers now that binding is retired. */
export const BIND_RETIRED = '/datasets bind is retired: dataset repositories are registered once per deployment now. '
  + 'Open the Datasets tab and use Register repository (or run `dsh-datasets register --repo <path>`); agents then '
  + 'address each set as <id>/<set>.'

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
 * @param service - the datasets service.
 * @param invocation - the command invocation.
 */
export async function handleDatasetsCommand(service: DatasetsService, invocation: CommandInvocation): Promise<CommandResult> {
  const refusal = await slashGrantRefusal(invocation)
  if (refusal !== null) return refusal
  const parts = invocation.rawInput.trim().split(/\s+/).filter(part => part !== '')
  const verb = parts[0]
  const flags = parseSlashFlags(parts.slice(1))
  try {
    switch (verb) {
      case 'list': {
        const ref = flags.positionals[0]
        if (ref === undefined) {
          const rows = await service.registry.rows()
          const lines = rows.flatMap(row => row.problem !== undefined
            ? [`${row.entry.id}: ${row.problem}`]
            : row.sets.map(set => `${set.ref}  ${set.title}`))
          return { kind: 'success', text: lines.length === 0 ? 'no dataset repository is registered (Datasets tab → Register repository)' : lines.join('\n') }
        }
        const resolved = await service.registry.resolveRef(ref)
        const result = await service.list(registryScope(resolved), resolved.set)
        const warnings = result.kind === 'datasets'
          ? result.datasets.flatMap(dataset => dataset.warnings)
          : result.dataset.warnings
        const suffix = warnings.length === 0 ? '' : `\n${formatWarnings(warnings)}`
        return { kind: 'success', text: `${formatList(result)}${suffix}` }
      }
      case 'show': {
        const ref = flags.positionals[0]
        if (ref === undefined) return { kind: 'error', text: 'usage: /datasets show <id>/<set> [item]' }
        const resolved = await service.registry.resolveRef(ref)
        const result = await service.show(registryScope(resolved), resolved.set, flags.positionals[1])
        const suffix = result.dataset.warnings.length === 0 ? '' : `\n${formatWarnings(result.dataset.warnings)}`
        return { kind: 'success', text: `${formatShow(result)}${suffix}` }
      }
      case 'bind': {
        // Per-session binding is retired (T73): what agents may use is the
        // deployment's registry, written by a person on the Datasets tab.
        return { kind: 'error', text: BIND_RETIRED }
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
      'Dataset browsing: /datasets list [<id>/<set>] | show <id>/<set> [item]. '
      + 'Repositories are registered on the Datasets tab.',
    // WITHOUT this descriptor a capable composer has no reason to believe the
    // command takes anything: picking `/datasets` from the completion strip
    // submits a bare invocation and leaves everything the human typed after it
    // in the MESSAGE body, so `bind <path>` arrived here as an empty argument
    // list and answered with the usage line (found during T36's live pass).
    // Declaring the free-form input is what makes the composer forward the
    // rest of the line; `rawInput` below is unchanged either way.
    input: {
      hint: 'list [<id>/<set>] | show <id>/<set> [item]',
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
