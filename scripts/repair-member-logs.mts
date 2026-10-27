/**
 * Check — and with `--apply`, repair — the stored logs of local-agent member
 * child sessions (claude, codex, kimi, dsh CLIs) that the host's strict reader
 * rejects. The member write guard (packages/local-agent/src/child-log-guard.ts)
 * keeps new writes valid; this is the after-the-fact tool for logs written
 * before it, or by a shape it did not foresee.
 *
 *   pnpm repair:member-logs              # report every member log and whether it reads
 *   pnpm repair:member-logs --apply      # repair the unreadable ones nobody holds
 *   pnpm repair:member-logs --quarantine # list the guard's diverted events
 *
 * Repair rules (each verified on 10-24 … 10-27 incidents): a turn left open
 * before the next turn/start gets an interrupted turn/end (before a restart's
 * end-seed marker); events naming a turn the log never opened, while another
 * is open, join the open turn; events of an already closed turn are dropped;
 * steps holding only kimi's prefixed orphan duplicates of a logged call, or
 * only a ☑/▶/☐ plan, are dropped; steps renumber by position; seqs become
 * contiguous and every reference follows; each tool result points at its own
 * call. A repaired log is written only if the host's strict restore accepts
 * it, with the host's own framing (a header frame, then an event frame), after
 * a backup outside the session directory, and never while a process holds it.
 *
 * Env: DSH_HOME (default ~/.dsh-official), DSH_HARNESS (default ~/code/deepseek-harness).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

type Row = { type: string; seq: number; time: number; data?: unknown; surfaceOp?: unknown; sourceEventSeqs?: number[]; [key: string]: unknown }
type Data = Record<string, unknown>

/** Providers that run inside the host: their children are not member mirrors. */
const IN_PROCESS = new Set(['spawn', 'fork'])
const PREFIXED = /^\d+:/
const PLAN_LINE = /^[☑▶☐] /

const dataOf = (row: Row): Data => (typeof row.data === 'object' && row.data !== null ? row.data as Data : {})

/**
 * Repair one member log's events by the rules above.
 * @param rows - the stored events (header excluded), in order.
 * @returns the repaired events and what changed.
 */
