import { describe, expect, it } from 'vitest'
import { expandShellPath, extractWriteTargets } from '../src/bash-writes.ts'

describe('extractWriteTargets', () => {
  it('captures a single > redirect (cat heredoc included)', () => {
    expect(extractWriteTargets('mkdir -p /tmp/x && cat > /tmp/x/official.html <<\'EOF\'\n<!doctype html><body>x</body>\nEOF\n')).toEqual(['/tmp/x/official.html'])
  })

  it('never reads a heredoc body as redirects (HTML > content)', () => {
    const command = "cat > out.html <<'EOF'\n<div>a > b</div>\n<span>c >> d</span>\nEOF\n"
    expect(extractWriteTargets(command)).toEqual(['out.html'])
  })

  it('captures plain redirects and quoted targets', () => {
    expect(extractWriteTargets('echo hi > notes.md')).toEqual(['notes.md'])
    expect(extractWriteTargets('printf x > "my file.txt"')).toEqual(['"my file.txt"'])
  })

  it('skips append and fd/stderr redirects', () => {
    expect(extractWriteTargets('echo x >> log.txt')).toEqual([])
    expect(extractWriteTargets('cmd 2> err.log')).toEqual([])
    expect(extractWriteTargets('cmd >& both.log')).toEqual([])
    expect(extractWriteTargets('cmd &> both.log')).toEqual([])
  })

  it('captures tee targets but skips append forms', () => {
    expect(extractWriteTargets('echo x | tee out.txt')).toEqual(['out.txt'])
    expect(extractWriteTargets('echo x | tee -i out.txt')).toEqual(['out.txt'])
    expect(extractWriteTargets('echo x | tee -a append.log')).toEqual([])
  })

  it('captures sed -i targets (quoted and bare scripts)', () => {
    expect(extractWriteTargets("sed -i 's/a/b/' file.txt")).toEqual(['file.txt'])
    expect(extractWriteTargets('sed -i s/a/b/ file.txt')).toEqual(['file.txt'])
    expect(extractWriteTargets("sed -i.bak 's/a/b/' file.txt")).toEqual(['file.txt'])
  })

  it('ignores deferred forms (cp, mv, python) and plain text', () => {
    expect(extractWriteTargets('cp a.txt b.txt')).toEqual([])
    expect(extractWriteTargets('mv a.txt b.txt')).toEqual([])
    expect(extractWriteTargets('python3 -c "open(\'x\', \'w\')"')).toEqual([])
    expect(extractWriteTargets('git status')).toEqual([])
  })
})

describe('expandShellPath', () => {
  const env = { DSH_HOME: '/home/user/.dsh' }
  const home = '/home/user'

  it('expands environment variables (the host resolves what the fold cannot)', () => {
    expect(expandShellPath('$DSH_HOME/scratch/x.html', env, home, undefined)).toBe('/home/user/.dsh/scratch/x.html')
    expect(expandShellPath('${DSH_HOME}/y.html', env, home, undefined)).toBe('/home/user/.dsh/y.html')
  })

  it('rejects an unset variable rather than guessing a truncated path', () => {
    expect(expandShellPath('$UNDEFINED/x.html', env, home, undefined)).toBeNull()
  })

  it('expands a leading tilde and resolves relative targets against the cwd', () => {
    expect(expandShellPath('~/x.html', env, home, undefined)).toBe('/home/user/x.html')
    expect(expandShellPath('out.html', env, home, '/work')).toBe('/work/out.html')
  })

  it('rejects globs, command substitution, and anchorless relatives', () => {
    expect(expandShellPath('*.html', env, home, undefined)).toBeNull()
    expect(expandShellPath('$(echo x)', env, home, undefined)).toBeNull()
    expect(expandShellPath('out.html', env, home, undefined)).toBeNull()
  })

  it('strips surrounding quotes', () => {
    expect(expandShellPath('"my file.txt"', env, home, '/work')).toBe('/work/my file.txt')
  })
})
