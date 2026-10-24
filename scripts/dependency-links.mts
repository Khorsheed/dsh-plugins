import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export interface LinkScanRoot { path: string; exclude?: string[] }
export interface LinkFinding { path: string; target?: string; code: string }

/** Directory listing, injectable so a spec can list an entry that is gone by the time it is read. */
export interface LinkScanIo { readdir: (path: string) => string[] }

/**
 * Read-only physical-tree scan. Validate link targets without recursively walking aliases.
 *
 * An entry that vanishes between its directory listing and its lstat is skipped, not
 * reported: a live instance keeps re-creating runtime files under the home it serves
 * (the member bridge unlinks and re-binds `local-agent/member-bridge.sock`; the member
 * inbox / control stores write a temp file and rename it), and losing that race is not a
 * dangling link — the deploy used to abort on it (2026-10-24). A symlink whose TARGET is
 * missing is still a finding, and so is a missing scan root.
 */
export function scanDependencyLinks(roots: LinkScanRoot[], io: LinkScanIo = { readdir: path => readdirSync(path) }): LinkFinding[] {
  const findings: LinkFinding[] = []
  const visited = new Set<string>()
  function visit(path: string, excluded: string[] = [], listed = false) {
    let target: string | undefined
    let info: ReturnType<typeof lstatSync>
    try {
      info = lstatSync(path)
    } catch (error) {
      if (listed && (error as NodeJS.ErrnoException).code === 'ENOENT') return // vanished since its listing
      findings.push({ path, code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' })
      return
    }
    try {
      if (info.isSymbolicLink()) {
        target = readlinkSync(path)
        statSync(path)
        return
      }
      if (!info.isDirectory()) return // sockets/FIFOs are not dependency errors
      const canonical = realpathSync(path)
      if (visited.has(canonical)) return
      visited.add(canonical)
      for (const name of io.readdir(path).sort()) {
        if (name !== '.git' && !excluded.includes(name)) visit(join(path, name), [], true)
      }
    } catch (error) {
      findings.push({ path, ...(target === undefined ? {} : { target }), code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' })
    }
  }
  for (const root of roots) {
    // A configured home/harness may itself be a directory symlink.
    try { visit(realpathSync(resolve(root.path)), root.exclude) }
    catch (error) { findings.push({ path: resolve(root.path), code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }) }
  }
  return findings
}

export function checkDeploymentLinks(home: string, harness: string): void {
  const findings = scanDependencyLinks([{ path: home, exclude: ['scratch'] }, { path: harness }])
    // A LIVE Chrome profile's Singleton* / RunningChromeVersion links are locks
    // whose targets are host-pid strings, not paths — they stat as ENOENT at
    // their healthiest, and must never block a deploy (2026-10-18). The
    // exclusion list only reaches top-level names, so the filter is by segment.
    .filter(finding => !finding.path.split(sep).includes('chrome-profile'))
  if (findings.length) {
    const rows = findings.map(row => `  ${row.code} ${JSON.stringify(row.path)}${row.target === undefined ? '' : ` -> ${JSON.stringify(row.target)}`}`)
    throw new Error(`dependency link check failed (${findings.length} finding(s)):\n${rows.join('\n')}\nNo links were changed. Inspect the owner and target; rebuild/reinstall missing dependencies. Before removing a confirmed stale generated link, back up its path and target. Then rerun deploy:check-links. This check does not replace ankh-guard preflight.`)
  }
}
