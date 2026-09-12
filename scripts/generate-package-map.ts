#!/usr/bin/env node
/**
 * Package-map generator — writes `docs/packages.md`, the authoritative map of
 * what this repo ships: how many packages there are, which of them self-mount,
 * how the rest are composed, which half (host/client) each one carries, and
 * which integration profile installs it.
 *
 * Why generated: the README numbers drifted for three release waves ("26
 * packages, 24 self-mounting, another 2") while the tree had 32, and the
 * hand-maintained `NO_OWN_PATCH` list was the only record of why a package
 * deliberately has no patch. Both are now facts read from the manifests.
 *
 * Usage:
 *   pnpm map:packages     # regenerate docs/packages.md
 *   pnpm check:packages   # exit 1 when the committed map is stale (gate step)
 * @module scripts/generate-package-map
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

interface Manifest {
  readonly name?: string
  readonly version?: string
  readonly private?: boolean
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string }
    readonly client?: { readonly platform?: string }
    readonly composition?: { readonly component?: string }
    readonly compat?: { readonly minHost?: string; readonly verifiedHost?: string }
  }
}

interface PackageRow {
  readonly dir: string
  readonly name: string
  readonly version: string
  readonly form: 'bundle' | 'composition'
  readonly component: string
  readonly platform: string
  readonly minHost: string
  readonly profiles: readonly string[]
}

const OUT_REL = 'docs/packages.md'

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function packageDirs(packagesRoot: string): string[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packagesRoot, e.name, 'package.json')))
    .map((e) => e.name)
    .sort()
}

/** Profile name → the package names it installs (dependencies, then bundles). */
function profileMembers(repoRoot: string): Map<string, Set<string>> {
  const profilesRoot = join(repoRoot, 'profiles')
  const out = new Map<string, Set<string>>()
  if (!existsSync(profilesRoot)) return out
  for (const dir of readdirSync(profilesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(profilesRoot, e.name, 'package.json')))
    .map((e) => e.name)
    .sort()) {
    const json = readJson<{ dependencies?: Record<string, string>; dsh?: { profile?: { bundles?: readonly string[] } } }>(
      join(profilesRoot, dir, 'package.json'),
    )
    const members = new Set<string>(Object.keys(json.dependencies ?? {}))
    // A profile's bundle rows may name a package that is not a direct dependency
    // (the checker's job to reject); count only real packages either way.
    out.set(dir, members)
  }
  return out
}

/** Every package in the tree, with the composition facts the map publishes. */
export function packageRows(repoRoot: string): PackageRow[] {
  const packagesRoot = join(repoRoot, 'packages')
  const profiles = profileMembers(repoRoot)
  const allProfiles = [...profiles.keys()].sort()
  return packageDirs(packagesRoot).map((dir) => {
    const json = readJson<Manifest>(join(packagesRoot, dir, 'package.json'))
    const name = json.name ?? `packages/${dir}`
    const selfMounts = json.dsh?.bundle?.patch !== undefined
    return {
      dir,
      name,
      version: json.version ?? '—',
      form: selfMounts ? 'bundle' : 'composition',
      component: selfMounts ? '—' : (json.dsh?.composition?.component ?? '*(missing)*'),
      platform: json.dsh?.client?.platform ?? '—',
      minHost: json.dsh?.compat?.minHost ?? '—',
      profiles: allProfiles.filter((p) => profiles.get(p)?.has(name) === true),
    }
  })
}

/** Profile rows: what each integration profile installs. */
function profileRows(repoRoot: string): Array<{ name: string; deps: number; bundles: number }> {
  const profilesRoot = join(repoRoot, 'profiles')
  const profiles = profileMembers(repoRoot)
  return [...profiles.keys()].sort().map((name) => {
    const json = readJson<{ dsh?: { profile?: { bundles?: readonly string[] } } }>(
      join(profilesRoot, name, 'package.json'),
    )
    return { name, deps: profiles.get(name)?.size ?? 0, bundles: json.dsh?.profile?.bundles?.length ?? 0 }
  })
}

/**
 * Render `docs/packages.md`. Deterministic: sorted everywhere, no timestamps,
 * so `--check` can compare byte for byte.
 * @param repoRoot - repository root.
 * @returns the full file text.
 */
