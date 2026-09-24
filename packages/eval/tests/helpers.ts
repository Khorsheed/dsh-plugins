import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliIo } from '../src/cli-core.ts'
import type { DatasetsRegistryFace } from '../src/faces.ts'

/** Capture CLI output channels for assertions. */
export function captureIo(): { io: CliIo; stdout: () => string; stderr: () => string } {
  let out = ''
  let err = ''
  return {
    io: {
      stdout: (text) => { out += text },
      stderr: (text) => { err += text },
    },
    stdout: () => out,
    stderr: () => err,
  }
}

const tmpDirs: string[] = []

/**
 * A fresh temp dir, removed on process exit via the vitest afterEach hooks
 * below. realpath, not the mkdtemp name: on macOS the runtime temp root is a
 * symlink (/var → /private/var), and the artifact readers compare REAL paths,
 * so a fixture holding the unresolved name would compare two spellings of one
 * directory.
 */
export function tmpTree(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-eval-test-')))
  tmpDirs.push(dir)
  return dir
}

// Best-effort cleanup; vitest runs this module's afterEach between files.
export function cleanupTmp(): void {
  restoreDshHome()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/** Write a JSON file (creating parent dirs) and return its path. */
export function writeJson(dir: string, rel: string, value: unknown): string {
  const path = join(dir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}

// ── T73: the deployment state root and a fake datasets registry ─────────────

let savedDshHome: { value: string | undefined } | undefined

/**
 * Point DSH_HOME at a fresh temp dir for this test and return the eval state
 * root under it (`<home>/state/eval`). {@link restoreDshHome} (run by
 * {@link cleanupTmp}) puts the previous value back.
 */
export function useDshHome(): { home: string; stateRoot: string } {
  if (savedDshHome === undefined) savedDshHome = { value: process.env['DSH_HOME'] }
  const home = tmpTree()
  process.env['DSH_HOME'] = home
  return { home, stateRoot: join(home, 'state', 'eval') }
}

/** Undo {@link useDshHome}. */
export function restoreDshHome(): void {
  if (savedDshHome === undefined) return
  if (savedDshHome.value === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = savedDshHome.value
  savedDshHome = undefined
}

/** What {@link fakeRegistry} serves. */
export interface FakeRegistryOptions {
  /** The registration id (default `reg`). */
  id?: string
  /** set → the directory its dataset view materializes to (holding items/, schemas/). */
  sets: Record<string, string>
  /** The tracked branch's latest commit (default 40 × `c`). */
  latest?: string
  /** Other commits the registration holds. */
  commits?: string[]
  /** commit → repo-relative path → git object id; unlisted paths answer `tree-same`. */
  trees?: Record<string, Record<string, string>>
  /** commit → repo-relative path → file bytes, for `registryShowFile` / `registryListFiles`. */
  files?: Record<string, Record<string, string>>
  /** Named refs → commit (e.g. `main`); the latest is always reachable as the tracked ref. */
  refs?: Record<string, string>
}

/** The real face's path rule (datasets `assertSafeRelativePath`): no empty or '..' segment — so no trailing slash either. */
function safeRelative(path: string): void {
  if (path === '' || path.split('/').some(segment => segment === '..' || segment === '')) {
    throw new Error(`invalid file path ${JSON.stringify(path)}: must be a relative path without '..' segments`)
  }
}

/** A `datasets` service answering the registry reads from memory. */
export function fakeRegistry(options: FakeRegistryOptions): DatasetsRegistryFace {
  const id = options.id ?? 'reg'
  const latest = options.latest ?? 'c'.repeat(40)
  const commits = [latest, ...(options.commits ?? []), ...Object.keys(options.files ?? {})]
  const refs: Record<string, string> = { main: latest, ...options.refs }
  const entry = { id, commonDir: '/home/user/repo/.git', trackedRef: 'main' }
  const known = (asked: string): void => {
    if (asked !== id) throw new Error(`no registration ${JSON.stringify(asked)}`)
  }
  const resolve = async (asked: string, ref: string): Promise<string> => {
    known(asked)
    const named = refs[ref]
    if (named !== undefined) return named
    const hit = commits.find(commit => commit === ref || (ref.length >= 4 && commit.startsWith(ref)))
    if (hit === undefined) throw new Error(`${id} holds no ${ref}`)
    return hit
  }
  return {
    registration: async (asked) => {
      known(asked)
      return { ...entry, latest: { commit: latest, date: '2026-09-20' } }
    },
    resolveRegistryCommit: resolve,
    registryObjectId: async (asked, commit, path) => {
      known(asked)
      return options.trees?.[commit]?.[path] ?? 'tree-same'
    },
    registryListFiles: async (asked, commit, prefix) => {
      known(asked)
      if (prefix !== '') safeRelative(prefix)
      return Object.keys(options.files?.[commit] ?? {}).filter(path => prefix === '' || path.startsWith(`${prefix}/`)).sort()
    },
    registryShowFile: async (asked, commit, path) => {
      known(asked)
      safeRelative(path)
      const text = options.files?.[commit]?.[path]
      return text === undefined ? undefined : Buffer.from(text, 'utf8')
    },
    datasetView: async (asked, set, commit) => {
      known(asked)
      const path = options.sets[set]
      if (path === undefined) throw new Error(`no dataset set ${JSON.stringify(set)} in ${id}`)
      return { path, commit }
    },
    registry: {
      resolveRef: async (ref) => {
        const [asked = '', set = ''] = ref.split('/')
        known(asked)
        return { entry, set, latest: { commit: latest, date: '2026-09-20' } }
      },
      rows: async () => [{
        entry,
        latest: { commit: latest, date: '2026-09-20' },
        sets: Object.keys(options.sets).map(set => ({ ref: `${id}/${set}`, set })),
      }],
    },
  }
}

/** A host accessor mounting `datasets` (and whatever else is given). */
export function hostsWith(datasets: unknown, extra: Record<string, unknown> = {}): { get(name: string): unknown } {
  return { get: (name: string) => (name === 'datasets' ? datasets : extra[name]) }
}
