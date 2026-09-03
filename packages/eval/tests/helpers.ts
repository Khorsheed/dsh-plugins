import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliIo } from '../src/cli-core.ts'

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

/** A fresh temp dir, removed on process exit via the vitest afterEach hooks below. */
export function tmpTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-test-'))
  tmpDirs.push(dir)
  return dir
}

// Best-effort cleanup; vitest runs this module's afterEach between files.
export function cleanupTmp(): void {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/** Write a JSON file (creating parent dirs) and return its path. */
export function writeJson(dir: string, rel: string, value: unknown): string {
  const path = join(dir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}
