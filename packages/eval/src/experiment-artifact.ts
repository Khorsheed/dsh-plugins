/**
 * Reading ONE file of ONE experiment, in place — the report page's 分析初稿
 * block (T73). The same three rules as {@link readCellArtifact}, aimed at the
 * experiment directory instead of an attempt's run-data directory:
 *
 * - INSIDE THE EXPERIMENT OR NOWHERE: a lexical containment check before any
 *   disk access, then the same check on the REAL paths, so neither `../` nor
 *   a symlink inside the directory reads anything else;
 * - TEXT, AND SAID SO: only {@link TEXT_EXTENSIONS} read back, by name;
 * - CUT, AND SAID SO: past {@link ARTIFACT_MAX_BYTES} the answer is the head
 *   of the file and a note saying it was cut.
 * @module @khorsheed/dsh-eval
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { ARTIFACT_MAX_BYTES, extensionOf, isInside, TEXT_EXTENSIONS } from './cell-artifact.ts'
import { EvalReadRefused } from './read.ts'
import type { EvalAnalysisFile, EvalExperimentArtifactView } from './types.ts'

/**
 * Read one file of an experiment directory.
 * @param experiment - the experiment's id and directory.
 * @param path - the experiment-relative path (`analysis/draft.md`, `plan.json`).
 * @throws {@link EvalReadRefused} when the path leaves the directory, names a directory, or is not there.
 */
export async function readExperimentArtifact(
  experiment: { id: string; dir: string },
  path: string,
): Promise<EvalExperimentArtifactView> {
  if (path === '' || isAbsolute(path)) {
    throw new EvalReadRefused(`实验文件路径必须是实验目录里的相对路径：${JSON.stringify(path)}`)
  }
  if (!isInside(resolve(experiment.dir), resolve(experiment.dir, path))) {
    throw new EvalReadRefused(`文件路径越出了这个实验的目录，拒绝读取：${path}`)
  }
  let root: string
  try {
    root = await realpath(experiment.dir)
  } catch {
    throw new EvalReadRefused(`实验 ${experiment.id} 的目录不在磁盘上`)
  }
  let real: string
  try {
    real = await realpath(join(experiment.dir, path))
  } catch {
    throw new EvalReadRefused(`文件不在磁盘上：${path}`)
  }
  if (!isInside(root, real)) {
    throw new EvalReadRefused(`文件路径越出了这个实验的目录，拒绝读取：${path}`)
  }
  const info = await stat(real)
  if (info.isDirectory()) throw new EvalReadRefused(`这是目录，不是文件：${path}`)

  const extension = extensionOf(path)
  if (!TEXT_EXTENSIONS.includes(extension)) {
    return {
      experimentId: experiment.id,
      path,
      kind: 'binary',
      truncated: false,
      bytes: info.size,
      text: null,
      note: extension === ''
        ? '这个文件没有扩展名，这一页只内联文本（md / json / txt / yml / yaml / log / jsonl）'
        : `这一页不内联 ${extension} 文件，只内联文本（md / json / txt / yml / yaml / log / jsonl）`,
    }
  }
  const buffer = await readFile(real)
  const cut = buffer.length > ARTIFACT_MAX_BYTES
  return {
    experimentId: experiment.id,
    path,
    kind: 'text',
    truncated: cut,
    bytes: buffer.length,
    text: buffer.subarray(0, ARTIFACT_MAX_BYTES).toString('utf8'),
    note: cut
      ? `文件 ${String(buffer.length)} 字节，超过 ${String(ARTIFACT_MAX_BYTES)} 字节上限，只返回开头部分`
      : null,
  }
}

/**
 * Every file under an experiment's `analysis/`, newest first. Symlinks are
 * not followed and nothing but regular files is listed; an absent or
 * unreadable directory lists nothing.
 * @param dir - the experiment directory.
 */
export async function listAnalysisFiles(dir: string): Promise<EvalAnalysisFile[]> {
  const files: EvalAnalysisFile[] = []
  const walk = async (relativeDir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(join(dir, relativeDir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = `${relativeDir}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(rel)
      } else if (entry.isFile()) {
        const info = await stat(join(dir, rel)).catch(() => undefined)
        if (info === undefined) continue
        files.push({ path: rel, name: rel.slice('analysis/'.length), modifiedAt: info.mtimeMs, bytes: info.size })
      }
    }
  }
  await walk('analysis')
  files.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
  return files
}