export function repairMemberLog(rows: readonly Row[]): { rows: Row[]; changes: string[] } {
  const changes: string[] = []
  let out: Row[] = []
  let open: number | null = null
  const closed = new Set<number>()
  const started = new Set<number>()
  let relabeled = 0, dropped = 0
  for (const original of rows) {
    const row: Row = structuredClone(original)
    const data = dataOf(row)
    if (row.type === 'turn/start' && open !== null) {
      const at = out.at(-1)?.type === 'session/end-seed' ? out.length - 1 : out.length
      out.splice(at, 0, { type: 'turn/end', seq: Number.NaN, time: out[at - 1]?.time ?? row.time, data: { turn: open, reason: { kind: 'interrupted' } } })
      changes.push(`closed turn ${open}`)
      closed.add(open)
    }
    const turn = typeof data['turn'] === 'number' ? data['turn'] : undefined
    if (row.type !== 'turn/start' && row.type !== 'turn/end' && open !== null && turn !== undefined && turn !== open && !closed.has(turn) && !started.has(turn)) {
      data['turn'] = open
      relabeled += 1
    }
    if (row.type !== 'turn/start' && row.type !== 'turn/end' && typeof data['turn'] === 'number' && closed.has(data['turn'])) { dropped += 1; continue }
    if (row.type === 'turn/start' && turn !== undefined) { open = turn; started.add(turn) }
    if (row.type === 'turn/end') { if (turn !== undefined) closed.add(turn); open = null }
    out.push(row)
  }
  if (relabeled > 0) changes.push(`moved ${relabeled} events into the open turn`)
  if (dropped > 0) changes.push(`dropped ${dropped} events of closed turns`)

  // Orphan duplicate and plan-only steps.
  const bare = new Set<string>()
  for (const row of out) {
    const data = dataOf(row)
    if (row.type === 'tool/call' && !PREFIXED.test(String(data['callId']))) bare.add(`${String(data['turn'])}\0${String(data['callId'])}`)
  }
  const kept: Row[] = []
  let removedSteps = 0
  for (let i = 0; i < out.length; i += 1) {
    const row = out[i]!
    const data = dataOf(row)
    if (row.type === 'step/start') {
      let j = i
      while (j < out.length && !(out[j]!.type === 'step/end' && dataOf(out[j]!)['step'] === data['step'] && dataOf(out[j]!)['turn'] === data['turn'])) j += 1
      const blocks = out.slice(i, j + 1).filter(r => r.type === 'assistant/message')
        .flatMap(r => ((dataOf(r)['message'] as Data | undefined)?.['content'] as Data[] | undefined) ?? [])
      const orphan = blocks.length > 0 && blocks.every(b => b['type'] === 'tool-call' && PREFIXED.test(String(b['id']))
        && bare.has(`${String(data['turn'])}\0${String(b['id']).replace(PREFIXED, '')}`))
      const plan = blocks.length > 0 && blocks.every(b => b['type'] === 'reasoning'
        && String(b['text'] ?? '').split('\n').filter(line => line.trim() !== '').every(line => PLAN_LINE.test(line)))
      if (orphan || plan) { removedSteps += 1; i = j; continue }
    }
    kept.push(row)
  }
  out = kept
  if (removedSteps > 0) changes.push(`dropped ${removedSteps} orphan duplicate or plan-only steps`)

  // Steps by position.
  let turn: unknown, next = 0, current: [unknown, number] | undefined, renumbered = 0
  for (const row of out) {
    const data = dataOf(row)
    if (row.type === 'turn/start') { turn = data['turn']; next = 0; current = undefined }
    if (row.type === 'step/start' && data['turn'] === turn) { next += 1; current = [data['step'], next] }
    if (typeof data['step'] === 'number' && data['turn'] === turn && current !== undefined && data['step'] === current[0] && current[0] !== current[1]) {
      data['step'] = current[1]
      renumbered += 1
    }
    if (row.type === 'step/end' && data['turn'] === turn) current = undefined
  }
  if (renumbered > 0) changes.push(`renumbered ${renumbered} step fields`)

  // Contiguous seqs; references follow.
  const first = out.find(row => !Number.isNaN(row.seq))?.seq ?? 0
  const remap = new Map<number, number>()
  out.forEach((row, index) => { if (!Number.isNaN(row.seq)) remap.set(row.seq, first + index); row.seq = first + index })
  const fix = (seq: number): number => remap.get(seq) ?? seq
  for (const row of out) {
    if (Array.isArray(row.sourceEventSeqs)) row.sourceEventSeqs = row.sourceEventSeqs.map(fix)
    const data = dataOf(row)
    for (const key of ['sourceEventSeqs', 'messageSeqs']) if (Array.isArray(data[key])) data[key] = (data[key] as number[]).map(fix)
    const op = row.surfaceOp
    if (typeof op === 'object' && op !== null) {
      for (const key of ['startSeq', 'endSeq']) if (typeof (op as Data)[key] === 'number') (op as Data)[key] = fix((op as Data)[key] as number)
    }
  }
  if (out.length !== rows.length || remap.size !== rows.length || [...remap].some(([from, to]) => from !== to)) {
    if (!changes.includes('reassigned seqs')) changes.push('reassigned seqs')
  }

  // Each tool result points at its own call.
  const calls = new Map<string, number>()
  let repointed = 0
  for (const row of out) {
    const data = dataOf(row)
    if (row.type === 'tool/call') calls.set(`${String(data['turn'])}\0${String(data['callId'])}`, row.seq)
    if (row.type === 'tool/result' && Array.isArray(row.sourceEventSeqs) && row.sourceEventSeqs.length > 0) {
      const target = calls.get(`${String(data['turn'])}\0${String((data['message'] as Data | undefined)?.['toolCallId'])}`)
      if (target !== undefined && (row.sourceEventSeqs.length !== 1 || row.sourceEventSeqs[0] !== target)) { row.sourceEventSeqs = [target]; repointed += 1 }
    }
  }
  if (repointed > 0) changes.push(`repointed ${repointed} tool results`)
  return { rows: out, changes }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh-official')
  const harness = process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness')
  if (args.has('--quarantine')) {
    const dir = join(dshHome, 'local-agent', 'quarantine')
    if (!existsSync(dir)) { console.log('no diverted events'); return }
    for (const file of readdirSync(dir).filter(name => name.endsWith('.jsonl'))) {
      const entries = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { at: number; type: string; reason: string })
      const reasons = new Map<string, number>()
      for (const entry of entries) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1)
      console.log(`${file.replace(/\.jsonl$/, '')}: ${entries.length} diverted, last ${new Date(entries.at(-1)!.at).toISOString()}`)
      for (const [reason, count] of reasons) console.log(`  ${count} × ${reason}`)
    }
    return
  }
  const load = (path: string) => import(pathToFileURL(join(harness, path)).href)
  const zstd = await load('packages/session/session-persistence-jsonl/src/zstd.ts') as {
    compressZstdFrame(input: string): Promise<Buffer>
    decompressZstdFrame(input: Buffer): Promise<Buffer>
    scanZstdFrames(buffer: Buffer): { frames: { start: number; end: number }[] }
  }
  // The format catalog may bind the session module's source or its build:
  // plugin event types (room/*, local-agent/stream, …) register on every copy.
  const knownTypeSets = (await Promise.all(['packages/core/session/src/index.ts', 'packages/core/session/lib/index.js', 'packages/core/session/src/known-event-types.ts']
    .map(path => load(path).catch(() => undefined))) as ({ KNOWN_SESSION_EVENT_TYPES?: Set<string> } | undefined)[])
    .map(module => module?.KNOWN_SESSION_EVENT_TYPES).filter((set): set is Set<string> => set !== undefined)
  const catalog = (await load('packages/session/session-format-catalog/src/index.ts') as {
    sessionFormatCatalog: { createRestore(header: unknown, options: unknown): { decodeRow(row: unknown): void; finish(): { events: unknown[] } } }
  }).sessionFormatCatalog
  const readLog = async (file: string): Promise<string> => {
    const buffer = readFileSync(file)
    let text = ''
    for (const [index, frame] of zstd.scanZstdFrames(buffer).frames.entries()) {
      const plain = await zstd.decompressZstdFrame(buffer.subarray(frame.start, frame.end))
      // The host's own physical rule: the first frame is exactly the header line.
      if (index === 0 && (plain.length === 0 || plain.indexOf(0x0a) !== plain.length - 1)) throw new Error('first frame is not exactly one header line')
      text += plain.toString('utf8')
    }
    return text
  }
  const strictReadFailure = (header: unknown, rows: readonly Row[]): string | undefined => {
    for (const row of rows) if (/^(local-agent|room|subagent)\//.test(row.type)) for (const set of knownTypeSets) set.add(row.type)
    try {
      const reader = catalog.createRestore(header, { recovery: 'strict', validation: 'current' })
      for (const row of rows) reader.decodeRow(row)
      reader.finish()
      return undefined
    } catch (error) { return error instanceof Error ? error.message : String(error) }
  }
  const held = (dir: string): boolean => spawnSync('lsof', [join(dir, 'session.lock')], { stdio: 'ignore' }).status === 0
  const backupRoot = join(homedir(), 'dsh-log-repair-backups', new Date().toISOString().replace(/[:.]/g, '-'))
  const root = join(dshHome, 'sessions')
  let total = 0, broken = 0, repaired = 0
  for (const project of readdirSync(root)) {
    for (const id of readdirSync(join(root, project))) {
      const dir = join(root, project, id)
      const file = join(dir, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      let text: string
      try { text = await readLog(file) } catch (error) { console.log(`${id}: unreadable frames (${String(error)})`); continue }
      const [headLine, ...lines] = text.split('\n').filter(Boolean)
      const rows = lines.map(line => JSON.parse(line) as Row)
      const descriptor = rows.find(row => row.type === 'subagent/descriptor')
      const provider = (descriptor?.data as Data | undefined)?.['provider']
      if (typeof provider !== 'string' || IN_PROCESS.has(provider)) continue
      total += 1
      const header = JSON.parse(headLine!) as unknown
      const failure = strictReadFailure(header, rows)
      if (failure === undefined) continue
      broken += 1
      const { rows: fixed, changes } = repairMemberLog(rows)
      const after = strictReadFailure(header, fixed)
      console.log(`${id} (${provider}): ${failure}`)
      console.log(`  repair: ${changes.join('; ') || 'nothing to change'} → ${after === undefined ? 'reads' : `still fails: ${after}`}`)
      if (!args.has('--apply') || after !== undefined) continue
      if (held(dir)) { console.log('  skipped: held by a running process'); continue }
      const body = fixed.map(row => JSON.stringify(row)).join('\n') + '\n'
      const encoded = Buffer.concat([await zstd.compressZstdFrame(headLine + '\n'), await zstd.compressZstdFrame(body)])
      mkdirSync(join(backupRoot, id), { recursive: true })
      copyFileSync(file, join(backupRoot, id, 'session.v4.jsonl.zstd'))
      if (held(dir)) { console.log('  skipped: became held'); continue }
      writeFileSync(`${file}.tmp`, encoded)
      renameSync(`${file}.tmp`, file)
      repaired += 1
      console.log(`  repaired (backup ${join(backupRoot, id)})`)
    }
  }
  console.log(`member logs: ${total}, unreadable: ${broken}${args.has('--apply') ? `, repaired: ${repaired}` : ' (dry run; --apply to repair)'}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
