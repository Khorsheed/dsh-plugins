#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { fileURLToPath } from 'node:url'

const lane = process.argv[2]
if (lane !== 'unit' && lane !== 'integration' && lane !== 'all') {
  process.stderr.write('usage: run-test-lane.mjs <unit|integration|all>\n')
  process.exit(2)
}

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const selfSpec = 'tests/self-restart-guard.spec.ts'
const pureSpecs = [
  'tests/browser-handoff.client.spec.ts',
  'tests/browser-handoff.spec.ts',
  'tests/patch.spec.ts',
  'tests/preset-derive.spec.ts',
  'tests/state-files.spec.ts',
  'tests/transition.spec.ts',
]

const unitTasks = [
  { name: 'pure', args: pureSpecs },
  {
    name: 'self-unit', args: [selfSpec, '-t', '^(state core|durable launch cutover state|cordis service \\(real git repo\\)|invariant|pack smoke)'],
  },
]
const integrationTasks = [
  ...Array.from({ length: 4 }, (_, index) => ({
    name: `supervise-${index + 1}-of-4`,
    args: [selfSpec, '-t', '^supervise'],
    env: {
      ANKH_GUARD_TEST_SHARD_COUNT: '4',
      ANKH_GUARD_TEST_SHARD_INDEX: String(index),
    },
  })),
  {
    name: 'self-process', args: [selfSpec, '-t', '^(process ownership discovery|CLI|composition preflight gate|restart context injection)'],
  },
  { name: 'lifecycle-drift', args: ['tests/process-lifecycle.spec.ts', 'tests/preflight-drift.spec.ts'] },
]
const tasks = lane === 'unit' ? unitTasks : lane === 'integration' ? integrationTasks : [...integrationTasks, ...unitTasks]

if (lane !== 'unit') {
  const cli = fileURLToPath(new URL('../lib/cli.js', import.meta.url))
  let gitHead = 'unavailable'
  let activeTestProcesses = -1
  try { gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
  try {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
      .split('\n').flatMap(line => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
        return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }]
      })
    const byPid = new Map(rows.map(row => [row.pid, row]))
    const ownChain = new Set([process.pid])
    let cursor = byPid.get(process.pid)?.ppid
    while (cursor !== undefined && cursor > 0 && !ownChain.has(cursor)) {
      ownChain.add(cursor)
      cursor = byPid.get(cursor)?.ppid
    }
    activeTestProcesses = rows.filter(row => !ownChain.has(row.pid) && /(?:vitest|gate\.mts|run-test-lane)/.test(row.command)).length
  } catch {}
  process.stdout.write(`${JSON.stringify({
    event: 'ankh-guard-integration-baseline',
    measuredAt: new Date().toISOString(),
    logicalCpuCount: cpus().length,
    node: process.version,
    packageManager: process.env.npm_config_user_agent ?? 'unknown',
    loadAverage: loadavg(),
    activeTestProcesses,
    gitHead,
    cli,
    cliSha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
  })}\n`)
}

const maxParallel = lane === 'unit' ? 2 : 4
// Match the repository preset for spawn-heavy tests without adding a package
// vitest.config.ts: the public ankh-guard mirror owns its standalone config.
// Individual lifecycle cases keep their larger explicit budgets.
const defaultTestTimeoutMs = 30_000
let cursor = 0
let failed = false
let passed = 0

async function worker() {
  while (cursor < tasks.length) {
    const task = tasks[cursor++]
    const started = performance.now()
    const child = spawn(process.execPath, [vitest, 'run', '--testTimeout', String(defaultTestTimeoutMs), ...task.args], {
      env: { ...process.env, ...task.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => chunks.push(chunk))
    const result = await new Promise(resolve => {
      let spawnError
      child.once('error', error => { spawnError = error })
      // `exit` can precede the final stdout/stderr pipe reads. `close` is the
      // lifecycle boundary that proves both the process and its stdio closed.
      child.once('close', (code, signal) => resolve({ code: code ?? 1, signal, spawnError }))
    })
    if (result.spawnError !== undefined) chunks.push(Buffer.from(`\nrunner spawn error: ${String(result.spawnError)}\n`))
    const output = Buffer.concat(chunks).toString('utf8')
    const outcome = result.signal === null ? `exit ${result.code}` : `signal ${result.signal}`
    process.stdout.write(`\n===== ${lane}:${task.name} (${Math.round(performance.now() - started)}ms, ${outcome}) =====\n${output}`)
    if (result.code !== 0 || result.spawnError !== undefined) failed = true
    const count = /Tests\s+(\d+) passed/.exec(output)
    if (count === null) failed = true
    else passed += Number(count[1])
  }
}

await Promise.all(Array.from({ length: Math.min(maxParallel, tasks.length) }, () => worker()))
const expected = lane === 'unit' ? 54 : lane === 'integration' ? 128 : 182
if (passed !== expected) {
  process.stderr.write(`\n${lane} lane inventory mismatch: expected ${expected} passing tests, observed ${passed}\n`)
  failed = true
}
if (failed) process.exit(1)
