import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectAbsolutePaths, detectSecrets, isForbiddenPath, scanFile } from './check-repo-hygiene.ts'

// Credential-shaped test inputs are built dynamically so the spec file itself
// never contains a string that the checker would flag (it scans its own tree).

describe('detectAbsolutePaths', () => {
  it('flags macOS home paths with a real username', () => {
    expect(detectAbsolutePaths(`import x from "${'/Users/'}zhuyudan/code/deepseek-harness/x.ts"`))
      .toEqual([`${'/Users/'}zhuyudan`])
  })

  it('flags /home paths unless the username is the user placeholder', () => {
    expect(detectAbsolutePaths(`"memory_paths":{"auto":"${'/home/'}zhuyudan/.dsh/local"`)).toEqual([`${'/home/'}zhuyudan`])
    expect(detectAbsolutePaths('"auto":"/home/user/.dsh/local-agent/claude"')).toEqual([])
  })

  it('flags Windows user paths', () => {
    expect(detectAbsolutePaths('cwd: C:\\Users\\zhuyudan\\code')).toEqual(['C:\\Users\\zhuyudan'])
  })

  it('allows relative and neutral absolute paths', () => {
    expect(detectAbsolutePaths('path: ./src/index.ts, cwd: /private/tmp/claude-sample, root: /tmp/cc-socks')).toEqual([])
  })

  it('ignores doc-style placeholders, which are not real usernames', () => {
    expect(detectAbsolutePaths('flags macOS `/Users/<name>/…`, Linux `/home/<name>/…`, Windows `C:\\Users\\…`'))
      .toEqual([])
  })
})

describe('detectSecrets', () => {
  it('flags key-shaped strings', () => {
    const sk = `sk-${'a'.repeat(30)}`
    const akia = `AKIA${'A'.repeat(16)}`
    const ghp = `ghp_${'b'.repeat(26)}`
    const pem = `-----BEGIN ${'RSA PRIVATE KEY-----'}`
    expect(detectSecrets(`key = "${sk}"`)).toContain(sk)
    expect(detectSecrets(`aws: ${akia}`)).toContain(akia)
    expect(detectSecrets(ghp)).toContain(ghp)
    expect(detectSecrets(pem)).toContain(`-----BEGIN ${'RSA PRIVATE KEY-----'}`)
  })

  it('flags quoted key=value assignments with long values', () => {
    const apiKey = `AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`
    expect(detectSecrets(`api_key = "${apiKey}"`)).toHaveLength(1)
    // JSON form: quoted key, Bearer-prefixed long value (built so the spec
    // file itself never contains a matching string).
    expect(detectSecrets(`"authorization"${': "Bearer '}${'a'.repeat(32)}"`)).toHaveLength(1)
  })

  it('ignores prose and short/non-credential values', () => {
    expect(detectSecrets('the OAuth token is sent to that endpoint; apiKeySource: "none"')).toEqual([])
    expect(detectSecrets('"session_id":"7da44138-6931-4066-ac32-1b3ffcc1a072"')).toEqual([])
  })
})

describe('isForbiddenPath', () => {
  it('flags tooling/scratch shapes', () => {
    for (const path of [
      '.playwright-mcp/page-2026-08-16.yml',
      'scratch-preflight-debug.mts',
      'packages/whalesong/tsconfig.tsbuildinfo',
      'out.log',
      '.DS_Store',
      'node_modules/x/index.js',
      'packages/foo/lib/index.js',
      '.env',
    ]) expect(isForbiddenPath(path), path).toBe(true)
  })

  it('passes source and fixture paths', () => {
    for (const path of [
      'scripts/check-repo-hygiene.ts',
      'packages/local-agent-kimi/tests/fixtures/two-round-resume.wire.jsonl',
      'packages/ankh-guard/scripts/dsh-watchdog.sh',
      'docs/screenshots/02-message-timeline.png',
      'AGENTS.md',
    ]) expect(isForbiddenPath(path), path).toBe(false)
  })
})

describe('scanFile', () => {
  it('reports absolute paths with line numbers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-scan-'))
    const file = join(dir, 'bad.txt')
    writeFileSync(file, `line one is fine\nline two is fine\nimport x from "${'/Users/'}zhuyudan/code/deepseek-harness"\n`)
    const findings = scanFile(file)
    rmSync(dir, { recursive: true })
    expect(findings.map((f) => `${f.line}:${f.kind}:${f.match}`)).toEqual([
      `3:absolute path:${'/Users/'}zhuyudan`,
    ])
  })

  it('skips binary files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-scan-'))
    const file = join(dir, 'blob.bin')
    writeFileSync(file, Buffer.from([0, 1, 2, 3, 4]))
    expect(scanFile(file)).toEqual([])
    rmSync(dir, { recursive: true })
  })
})
