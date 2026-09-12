import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface LinkScanRoot { path: string; exclude?: string[] }
export interface LinkFinding { path: string; target?: string; code: string }

/** Read-only physical-tree scan. Validate link targets without recursively walking aliases. */
export function scanDependencyLinks(roots: LinkScanRoot[]): LinkFinding[] {
  const findings: LinkFinding[] = []
  const visited = new Set<string>()
  function visit(path: string, excluded: string[] = []) {
    let target: string | undefined
    try {
      const info = lstatSync(path)
      if (info.isSymbolicLink()) {
        target = readlinkSync(path)
        statSync(path)
        return
      }
      if (!info.isDirectory()) return // sockets/FIFOs are not dependency errors
      const canonical = realpathSync(path)
      if (visited.has(canonical)) return
      visited.add(canonical)
      for (const name of readdirSync(path).sort()) {
        if (name !== '.git' && !excluded.includes(name)) visit(join(path, name))
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
  if (findings.length) {
    const rows = findings.map(row => `  ${row.code} ${JSON.stringify(row.path)}${row.target === undefined ? '' : ` -> ${JSON.stringify(row.target)}`}`)
    throw new Error(`dependency link check failed (${findings.length} finding(s)):\n${rows.join('\n')}\nNo links were changed. Inspect the owner and target; rebuild/reinstall missing dependencies. Before removing a confirmed stale generated link, back up its path and target. Then rerun deploy:check-links. This check does not replace ankh-guard preflight.`)
  }
}
