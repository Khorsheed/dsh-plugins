/**
 * Reading ONE artifact of ONE cell, in place (ui-spec §五 v2's 运行记录详情).
 *
 * The drawer listed its attachments by path and said the file service was
 * still missing — which was true of a DOWNLOAD and false of the thing a
 * reader actually wants, which is to look at `stage1.md` without leaving the
 * page. The bytes were already reachable: the judge bench reads the same
 * attempt directory's `archive/workspace/` to build its de-identified
 * material, so this module is that read without the de-identification, aimed
 * at the ledger's own artifact paths instead of the judge's fixed list.
 *
 * Three rules shape it, and all three are refusals rather than features.
 *
 * INSIDE THE CELL OR NOWHERE. A path is resolved against the attempt's run-data
 * directory and then checked with `realpath` on BOTH sides: the resolved file
 * must sit under the resolved attempt directory. That catches `../` and it
 * also catches the case a string check cannot — a symlink inside the archive
 * pointing out of it, which is a shape lab's own export could produce without
 * anyone intending it. The check runs on the REAL paths, so a caller cannot
 * spell its way past it.
 *
 * TEXT, AND SAID SO. Only the extensions a run actually produces read back
 * ({@link TEXT_EXTENSIONS}); everything else is refused by NAME rather than by
 * sniffing, because a sniffed binary that happens to start with printable
 * bytes is exactly the case that would put a megabyte of noise on screen. A
 * file over {@link ARTIFACT_MAX_BYTES} answers with its first
 * {@link ARTIFACT_MAX_BYTES} and says it was cut — never silently.
 *
 * NOT THE BLIND PAGE. This read is un-de-identified on purpose: the record
 * detail names the condition in its own header, so scrubbing the material
 * here would protect nothing and hide the harness's own words from the person
 * debugging it. The blind read is the judge bench's and stays there
 * (`judge-bench.ts`, which runs the SAME material through `deidentify`).
 * @module @khorsheed/dsh-eval
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { attemptDataDir } from './cell-detail.ts'
import type { MissionReadFace } from './faces.ts'
import { EvalReadRefused } from './read.ts'
import type { EvalCellArtifactView } from './types.ts'

/**
 * How much of one artifact crosses the wire. 256 KB is the whole of every
 * stage submission a run has produced so far and about two orders of
 * magnitude more than the drawer can show at once; past it the answer is
 * truncated rather than refused, because the head of an over-long log is
 * usually the part that says what went wrong.
 */
export const ARTIFACT_MAX_BYTES = 256 * 1024

/**
 * The extensions that read back as text. An allow-list, not a sniff: these
 * are the artifacts a run writes (stage submissions, the materialization and
 * populate manifests, probe verdicts, logs), and a name that is not on it is
 * refused with its extension in the sentence so the reader knows WHY rather
 * than seeing an empty pane.
 */
export const TEXT_EXTENSIONS: readonly string[] = ['.md', '.json', '.txt', '.yml', '.yaml', '.log', '.jsonl']

/** Directory listings are bounded too — an archive with 10k files is not a page. */
export const ARTIFACT_MAX_ENTRIES = 200

/** The lower-cased extension of a path, `''` when it has none. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/**
 * Whether `child` is `root` itself or sits under it. Both sides are expected
 * to be REAL paths already (the caller resolves symlinks first); this is the
 * containment rule alone, separated out so it can be tested without a disk.
 * @param root - the directory the answer must stay inside.
 * @param child - the resolved candidate.
 * @returns whether the candidate is contained.
 */
