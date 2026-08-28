#!/usr/bin/env node
/**
 * `dsh-datasets` CLI — the script/ops face of the datasets service: every
 * read verb the model tools have (same semantics, same parameters), plus the
 * human-only maintenance verbs (binding writes, `worktree prune`). Run from
 * source: `node --import tsx/esm src/cli.ts <command>`; as a published
 * package: the `dsh-datasets` bin or `node lib/cli.js <command>`.
 *
 * Exit codes: 0 ok, 1 operational failure, 2 usage error.
 *
 * Commands:
 *   list / show / describe / read / snapshot — the read verbs (JSON on stdout;
 *     `read` prints the raw file content, `worktree path` prints the path)
 *   worktree path    — acquire the managed whole-layer view (sparse-checkout-limited)
 *   worktree prune   — unlock + remove every managed worktree of a repository
 *   validate         — shape + author-hygiene report (errors exit 1, warnings
 *     never block: mixed-sensitivity undeclared modelFacing, sensitive-looking
 *     item.json field names, files uncovered by any layer or register entry)
 *   bind / unbind    — write a session's binding (the plugin-owned store is
 *     read per call, so binding a LIVE session is race-free)
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readBinding, validateBinding, writeBinding } from './binding.ts'
import { DatasetsError } from './dataset.ts'
import { resolveStateRoot, resolveWorktreeRoot } from './defaults.ts'
import { formatList, formatShow, formatValidate, formatWarnings } from './format.ts'
import { createDatasetsService, resolveScope, type DatasetScope } from './service.ts'
import { pruneManagedWorktrees } from './worktree.ts'

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
  worktree path --dataset D [--repo R] [--commit C] [--layers a,b] [--worktree-root DIR]
  validate [--repo R] [--dataset D] [--commit C]
  worktree prune --repo R [--worktree-root DIR]
  bind --session ID --repo R [--datasets a,b] [--layers x,y] [--state-root DIR]
  unbind --session ID [--state-root DIR]
  binding --session ID [--state-root DIR]
flags:
  --repo R           dataset repository (default: $DSH_DATASETS_REPO)
  --commit C         pinned commit (default: HEAD)
  --dataset D        dataset id
  --item I           item id
  --layer L          layer name (read)
  --path P           layer-relative file path (read)
  --layers a,b       layer selection (worktree path) / binding whitelist (bind)
  --datasets a,b     binding dataset whitelist (bind)
  --session ID       session id (bind/unbind/binding)
  --worktree-root DIR  managed worktree root (default: $DSH_HOME/state/datasets/worktrees)
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

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const list = value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
  return list.length === 0 ? undefined : list
}

/**
 * Run one CLI invocation.
 * @param argv - arguments after the bin name.
 * @param io - output sinks.
 * @param env - environment (injectable for tests).
 * @returns the process exit code.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const parsed = parse(argv)
  if ('error' in parsed) {
    io.stderr(parsed.error)
    return 2
  }
  const { command, flags } = parsed
  const worktreeRoot = resolveWorktreeRoot(flags['worktree-root'])
  const bindingsRoot = join(resolveStateRoot(flags['state-root']), 'bindings')
  const service = createDatasetsService({ worktreeRoot, bindingsRoot })
  // Read verbs run as the operator (a human at their own machine — the
  // whitelist constrains agent tools and worktree materialization, not this
  // CLI). worktree path keeps the non-operator scope: it is a boundary.
  const scope = (operator = true): DatasetScope => ({
    ...resolveScope(
      flags['repo'] !== undefined ? { repo: flags['repo'] } : {},
      undefined,
      env['DSH_DATASETS_REPO'],
    ),
    ...(operator ? { operator: true as const } : {}),
  })
  const verb = command.join(' ')

  try {
    switch (verb) {
      case 'list': {
        const result = await service.list(scope(), flags['dataset'], flags['commit'])
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
        const result = await service.show(scope(), dataset, flags['item'], flags['commit'])
        if (result.dataset.warnings.length > 0) io.stderr(`${formatWarnings(result.dataset.warnings)}\n`)
        io.stdout(`${formatShow(result)}\n`)
        return 0
      }
      case 'describe': {
        const dataset = flags['dataset']
        if (dataset === undefined) return usageError(io, 'describe requires --dataset D')
        // show carries the same raw descriptor plus the summary (warnings ride it).
        const result = await service.show(scope(), dataset, undefined, flags['commit'])
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
        const result = await service.read(scope(), {
          dataset, item, layer, path,
          ...(flags['commit'] !== undefined ? { commit: flags['commit'] } : {}),
        })
        io.stdout(result.content)
        return 0
      }
      case 'snapshot': {
        const dataset = flags['dataset']
        if (dataset === undefined) return usageError(io, 'snapshot requires --dataset D')
        const result = await service.snapshot(scope(), dataset, flags['commit'])
        io.stdout(`${JSON.stringify(result)}\n`)
        return 0
      }
      case 'worktree path': {
        const dataset = flags['dataset']
        if (dataset === undefined) return usageError(io, 'worktree path requires --dataset D')
        const result = await service.worktreePath(scope(false), dataset, {
          ...(flags['commit'] !== undefined ? { commit: flags['commit'] } : {}),
          ...(csv(flags['layers']) !== undefined ? { layers: csv(flags['layers']) ?? [] } : {}),
        })
        io.stdout(`${result.path}\n`)
        return 0
      }
      case 'validate': {
        const result = await service.validate(scope(), flags['dataset'])
        io.stdout(`${formatValidate(result)}\n`)
        return result.datasets.some(dataset => dataset.errors.length > 0) ? 1 : 0
      }
      case 'worktree prune': {
        const repo = flags['repo'] ?? env['DSH_DATASETS_REPO']
        if (repo === undefined || repo === '') return usageError(io, 'worktree prune requires --repo R')
        const removed = await pruneManagedWorktrees(repo, worktreeRoot)
        io.stdout(removed.length === 0 ? 'no managed worktrees\n' : `removed ${removed.length} managed worktree(s):\n${removed.map(path => `  ${path}`).join('\n')}\n`)
        return 0
      }
      case 'bind': {
        const session = flags['session']
        const repo = flags['repo']
        if (session === undefined || repo === undefined) return usageError(io, 'bind requires --session ID --repo R')
        const binding = validateBinding({
          repoPath: repo,
          ...(csv(flags['datasets']) !== undefined ? { datasets: csv(flags['datasets']) } : {}),
          ...(csv(flags['layers']) !== undefined ? { layers: csv(flags['layers']) } : {}),
        })
        writeBinding(bindingsRoot, session, binding)
        io.stdout(`bound session ${session} to ${binding.repoPath}\n`)
        return 0
      }
      case 'unbind': {
        const session = flags['session']
        if (session === undefined) return usageError(io, 'unbind requires --session ID')
        writeBinding(bindingsRoot, session, null)
        io.stdout(`cleared the binding of session ${session}\n`)
        return 0
      }
      case 'binding': {
        const session = flags['session']
        if (session === undefined) return usageError(io, 'binding requires --session ID')
        const binding = readBinding(bindingsRoot, session)
        io.stdout(`${binding === undefined ? 'null' : JSON.stringify(binding)}\n`)
        return 0
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
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void runCli(process.argv.slice(2), {
    stdout: line => process.stdout.write(line),
    stderr: line => process.stderr.write(line),
  }).then((code) => { process.exitCode = code })
    .catch((error: unknown) => {
      process.stderr.write(`dsh-datasets: ${String(error)}\n`)
      process.exitCode = 1
    })
}
