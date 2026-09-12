/** Run the real orchestrator with fake executables and an isolated home: no production processes. */
import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const repo = resolve(import.meta.dirname, '..'), roots: string[] = []
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })
function fixture({ dependency = true, bundle = true, selfMounting = true, failure = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deploy-flow-')); roots.push(root)
  const home = join(root, 'home'), harness = join(root, 'harness'), profile = join(home, 'profiles/web'), bin = join(root, 'bin')
  for (const p of [profile, bin, join(home, 'state'), join(home, 'tarballs'), join(harness, 'apps/cli/lib'), join(root, 'packages/demo')]) mkdirSync(p, { recursive: true })
  const name = '@khorsheed/dsh-demo', old = join(home, 'tarballs/khorsheed-dsh-demo-1.0.0+old.tgz')
  writeFileSync(old, '{}')
  writeFileSync(join(harness, 'apps/cli/lib/bin.js'), '// fixture')
  writeFileSync(join(root, 'packages/demo/package.json'), JSON.stringify({ name, version: '1.0.0', ...(selfMounting ? { dsh: { bundle: { patch: 'cordis.patch.yml' } } } : {}) }))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: dependency ? { [name]: `file:${old}` } : {}, dsh: { profile: { bundles: bundle ? [name] : [] } } }))
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), "overrides:\nminimumReleaseAgeExclude:\n  - '@khorsheed/*'\n")
  // Stub only the external command boundary. The production orchestrator and scanner run unchanged.
  const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const cmd=path.basename(process.argv[1]),args=process.argv.slice(2),home=process.env.DSH_HOME,profile=path.join(home,'profiles/web'),file=path.join(profile,'package.json');