export function isInside(root: string, child: string): boolean {
  if (child === root) return true
  const rel = relative(root, child)
  // `..` anywhere at the head means it climbed out; an absolute result means
  // the two are not even on the same branch (different roots on win32).
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

/** What {@link readCellArtifact} needs from its caller. */
export interface CellArtifactInput {
  mission: MissionReadFace
  runId: string
  missionId: string
  /** The attempt whose directory the path is resolved against. */
  attempt: number
  /** The artifact's path as the ledger recorded it, relative to that directory. */
  path: string
}

/**
 * Read one artifact of one attempt.
 * @param input - the ledger face, the cell coordinates and the path.
 * @returns the text and whether it was cut, a directory's entries, or the
 *   refusal recorded as `kind: 'binary'`.
 * @throws {@link EvalReadRefused} when the composition reports no data root,
 *   when the path leaves the attempt directory, or when nothing is there.
 */
export async function readCellArtifact(input: CellArtifactInput): Promise<EvalCellArtifactView> {
  const { mission, runId, missionId, attempt, path } = input
  if (mission.dataDir === undefined) {
    throw new EvalReadRefused(
      '账本没有报出数据根目录：产物在磁盘上，这个组合读不到 — 挂上 dsh-mission 插件再看',
    )
  }
  if (path === '' || isAbsolute(path)) {
    // An absolute path is not a ledger artifact path, and accepting one would
    // make the containment check the ONLY guard. Refused by shape, first.
    throw new EvalReadRefused(`产物路径必须是格子账本里的相对路径：${JSON.stringify(path)}`)
  }
  const dir = attemptDataDir(mission.dataDir, runId, missionId, attempt)
  // TWO containment checks, and both are load-bearing.
  //
  // The first is LEXICAL, and it runs before anything touches the disk: a
  // `../` path is out of bounds whether or not it happens to name a file, so
  // it is refused as out of bounds rather than as «not on disk» — a caller
  // probing for what exists must not be able to read the answer off the
  // difference between the two refusals.
  if (!isInside(resolve(dir), resolve(dir, path))) {
    throw new EvalReadRefused(`产物路径越出了这一格的运行数据目录，拒绝读取：${path}`)
  }
  // The second is on the REAL paths, and it catches what the lexical one
  // cannot: a symlink INSIDE the attempt directory whose target is outside —
  // a shape an export could lay down without anyone intending it.
  let root: string
  try {
    root = await realpath(dir)
  } catch {
    throw new EvalReadRefused(`第 ${String(attempt)} 次的运行数据目录不在磁盘上：${dir}`)
  }
  let real: string
  try {
    real = await realpath(join(dir, path))
  } catch {
    throw new EvalReadRefused(`产物不在磁盘上：${path}`)
  }
  if (!isInside(root, real)) {
    throw new EvalReadRefused(`产物路径越出了这一格的运行数据目录，拒绝读取：${path}`)
  }

  const info = await stat(real)
  if (info.isDirectory()) {
    // `archive` and `probe-verdicts` are recorded as artifacts and ARE
    // directories. Listing them is what makes the attachment list usable —
    // the alternative is a row that does nothing when clicked.
    const names = (await readdir(real)).sort((a, b) => (a < b ? -1 : 1))
    return {
      runId,
      missionId,
      attempt,
      path,
      kind: 'directory',
      entries: names.slice(0, ARTIFACT_MAX_ENTRIES),
      truncated: names.length > ARTIFACT_MAX_ENTRIES,
      bytes: null,
      text: null,
      note: names.length > ARTIFACT_MAX_ENTRIES
        ? `目录里有 ${String(names.length)} 项，只列前 ${String(ARTIFACT_MAX_ENTRIES)} 项`
        : null,
    }
  }

  const extension = extensionOf(path)
  if (!TEXT_EXTENSIONS.includes(extension)) {
    // By NAME, not by content: a sniffed binary whose head happens to be
    // printable is exactly the file that would fill the pane with noise.
    return {
      runId,
      missionId,
      attempt,
      path,
      kind: 'binary',
      entries: [],
      truncated: false,
      bytes: info.size,
      text: null,
      note: extension === ''
        ? '这个产物没有扩展名，这一页只内联文本产物（md / json / txt / yml / yaml / log / jsonl）'
        : `这一页不内联 ${extension} 产物，只内联文本（md / json / txt / yml / yaml / log / jsonl）`,
    }
  }

  const buffer = await readFile(real)
  const cut = buffer.length > ARTIFACT_MAX_BYTES
  return {
    runId,
    missionId,
    attempt,
    path,
    kind: 'text',
    entries: [],
    truncated: cut,
    bytes: buffer.length,
    // Sliced on BYTES, which is the limit that was declared; a multi-byte
    // character split at the boundary decodes to one replacement character
    // and the note beside it already says the text was cut.
    text: buffer.subarray(0, ARTIFACT_MAX_BYTES).toString('utf8'),
    note: cut
      ? `产物 ${String(buffer.length)} 字节，超过 ${String(ARTIFACT_MAX_BYTES)} 字节上限，只返回开头部分`
      : null,
  }
}
