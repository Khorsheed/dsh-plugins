/**
 * Moving a deleted project folder to the system trash, so a delete from the
 * panel is complete (gone from the workspace and the plugin) yet recoverable.
 *
 * - macOS: a rename into `~/.Trash`, de-duplicated with a timestamp suffix.
 * - Linux: the freedesktop trash (`$XDG_DATA_HOME/Trash`, default
 *   `~/.local/share/Trash`): the folder goes to `files/`, a `.trashinfo`
 *   record to `info/` so the file manager can restore it to where it was.
 * - Elsewhere, or across volumes (a rename cannot cross devices), the move is
 *   refused and nothing is touched: the panel then offers "remove from the
 *   list only". A project folder is never deleted outright.
 * @module @khorsheed/dsh-game
 */
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** Moves a folder to the trash; resolves with where it went, rejects with a user-facing reason. */
export type TrashMover = (folder: string) => Promise<string>

/** A free name inside `dir` for `name`, suffixed with the time when taken. */
async function freeName(dir: string, name: string): Promise<string> {
  const taken = async (candidate: string): Promise<boolean> => stat(join(dir, candidate)).then(() => true, () => false)
  if (!await taken(name)) return name
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (let n = 0; ; n++) {
    const candidate = `${name} ${stamp}${n === 0 ? '' : `-${n}`}`
    if (!await taken(candidate)) return candidate
  }
}

/** Rename, turning a cross-device failure into the refusal the panel explains. */
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') throw new Error('项目和废纸篓不在同一块磁盘上，没法移过去')
    throw error
  }
}

/** The system trash mover for this platform (`home` is a test seam). */
export function systemTrash(home = homedir(), platform: NodeJS.Platform = process.platform): TrashMover {
  if (platform === 'darwin') {
    return async (folder) => {
      const dir = join(home, '.Trash')
      await mkdir(dir, { recursive: true })
      const target = join(dir, await freeName(dir, basename(folder)))
      await move(folder, target)
      return target
    }
  }
  if (platform === 'linux') {
    return async (folder) => {
      const root = join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'Trash')
      await mkdir(join(root, 'files'), { recursive: true })
      await mkdir(join(root, 'info'), { recursive: true })
      const name = await freeName(join(root, 'files'), basename(folder))
      const date = new Date().toISOString().slice(0, 19)
      await writeFile(join(root, 'info', `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(folder)}\nDeletionDate=${date}\n`)
      await move(folder, join(root, 'files', name))
      return join(root, 'files', name)
    }
  }
  return async () => { throw new Error('这个系统上插件不会动项目文件夹') }
}