fs.appendFileSync(process.env.CALL_LOG,JSON.stringify([cmd,...args])+'\\n');
if(process.env.FAILURE==='add'&&cmd==='node'&&args[1]==='plugin')process.exit(3);
if(process.env.FAILURE==='gate'&&cmd==='node'&&['preflight','schedule-exit'].includes(args[1]))process.exit(4);
if(cmd==='git')process.exit(0);
if(cmd==='npx') { const dir=args[args.indexOf('--package')+1],out=args[args.indexOf('--out')+1],p=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'khorsheed-dsh-demo-1.0.0.tgz'),JSON.stringify(p)); }
if(cmd==='node'&&args[1]==='plugin') { const p=JSON.parse(fs.readFileSync(file));for(const tar of args.slice(3,args.indexOf('--profile'))){const pkg=JSON.parse(fs.readFileSync(tar));p.dependencies[pkg.name]='file:'+tar;if(process.env.FAILURE!=='registration'&&!p.dsh.profile.bundles.includes(pkg.name))p.dsh.profile.bundles.push(pkg.name);}fs.writeFileSync(file,JSON.stringify(p)); }
if(cmd==='pnpm'&&args[0]==='install') { const p=JSON.parse(fs.readFileSync(file));for(const [name,spec] of Object.entries(p.dependencies)){const pkg=JSON.parse(fs.readFileSync(spec.slice(5)));const dir=path.join(profile,'node_modules',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg));if(pkg.dsh?.bundle?.patch&&process.env.FAILURE!=='patch')fs.writeFileSync(path.join(dir,pkg.dsh.bundle.patch),'# fixture');}if(process.env.FAILURE==='installed-link')fs.symlinkSync('absent',path.join(profile,'node_modules/lost')); }
if(cmd==='node'&&args[1]==='schedule-exit')fs.appendFileSync(path.join(home,'state/watchdog.log'),'canary PASS\\n');
if(cmd==='curl'){const marker=path.join(home,'curl-once');const first=process.env.FAILURE==='http-once'&&!fs.existsSync(marker);fs.writeFileSync(marker,'1');process.stdout.write(first?'500':'401');}
`
  for (const command of ['node', 'pnpm', 'npx', 'git', 'sleep', 'curl']) { const p = join(bin, command); writeFileSync(p, stub); chmodSync(p, 0o755) }
  return { root, home, harness, old, profile, run(noRestart = true, extra: string[] = []) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, join(repo, 'scripts/deploy-3080.mts'), '--package', 'packages/demo', ...(noRestart ? ['--no-restart'] : []), ...extra], {
      cwd: root, env: { ...process.env, DSH_HOME: home, DSH_HARNESS: harness, PATH: bin, CALL_LOG: join(root, 'calls'), FAILURE: failure }, encoding: 'utf8', timeout: 15000,
    })
    const calls = existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').map(x => JSON.parse(x) as string[]) : []
    return { ...result, calls, output: result.stdout + result.stderr }
  } }
}

describe('deploy 3080 flow', () => {
  it('reports refresh-only truthfully and never requests a restart', () => {
    const f = fixture(), r = f.run()
    expect(r.status, r.output).toBe(0)
    expect(r.output).toContain('未重启'); expect(r.output).not.toContain('canary PASS'); expect(r.output).not.toContain('已上线')
    expect(r.calls.some(c => c[1]?.endsWith('cli.js') && c[2] === 'preflight')).toBe(true)
    expect(r.calls.some(c => c.includes('schedule-exit') || c.includes('plugin'))).toBe(false)
  })
  it.each([{ dependency: false, bundle: false }, { dependency: true, bundle: false }])('uses official add for missing registration: %j', options => {
    const f = fixture(options), r = f.run()
    expect(r.status, r.output).toBe(0)
    const add = r.calls.findIndex(c => c.includes('plugin'))
    expect(add).toBeGreaterThan(r.calls.findIndex(c => c.includes('--out')))
    expect(r.calls[add].slice(2, 4)).toEqual(['plugin', 'add'])
    expect(r.calls[add].at(-2)).toBe('--profile'); expect(r.calls[add].at(-1)).toBe('web')
    expect(r.calls[add + 1]).toEqual(['pnpm', 'install'])
    expect(JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')).dsh.profile.bundles).toContain('@khorsheed/dsh-demo')
  })
  it.each(['add', 'registration', 'patch', 'installed-link'])('refuses %s failures before proof/restart, retains old artifact and releases lock', failure => {
    const f = fixture({ bundle: false, failure }), r = f.run()
    expect(r.status).not.toBe(0); expect(r.output).not.toContain('deploy-3080 OK')
    expect(r.calls.some(c => c.includes('record') || c.includes('schedule-exit'))).toBe(false)
    expect(existsSync(f.old)).toBe(true); expect(existsSync(join(f.home, 'state/deploy-3080.pid'))).toBe(false)
  })
  it('finds an existing broken link before any command or profile write', () => {
    const f = fixture(); symlinkSync('absent', join(f.home, 'lost'))
    const before = readFileSync(join(f.profile, 'package.json'), 'utf8'), r = f.run()
    expect(r.status).not.toBe(0); expect(r.calls).toEqual([])
    expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toBe(before)
  })
  it('does not auto-mount a new internal companion without a bundle', () => {
    const r = fixture({ dependency: false, bundle: false, selfMounting: false }).run()
    expect(r.status).not.toBe(0); expect(r.calls).toEqual([])
  })
  it('retains the update path for an existing dependency-only package', () => {
    const r = fixture({ bundle: false, selfMounting: false }).run()
    expect(r.status, r.output).toBe(0); expect(r.calls.some(c => c.includes('plugin'))).toBe(false)
  })
  it('reports canary success only on the restart path, and not when the guard refuses', () => {
    const ok = fixture({ failure: 'http-once' }).run(false);expect(ok.calls.filter(c=>c[0]==='curl')).toHaveLength(2); expect(ok.status, ok.output).toBe(0); expect(ok.output).toContain('已上线'); expect(ok.output).toContain('canary PASS')
    const f = fixture({ failure: 'gate' }), bad = f.run(false)
    expect(bad.status).not.toBe(0); expect(bad.output).not.toContain('已上线'); expect(existsSync(f.old)).toBe(true)
    expect(existsSync(join(f.home, 'state/deploy-3080.pid'))).toBe(false)
  }, 15000)
  it('leaves another live deploy lock untouched', () => {
    const f = fixture(), lock = join(f.home, 'state/deploy-3080.pid'); writeFileSync(lock, String(process.pid))
    const r = f.run(); expect(r.status).not.toBe(0); expect(r.calls).toEqual([]); expect(readFileSync(lock, 'utf8')).toBe(String(process.pid))
  })
  it('omits --initiator by default (the guard routes to the caller session) and passes an explicit session id through', () => {
    // The old default ($USER) routed every restart report to a session that
    // never exists — the report stayed pending until the next restart
    // overwrote it (silently lost). The flag must only appear on demand.
    const dflt = fixture().run(false)
    expect(dflt.status, dflt.output).toBe(0)
    const scheduleExit = dflt.calls.find(c => c[1]?.endsWith('cli.js') && c[2] === 'schedule-exit')
    expect(scheduleExit, dflt.calls.map(c => c.join(' ')).join('\n')).toBeDefined()
    expect(scheduleExit).not.toContain('--initiator')
    const named = fixture().run(false, ['--initiator', 'session-abc'])
    expect(named.status, named.output).toBe(0)
    const namedExit = named.calls.find(c => c[1]?.endsWith('cli.js') && c[2] === 'schedule-exit')!
    expect(namedExit.slice(namedExit.indexOf('--initiator'))).toEqual(['--initiator', 'session-abc'])
  }, 30000)
})
