/**
 * Shared vitest preset for this repo. Platform imports (@deepseek-ai/dsh-*,
 * vendored cordis family) resolve to the harness checkout's SOURCES using that
 * repo's own tsconfig.base.json paths — the published npm artifacts ship no
 * src/ (despite declaring ./src/* exports), and their /client entries are
 * loader-wrapped browser bundles that explode on a plain test import. The
 * harness checkout is a dev-time path dependency (DSH_HARNESS, default
 * ~/code/deepseek-harness), the same mechanism as scripts/gen-typert.mts and
 * the taskpilot tsconfig paths.
 *
 * This repo's own @khorsheed/dsh-* self-references resolve to the local
 * package sources the same way, so the whole test graph runs in one source
 * plane and module-singleton identity holds across packages.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vitest/config'

// vitest bundles the config into a .vite-temp scratch file, so import.meta.url
// cannot anchor the repo — the configs are always per-package, run with the
// package directory as cwd.
const REPO_ROOT = join(process.cwd(), '..', '..')

/** Parse a JSON-with-comments tsconfig (string-aware comment stripping). */
function readJsonc(path: string): { compilerOptions?: { paths?: Record<string, string[]> } } {
  const text = readFileSync(path, 'utf8')
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index] as string
    if (char === '"') {
      const end = text.indexOf('"', index + 1)
      out += text.slice(index, end + 1)
      index = end + 1
    } else if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index)
      index = end < 0 ? text.length : end
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end < 0 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return JSON.parse(out) as { compilerOptions?: { paths?: Record<string, string[]> } }
}

/** Resolve a paths target (file or directory) to a concrete source file. */
function resolveTarget(target: string): string | null {
  for (const candidate of [`${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), join(target, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate
  }
  return existsSync(target) ? target : null
}

/**
 * Rewrite path-mapped specifiers onto a foreign tsconfig's source tree.
 * @param root - directory the paths values are relative to.
 * @param paths - tsconfig compilerOptions.paths.
 * @param match - specifier filter.
 * @returns a Vite resolver plugin.
 */
function sourcePathsPlugin(root: string, paths: Record<string, string[]>, match: RegExp): Plugin {
  const entries = Object.entries(paths)
  return {
    name: `dsh-source-paths:${root}`,
    enforce: 'pre',
    resolveId(source) {
      if (!match.test(source) || isAbsolute(source)) return null
      for (const [key, targets] of entries) {
        const star = key.indexOf('*')
        const matched = star < 0
          ? (key === source ? targets : [])
          : (source.startsWith(key.slice(0, star)) && source.endsWith(key.slice(star + 1))
              ? targets.map(value => value.replace('*', source.slice(star, source.length - key.length + star + 1)))
              : [])
        for (const candidate of matched) {
          const resolved = resolveTarget(join(root, candidate))
          if (resolved !== null) return resolved
        }
      }
      return null
    },
  }
}

/** Map @khorsheed/dsh-* specifiers onto this repo's package sources. */
function localPackagePlugin(): Plugin {
  const byName = new Map<string, string>()
  for (const dir of readdirSync(join(REPO_ROOT, 'packages'))) {
    const manifestPath = join(REPO_ROOT, 'packages', dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
    if (manifest.name !== undefined) byName.set(manifest.name, dir)
  }
  return {
    name: 'dsh-local-package-sources',
    enforce: 'pre',
    resolveId(source) {
      const match = /^(@khorsheed\/dsh-[a-z0-9-]+)(?:\/(.*))?$/.exec(source)
      if (match === null) return null
      const dir = byName.get(match[1] as string)
      if (dir === undefined) return null
      // Generated artifacts (./typert, ./remote) and raw sources keep their
      // package-default resolution; everything else mirrors onto src/.
      const sub = match[2]
      if (sub !== undefined && /^(?:typert|remote|src\/|package\.json)/.test(sub)) return null
      const base = join(REPO_ROOT, 'packages', dir, 'src', sub ?? '')
      for (const candidate of sub === undefined
        ? [join(base, 'index.ts')]
        : [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(candidate)) return candidate
      }
      return null
    },
  }
}

/**
 * Build the repo-standard vitest config.
 * @returns a vitest config with harness source-plane resolution and automatic JSX.
 */
export function dshTestConfig(): ReturnType<typeof defineConfig> {
  const harness = process.env['DSH_HARNESS'] ?? join(homedir(), 'code/deepseek-harness')
  const harnessBase = join(harness, 'tsconfig.base.json')
  if (!existsSync(harnessBase)) {
    throw new Error(`dshTestConfig: harness checkout not found at ${harness} — set DSH_HARNESS to a deepseek-harness clone`)
  }
  const paths = readJsonc(harnessBase).compilerOptions?.paths ?? {}
  // Harness sources resolve react through the harness checkout's node_modules;
  // tests render with this repo's copy. Alias the react-coupled packages to
  // the copies installed for the calling package (one .pnpm store → one
  // instance) so externalized CJS keeps a single React dispatcher.
  const alias: Record<string, string> = {}
  for (const name of ['react', 'react-dom', 'use-sync-external-store']) {
    try {
      let dir = join(fileURLToPath(import.meta.resolve(name, pathToFileURL(`${process.cwd()}/`).href)), '..')
      while (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name) dir = join(dir, '..')
      alias[name] = dir
    } catch { /* the calling package does not depend on it */ }
  }
  return defineConfig({
    esbuild: { jsx: 'automatic' },
    resolve: { dedupe: ['react', 'react-dom'], alias },
    plugins: [
      sourcePathsPlugin(harness, paths, /^@deepseek-ai\//),
      localPackagePlugin(),
    ],
  })
}
