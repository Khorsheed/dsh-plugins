#!/usr/bin/env node
/**
 * release-status — generate docs/release-status.md: one row per package with
 * its npm-published version, the in-repo next-release line, and the host
 * compatibility fields (dsh.compat). Generated, never hand-edited — the
 * release record that cannot rot. Run after every release wave and commit
 * the result (rule lives in docs/publishing.md).
 *
 * Usage:
 *   pnpm release:status            # regenerate docs/release-status.md
 *   pnpm release:status --offline  # skip npm lookups (published column = ?)
 * @module scripts/release-status
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const offline = process.argv.includes('--offline')

/** npm's published version for `name`, or null when unpublished/offline. */
function publishedVersion(name) {
  if (offline) return '?'
  try {
    return execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || '未发布'
  } catch {
    return '未发布'
  }
}

/** Bundle membership from this repo's own web-basic integration profile. */
function basicMembers() {
  const profile = join(root, 'profiles', 'web-basic', 'package.json')
  if (!existsSync(profile)) return new Set()
  return new Set(Object.keys(JSON.parse(readFileSync(profile, 'utf8')).dependencies ?? {}))
}

const basic = basicMembers()
const rows = []
for (const dir of readdirSync(join(root, 'packages')).sort()) {
  const pkgPath = join(root, 'packages', dir, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const compat = pkg.dsh?.compat ?? {}
  rows.push({
    dir,
    name: pkg.name,
    published: pkg.private === true ? '(private)' : publishedVersion(pkg.name),
    repo: pkg.version,
    minHost: compat.minHost ?? '—',
    verifiedHost: compat.verifiedHost ?? '—',
    basic: basic.has(pkg.name),
  })
}

const date = new Date().toISOString().slice(0, 10)
const lines = [
  '# 发布状态',
  '',
  `> 由 \`pnpm release:status\` 生成(${date})，请勿手改。数据源：各包 package.json(version、dsh.compat)+ 本仓 \`profiles/web-basic\` + npm registry。`,
  '',
  '| 包 | npm 已发布 | 仓内版本 | minHost | verifiedHost | web-basic 成员 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map(r => `| \`${r.name}\` | ${r.published} | ${r.repo} | ${r.minHost} | ${r.verifiedHost} | ${r.basic ? '✓' : ''} |`),
  '',
  '- **npm 已发布**：registry 上的最新版本；`未发布` = 第一波/第二波均未含此包',
  '- **仓内版本**：下一条发布线（发版时才 bump，见 docs/publishing.md)',
  '- **minHost**：已验证的最低宿主线；**verifiedHost**：最近一次宿主 API 审计对齐的线',
]
writeFileSync(join(root, 'docs', 'release-status.md'), lines.join('\n') + '\n')
process.stdout.write(`release-status: ${rows.length} package(s) written to docs/release-status.md\n`)
