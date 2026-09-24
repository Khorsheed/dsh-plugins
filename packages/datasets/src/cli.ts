#!/usr/bin/env node
/**
 * `dsh-datasets` CLI — the script/ops face of the datasets service: every
 * read verb the model tools have (same semantics, same parameters), plus the
 * human-only maintenance verbs (the dataset registry, the legacy-binding import). Run from
 * source: `node --import tsx/esm src/cli.ts <command>`; as a published
 * package: the `dsh-datasets` bin or `node lib/cli.js <command>`.
 *
 * Exit codes: 0 ok, 1 operational failure, 2 usage error.
 *
 * Commands:
 *   list / show / describe / read / snapshot — the read verbs (JSON on stdout;
 *     `read` prints the raw file content, `worktree path` prints the path)
 *   worktree path    — materialize the whole-layer view (`git archive`, read-only,
 *     content-addressed; the verb keeps its historical name)
 *   validate         — shape + judgeability + author-hygiene report (errors
 *     exit 1: descriptor shape, and an item's rubric with no leaves, a leaf
 *     missing a required field, an unknown kind, or a polarity that disagrees
 *     with its weight sign; warnings never block: mixed-sensitivity undeclared
 *     modelFacing, sensitive-looking item.json field names, files uncovered by
 *     any layer or register entry, a missing canary, objective leaves with no
 *     probe source, a dangling rubric.md leaf reference)
 *   registry / register / update / unregister / import-bindings — the
 *     deployment's dataset registry (human-only writes; agents resolve
 *     `<id>/<set>` through it)
 *   bind             — retired: prints how to register instead
 *
 * `--repo` takes a registry id or a path; without it the only registration
 * is used, and zero or several registrations are refused.
 */
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatasetsError } from './dataset.ts'
import { resolveMaterializedRoot, resolveStateRoot } from './defaults.ts'
import { formatList, formatShow, formatValidate, formatWarnings } from './format.ts'
import { createDatasetsService, resolveOperatorScope, type DatasetScope } from './service.ts'
import { registryPathOf, type RegistrySet } from './registry.ts'

/** stdout/stderr sink (injected so tests capture output). */
export interface CliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

const USAGE = `usage: dsh-datasets <command> [flags]
commands:
  list [--repo R] [--dataset D] [--commit C]
  show --dataset D [--item I] [--repo R] [--commit C]
  describe --dataset D [--repo R] [--commit C]
  read --dataset D --item I --layer L --path P [--repo R] [--commit C]
  snapshot --dataset D [--repo R] [--commit C]
  worktree path --dataset D [--repo R] [--commit C] [--layers a,b] [--materialized-root DIR]
  validate [--repo R] [--dataset D] [--commit C]
  registry [--state-root DIR]
  register --repo R [--id ID] [--tracked-ref B] [--set-layers set=a+b,…] [--authoring-checkout P] [--state-root DIR]
  update --id ID [--tracked-ref B] [--set-layers set=a+b,…] [--authoring-checkout P|none] [--state-root DIR]
  unregister --id ID [--state-root DIR]
  import-bindings [--state-root DIR]
flags:
  --repo R           registry id or repository path (default: the only registration)
  --commit C         pinned commit (default: the registration's latest, else HEAD)
  --dataset D        dataset id
  --item I           item id
  --layer L          layer name (read)
  --path P           layer-relative file path (read)
  --layers a,b       layer selection (worktree path)
  --id ID            registry id (the <id> of an agent's <id>/<set> reference)
  --tracked-ref B    the branch whose tip is «latest» (register default: main)
  --set-layers s=a+b,t=c   per-set agent-visible layers; a set left out sees
                     its model-facing layers and nothing else
  --authoring-checkout P   the working tree datasets_put_item writes to
                     (update: none clears it)
  --materialized-root DIR  materialized-layer root (default: $DSH_HOME/state/datasets/materialized)
  --state-root DIR     plugin state root (default: $DSH_HOME/state/datasets)
`

/** Parsed CLI invocation. */
interface Parsed {
  command: string[]
  flags: Record<string, string>
}

/**
 * Parse argv into a command path (positionals up to the first flag) and a
 * flag map. Every flag takes a value; `--help` short-circuits to usage.
 * @param argv - the raw argument vector (without node/script entries).
 * @returns the parse result, or an error message to show with usage.
 */
