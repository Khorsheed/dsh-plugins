import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { systemTrash } from '../src/trash.ts'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'game-trash-')) })
afterEach(async () => { await rm(home, { recursive: true, force: true }) })

async function project(name: string): Promise<string> {
  const root = join(home, 'ws', name)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'game.json'), '{}')
  return root
}

describe('system trash', () => {
  it('moves a folder into ~/.Trash on macOS, de-duplicating the name', async () => {
    const trash = systemTrash(home, 'darwin')
    const first = await trash(await project('lighthouse'))
    expect(first).toBe(join(home, '.Trash', 'lighthouse'))
    const second = await trash(await project('lighthouse'))
    expect(second).not.toBe(first)
    expect((await readdir(join(home, '.Trash'))).length).toBe(2)
    expect(await stat(join(second, 'game.json')).then(() => true)).toBe(true)
  })

  it('follows the freedesktop trash on Linux, with a restore record', async () => {
    const saved = process.env.XDG_DATA_HOME
    delete process.env.XDG_DATA_HOME
    try {
      const root = await project('hills')
      const to = await systemTrash(home, 'linux')(root)
      expect(to).toBe(join(home, '.local', 'share', 'Trash', 'files', 'hills'))
      const info = await readFile(join(home, '.local', 'share', 'Trash', 'info', 'hills.trashinfo'), 'utf8')
      expect(info).toContain(`Path=${encodeURI(root)}`)
    } finally {
      if (saved !== undefined) process.env.XDG_DATA_HOME = saved
    }
  })

  it('refuses elsewhere and touches nothing', async () => {
    const root = await project('x')
    await expect(systemTrash(home, 'win32')(root)).rejects.toThrow()
    expect(await stat(root).then(() => true)).toBe(true)
  })
})