export function renderPackageMap(repoRoot: string): string {
  const rows = packageRows(repoRoot)
  const bundles = rows.filter((r) => r.form === 'bundle')
  const compositions = rows.filter((r) => r.form === 'composition')
  const byComponent = new Map<string, number>()
  for (const r of compositions) byComponent.set(r.component, (byComponent.get(r.component) ?? 0) + 1)
  const profiles = profileRows(repoRoot)

  const lines: string[] = [
    '# 包地图',
    '',
    `> 由 \`pnpm map:packages\` 生成、\`pnpm check:packages\` 校验(已进 \`pnpm gate\`)。**请勿手改**——数字与形态都从各包 manifest 读取。`,
    '',
    '## 概览',
    '',
    `- 包总数:**${rows.length}**`,
    `- 自挂载 bundle(\`dsh.bundle.patch\`):**${bundles.length}**`,
    `- 组合组件(不自挂载,\`dsh.composition.component\`):**${compositions.length}**` +
      (byComponent.size > 0
        ? ` — ${[...byComponent.entries()].sort().map(([k, v]) => `\`${k}\` ${v}`).join('、')}`
        : ''),
    `- 带浏览器半边(\`dsh.client\`):**${rows.filter((r) => r.platform !== '—').length}**`,
    `- 整合 profile(默认安装单元):**${profiles.length}** — ${profiles.map((p) => `\`${p.name}\``).join('、')}`,
    '',
    '**安装单元是 profile,不是单包。** 单包安装是高级路径:自挂载包 `dsh plugin add <pkg>` 即可,',
    '组合组件(下表 `形态 = composition`)必须由 profile 的 preset 行或 provider patch 落位,`dsh plugin add` 不会挂载它们。',
    '',
    '## 包',
    '',
    '| 包 | 目录 | 版本 | 形态 | 组件 | 客户端 | minHost | 出现在 profile |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| \`${r.name}\` | \`packages/${r.dir}\` | ${r.version} | ${r.form} | ${r.component} | ${r.platform} | ${r.minHost} | ${r.profiles.join(', ') || '—'} |`),
    '',
    '## 整合 profile',
    '',
    '| profile | 直接依赖 | bundles |',
    '| --- | --- | --- |',
    ...profiles.map((p) => `| \`profiles/${p.name}\` | ${p.deps} | ${p.bundles} |`),
    '',
    '## 形态的含义',
    '',
    '- **bundle**:包自带 `cordis.patch.yml` 并把该文件列进 `files`,装进 profile 的直接依赖后由',
    '  官方 reconciler 挂载**它自己的** loader 行。',
    '- **preset-composed-row**:模型工具行。由 core 作为**直接依赖**安装(只保证模块可解析),',
    '  再由 agent preset 的 `agent.cordis.yml` 按名引用一行,按会话授予;`dsh.bundle` 声明会把工具',
    '  自动挂回 profile 根,正是工具拆分要移除的东西。',
    '- **provider-mounted-row**:家族内部共享行,由 provider 的 patch 挂载,或由 provisioner 落位。',
    '- **sub-profile-patch**:patch 只面向被 provision 出来的子 profile,由 provisioner 复制进该子',
    '  profile 自己的 patch 层。',
    '',
    '根 `README.md` 的插件表是**精选介绍**,不是完整清单;完整清单以本文件为准。',
    '',
  ]
  return lines.join('\n')
}

/**
 * Compare the committed map with a fresh render.
 * @param repoRoot - repository root.
 * @param outPath - path of the committed map.
 * @returns a problem description, or null when the file is current.
 */
export function checkPackageMap(repoRoot: string, outPath: string): string | null {
  const expected = renderPackageMap(repoRoot)
  if (!existsSync(outPath)) return `${outPath} is missing — run \`pnpm map:packages\``
  return readFileSync(outPath, 'utf8') === expected
    ? null
    : `${outPath} is stale — run \`pnpm map:packages\` and commit the result`
}

function main(): void {
  const repoRoot = join(import.meta.dirname!, '..')
  const outPath = join(repoRoot, OUT_REL)
  if (process.argv.includes('--check')) {
    const problem = checkPackageMap(repoRoot, outPath)
    if (problem !== null) {
      process.stderr.write(`package-map: ${problem}\n`)
      process.exit(1)
    }
    const rows = packageRows(repoRoot)
    const bundles = rows.filter((r) => r.form === 'bundle').length
    process.stdout.write(`package-map: ${OUT_REL} is current (${rows.length} package(s), ${bundles} self-mounting)\n`)
    return
  }
  writeFileSync(outPath, renderPackageMap(repoRoot))
  const rows = packageRows(repoRoot)
  process.stdout.write(`package-map: ${rows.length} package(s) written to ${OUT_REL}\n`)
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
