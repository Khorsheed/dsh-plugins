/**
 * Read-only regression of `readKimiTranscript` over real kimi wire logs
 * (member-self-started-rounds A③). For each session directory given:
 *
 *  1. with no own rounds — the option absent, or an empty set — the transcript
 *     must equal the baseline reader's (the build before the change) line for
 *     line: logs without `self` start records keep the 11-01 fold exactly;
 *  2. with every task notification on the wire counted as an own round, it
 *     reports how many lines moved to another turn (only the self rounds and
 *     what follows them may move).
 *
 * Prints counts and hashes only — never wire content. Nothing is written.
 *
 * Usage (from the package directory):
 *   pnpm exec tsx tests/transcript-regression.ts --baseline <old session-view.ts> <sessionDir>...
 * @module @khorsheed/dsh-local-agent-kimi/tests/transcript-regression
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readKimiTranscript, type KimiSessionTranscript } from '../src/session-view.ts'

type Reader = (sessionDir: string) => Promise<KimiSessionTranscript>

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) =>
  item instanceof Set ? [...item].sort() : item instanceof Map ? [...item.entries()] : item)).digest('hex').slice(0, 12)

async function notificationIds(sessionDir: string): Promise<string[]> {
  const wire = await readFile(join(sessionDir, 'agents', 'main', 'wire.jsonl'), 'utf8')
  const ids: string[] = []
  for (const raw of wire.split('\n')) {
    if (!raw.includes('"turn.prompt"')) continue
    try {
      const row = JSON.parse(raw) as { type?: unknown; origin?: { kind?: unknown; notificationId?: unknown } }
      if (row.type === 'turn.prompt' && row.origin?.kind !== 'user' && typeof row.origin?.notificationId === 'string') ids.push(row.origin.notificationId)
    } catch { /* a partial line */ }
  }
  return ids
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const at = args.indexOf('--baseline')
  if (at < 0 || args[at + 1] === undefined) throw new Error('usage: tests/transcript-regression.ts --baseline <old session-view.ts> <sessionDir>...')
  const baseline = (await import(pathToFileURL(args[at + 1]!).href) as { readKimiTranscript: Reader }).readKimiTranscript
  const dirs = args.filter((_arg, index) => index !== at && index !== at + 1)
  let failed = false
  for (const dir of dirs) {
    const name = dir.split('session_').pop()?.slice(0, 8) ?? dir
    const before = await baseline(dir)
    const absent = await readKimiTranscript(dir)
    const empty = await readKimiTranscript(dir, { ownRounds: new Set() })
    const same = hash(before) === hash(absent) && hash(before) === hash(empty)
    const ids = await notificationIds(dir)
    const own = await readKimiTranscript(dir, { ownRounds: new Set(ids) })
    const moved = own.lines.filter((line, index) => line.turn !== absent.lines[index]?.turn).length
    const shapeKept = own.lines.length === absent.lines.length
      && own.lines.every((line, index) => hash({ ...line, turn: 0 }) === hash({ ...absent.lines[index], turn: 0 }))
    const turns = (transcript: KimiSessionTranscript): number => new Set(transcript.lines.map(line => line.turn)).size
    console.log(`${name}: lines ${absent.lines.length}, usage records ${absent.usageRecords.length}, turns ${turns(absent)}; `
      + `no own rounds ${same ? 'IDENTICAL to baseline' : 'DIFFERS from baseline'} (${hash(before)}); `
      + `self notifications ${ids.length} → all own: turns ${turns(own)}, ${moved} lines renumbered, content ${shapeKept ? 'unchanged' : 'CHANGED'}`)
    if (!same || !shapeKept) failed = true
  }
  if (failed) process.exitCode = 1
}

await main()