export function parse(argv: readonly string[]): { error: string } | Parsed {
  const command: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--help' || arg === '-h') return { error: USAGE }
    if (arg.startsWith('--')) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} requires a value\n\n${USAGE}` }
      flags[arg.slice(2)] = value
      i++
    } else {
      command.push(arg)
    }
  }
  if (command.length === 0) return { error: USAGE }
  return { command, flags }
}

/** Parse `set=a+b,other=c` into per-set layers. */
function setLayers(value: string | undefined): Record<string, RegistrySet> | undefined {
  if (value === undefined) return undefined
  const out: Record<string, RegistrySet> = {}
  for (const part of value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')) {
    const eq = part.indexOf('=')
    if (eq <= 0) throw new DatasetsError(`--set-layers expects set=a+b, got ${JSON.stringify(part)}`, 'SHAPE_INVALID')
    out[part.slice(0, eq)] = { layers: part.slice(eq + 1).split('+').map(layer => layer.trim()).filter(layer => layer !== '') }
  }
  return out
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const list = value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
  return list.length === 0 ? undefined : list
}

/**
 * Run one CLI invocation.
 * @param argv - arguments after the bin name.
 * @param io - output sinks.
 * @returns the process exit code.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parse(argv)
  if ('error' in parsed) {
    io.stderr(parsed.error)
    return 2
  }
  const { command, flags } = parsed
  const stateRoot = resolveStateRoot(flags['state-root'])
  const bindingsRoot = join(stateRoot, 'bindings')
  const service = createDatasetsService({
    materializedRoot: resolveMaterializedRoot(flags['materialized-root']),
    bindingsRoot,
    registryPath: registryPathOf(stateRoot),
  })
  // Read verbs run as the operator (a human at their own machine — the
  // whitelist constrains agent tools and worktree materialization, not this
  // CLI). worktree path keeps the non-operator scope: it is a boundary.
  const scope = async (operator = true): Promise<DatasetScope> => ({
    ...await resolveOperatorScope(service.registry, flags['repo']),
    ...(operator ? { operator: true as const } : {}),
  })
  const verb = command.join(' ')

  try {
    switch (verb) {
      case 'list': {
        const result = await service.list(await scope(), flags['dataset'], flags['commit'])
        const warnings = result.kind === 'datasets'
          ? result.datasets.flatMap(dataset => dataset.warnings)
          : result.dataset.warnings
        if (warnings.length > 0) io.stderr(`${formatWarnings(warnings)}\n`)
        io.stdout(`${formatList(result)}\n`)
        return 0
      }
      case 'show': {
        const dataset = flags['dataset']
        if (dataset === undefined) return usageError(io, 'show requires --dataset D')
        const result = await service.show(await scope(), dataset, flags['item'], flags['commit'])
        if (result.dataset.warnings.length > 0) io.stderr(`${formatWarnings(result.dataset.warnings)}\n`)
        io.stdout(`${formatShow(result)}\n`)
        return 0
      }
      case 'describe': {
        const dataset = flags['dataset']
        if (dataset === undefined) return usageError(io, 'describe requires --dataset D')
        // show carries the same raw descriptor plus the summary (warnings ride it).
        const result = await service.show(await scope(), dataset, undefined, flags['commit'])
        if (result.dataset.warnings.length > 0) io.stderr(`${formatWarnings(result.dataset.warnings)}\n`)
        io.stdout(`${JSON.stringify(result.descriptor, null, 2)}\n`)
        return 0
      }
      case 'read': {
        const dataset = flags['dataset']
        const item = flags['item']
        const layer = flags['layer']
        const path = flags['path']
        if (dataset === undefined || item === undefined || layer === undefined || path === undefined) {
          return usageError(io, 'read requires --dataset D --item I --layer L --path P')
        }
        const result = await service.read(await scope(), {
          dataset, item, layer, path,
          ...(flags['commit'] !== undefined ? { commit: flags['commit'] } : {}),
        })
        io.stdout(result.content)
        return 0
      }
      case 'snapshot': {
        const dataset = flags['dataset']
        if (dataset === undefined) return usageError(io, 'snapshot requires --dataset D')
        const result = await service.snapshot(await scope(), dataset, flags['commit'])
        io.stdout(`${JSON.stringify(result)}\n`)
        return 0
      }
      case 'worktree path': {
        const dataset = flags['dataset']
        if (dataset === undefined) return usageError(io, 'worktree path requires --dataset D')
        const result = await service.worktreePath(await scope(false), dataset, {
          ...(flags['commit'] !== undefined ? { commit: flags['commit'] } : {}),
          ...(csv(flags['layers']) !== undefined ? { layers: csv(flags['layers']) ?? [] } : {}),
        })
        io.stdout(`${result.path}\n`)
        return 0
      }
      case 'validate': {
        const result = await service.validate(await scope(), flags['dataset'])
        io.stdout(`${formatValidate(result)}\n`)
        return result.datasets.some(dataset => dataset.errors.length > 0) ? 1 : 0
      }
      case 'registry': {
        io.stdout(`${JSON.stringify(service.registry.entries(), null, 2)}\n`)
        return 0
      }
      case 'register': {
        const repo = flags['repo']
        if (repo === undefined) return usageError(io, 'register requires --repo R')
        const sets = setLayers(flags['set-layers'])
        const entry = await service.registry.register({
          path: repo,
          ...(flags['id'] !== undefined ? { id: flags['id'] } : {}),
          ...(flags['tracked-ref'] !== undefined ? { trackedRef: flags['tracked-ref'] } : {}),
          ...(sets !== undefined ? { sets } : {}),
          ...(flags['authoring-checkout'] !== undefined ? { authoringCheckout: flags['authoring-checkout'] } : {}),
        })
        io.stdout(`registered ${entry.id} (tracking ${entry.trackedRef})\n`)
        return 0
      }
      case 'update': {
        const id = flags['id']
        if (id === undefined) return usageError(io, 'update requires --id ID')
        const sets = setLayers(flags['set-layers'])
        const checkout = flags['authoring-checkout']
        const entry = await service.registry.update({
          id,
          ...(flags['tracked-ref'] !== undefined ? { trackedRef: flags['tracked-ref'] } : {}),
          ...(sets !== undefined ? { sets } : {}),
          ...(checkout !== undefined ? { authoringCheckout: checkout === 'none' ? null : checkout } : {}),
        })
        io.stdout(`updated ${entry.id} (tracking ${entry.trackedRef})\n`)
        return 0
      }
      case 'unregister': {
        const id = flags['id']
        if (id === undefined) return usageError(io, 'unregister requires --id ID')
        if (!service.registry.remove(id)) {
          io.stderr(`no registration ${JSON.stringify(id)}\n`)
          return 1
        }
        io.stdout(`unregistered ${id}\n`)
        return 0
      }
      case 'import-bindings': {
        const result = await service.registry.importBindings(bindingsRoot)
        io.stdout(`${JSON.stringify(result, null, 2)}\n`)
        return 0
      }
      case 'bind': {
        io.stderr('bind is retired: datasets are registered per deployment now — '
          + 'dsh-datasets register --repo R [--tracked-ref B] (or the Datasets tab → Register repository)\n')
        return 2
      }
      default:
        io.stderr(`unknown command ${JSON.stringify(verb)}\n\n${USAGE}`)
        return 2
    }
  } catch (error) {
    io.stderr(error instanceof DatasetsError ? `${error.message} [${error.code}]\n` : `${String(error)}\n`)
    return 1
  }
}

function usageError(io: CliIo, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`)
  return 2
}

// Direct invocation (`tsx src/cli.ts ...`) vs import by tests.
// Node resolves an ESM main module to its REAL path, so `import.meta.url` is
// the resolved file while `process.argv[1]` is the path as it was typed.
// Invoked through a symlink — pnpm's `.bin/<name>` link above all — the two
// never match, and the body below silently never runs: exit 0, no output,
// nothing to tell the caller the CLI did nothing. Resolve argv[1] the same
// way before comparing. A path that cannot be resolved keeps its literal
// form, which is exactly what the comparison used before.
let entryPath = process.argv[1]
if (entryPath !== undefined) {
  try { entryPath = realpathSync(entryPath) } catch { /* unresolvable — compare the literal path */ }
}
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void runCli(process.argv.slice(2), {
    stdout: line => process.stdout.write(line),
    stderr: line => process.stderr.write(line),
  }).then((code) => { process.exitCode = code })
    .catch((error: unknown) => {
      process.stderr.write(`dsh-datasets: ${String(error)}\n`)
      process.exitCode = 1
    })
}
