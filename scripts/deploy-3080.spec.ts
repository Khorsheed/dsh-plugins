/** Run the real orchestrator with fake executables and an isolated home: no production processes. */
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const repo = resolve(import.meta.dirname, '..'), roots: string[] = []
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })

// Stub only the external command boundary. The production orchestrator and scanner run unchanged.
// The pack step models pack-dist's workspace:* → ^<version> family-edge rewrite (so a family
// bundle's tarball carries registry-style member edges); the install step models transitive
// resolution through the pnpm-workspace.yaml overrides pins — a family bundle's members land
// inside its own dependency tree, nested here the way pnpm nests them under the store entry.
const STUB = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const cmd=path.basename(process.argv[1]),args=process.argv.slice(2),home=process.env.DSH_HOME,profile=path.join(home,'profiles/web'),file=path.join(profile,'package.json');
fs.appendFileSync(process.env.CALL_LOG,JSON.stringify([cmd,...args])+'\\n');
if(process.env.FAILURE==='add'&&cmd==='node'&&args[1]==='plugin')process.exit(3);
if(process.env.FAILURE==='gate'&&cmd==='node'&&['preflight','schedule-exit'].includes(args[1]))process.exit(4);
if(cmd==='git')process.exit(0);
if(cmd==='npx') { const dir=args[args.indexOf('--package')+1],out=args[args.indexOf('--out')+1],p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')); for(const sec of ['dependencies','peerDependencies','devDependencies'])for(const [n,s]of Object.entries(p[sec]??{}))if(String(s).startsWith('workspace:')){for(const d of fs.readdirSync('packages')){const q=path.join('packages',d,'package.json');if(fs.existsSync(q)){const w=JSON.parse(fs.readFileSync(q,'utf8'));if(w.name===n){p[sec][n]='^'+w.version;break}}}} fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'khorsheed-'+p.name.replace('@khorsheed/','')+'-'+p.version+'.tgz'),JSON.stringify(p)); }
if(cmd==='node'&&args[1]==='plugin') { const p=JSON.parse(fs.readFileSync(file));for(const tar of args.slice(3,args.indexOf('--profile'))){const pkg=JSON.parse(fs.readFileSync(tar));p.dependencies[pkg.name]='file:'+tar;if(process.env.FAILURE!=='registration'&&!p.dsh.profile.bundles.includes(pkg.name))p.dsh.profile.bundles.push(pkg.name);}fs.writeFileSync(file,JSON.stringify(p)); }
if(cmd==='pnpm'&&args[0]==='install') { const p=JSON.parse(fs.readFileSync(file)),ws=fs.existsSync(path.join(profile,'pnpm-workspace.yaml'))?fs.readFileSync(path.join(profile,'pnpm-workspace.yaml'),'utf8'):'';
 const pin=(n)=>{const tag="'"+n+"': 'file:";const i=ws.indexOf(tag);if(i<0)return null;const rest=ws.slice(i+tag.length);return rest.slice(0,rest.indexOf("'"));};
 const materialize=(pkg,dir)=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg));if(pkg.dsh&&pkg.dsh.bundle&&pkg.dsh.bundle.patch&&process.env.FAILURE!=='patch')fs.writeFileSync(path.join(dir,pkg.dsh.bundle.patch),'# fixture');};
 for(const [name,spec] of Object.entries(p.dependencies)){const pkg=JSON.parse(fs.readFileSync(spec.slice(5))),dir=path.join(profile,'node_modules',name);materialize(pkg,dir);for(const [dn,ds]of Object.entries(pkg.dependencies??{})){if(String(ds).startsWith('file:'))continue;const tar=pin(dn);if(tar)materialize(JSON.parse(fs.readFileSync(tar)),path.join(dir,'node_modules',dn));}}
 if(process.env.FAILURE==='installed-link')fs.symlinkSync('absent',path.join(profile,'node_modules/lost')); }
if(cmd==='node'&&(args[1]==='schedule-exit'||args[1]==='reconfigure'))fs.appendFileSync(path.join(home,'state/watchdog.log'),'canary PASS\\n');
if(cmd==='curl'){const marker=path.join(home,'curl-once');const first=process.env.FAILURE==='http-once'&&!fs.existsSync(marker);fs.writeFileSync(marker,'1');process.stdout.write(first?'500':'401');}
`
function writeStubs(bin: string) {
  for (const command of ['node', 'pnpm', 'npx', 'git', 'sleep', 'curl']) { const p = join(bin, command); writeFileSync(p, STUB); chmodSync(p, 0o755) }
}

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
  writeStubs(bin)
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
    // The preflight window is deliberately wider than the guard's 120s idle-machine
    // default — under multi-agent load a clean dry-run legitimately exceeds it.
    expect(scheduleExit!.slice(scheduleExit!.indexOf('--preflight-timeout-ms'))).toEqual(['--preflight-timeout-ms', '300000'])
    const named = fixture().run(false, ['--initiator', 'session-abc'])
    expect(named.status, named.output).toBe(0)
    const namedExit = named.calls.find(c => c[1]?.endsWith('cli.js') && c[2] === 'schedule-exit')!
    expect(namedExit.slice(namedExit.indexOf('--initiator'))).toEqual(['--initiator', 'session-abc'])
  }, 30000)

  // The watchdog pins its preflight runner by path+sha256; a deploy that
  // rebuilds ankh-guard's runner makes schedule-exit refuse, so the flow must
  // rebind through reconfigure with the live spec's own fields (2026-09-26).
  function writeLaunchSpec(f: { home: string }, runnerContent: string, recordedSha: string) {
    const runner = join(f.home, 'state/preflight-runner.js')
    writeFileSync(runner, runnerContent)
    writeFileSync(join(f.home, 'state/launch-spec.json'), JSON.stringify({ version: 1, active: {
      command: 'node harness/bin.js web', port: 3080, home: f.home,
      credentialRepo: 'harness-repo', harnessRoot: 'harness-root', profile: 'web',
      preflight: { surface: 'built', runnerPath: runner, runnerSha256: recordedSha, installAnchor: 'anchor/package.json', candidateProbeCommand: 'probe cmd' },
    } }))
    return runner
  }
  it('keeps schedule-exit when the bound runner is unchanged', () => {
    const f = fixture()
    writeLaunchSpec(f, '// runner', createHash('sha256').update('// runner').digest('hex'))
    const r = f.run(false)
    expect(r.status, r.output).toBe(0)
    expect(r.calls.some(c => c[2] === 'schedule-exit')).toBe(true)
    expect(r.calls.some(c => c[2] === 'reconfigure')).toBe(false)
  })
  it('rebinds through reconfigure with the live spec fields when the runner drifted, re-recording the credential first', () => {
    const f = fixture()
    const runner = writeLaunchSpec(f, '// new runner build', 'deadbeef'.repeat(8))
    const r = f.run(false)
    expect(r.status, r.output).toBe(0)
    expect(r.output).toContain('rebinding the launch spec through reconfigure')
    expect(r.calls.some(c => c[2] === 'schedule-exit')).toBe(false)
    const records = r.calls.filter(c => c[1]?.endsWith('cli.js') && c[2] === 'record')
    const reconfigure = r.calls.find(c => c[1]?.endsWith('cli.js') && c[2] === 'reconfigure')
    expect(reconfigure, r.calls.map(c => c.join(' ')).join('\n')).toBeDefined()
    expect(records.length).toBeGreaterThanOrEqual(2) // step 4 plus the freshness re-record
    expect(r.calls.indexOf(reconfigure!)).toBeGreaterThan(r.calls.lastIndexOf(records.at(-1)!))
    expect(reconfigure).toContain('--on-failure'); expect(reconfigure).toContain('restore-previous')
    expect(reconfigure).toContain('--candidate-probe-command'); expect(reconfigure).toContain('probe cmd')
    expect(reconfigure).toContain('--preflight-runner'); expect(reconfigure).toContain(runner)
    expect(reconfigure!.slice(reconfigure!.indexOf('--start'))[1]).toBe('node harness/bin.js web')
  })
  it('refuses the drift rebind loudly when the live spec lacks a field reconfigure needs', () => {
    const f = fixture()
    writeLaunchSpec(f, '// new runner build', 'deadbeef'.repeat(8))
    const spec = JSON.parse(readFileSync(join(f.home, 'state/launch-spec.json'), 'utf8'))
    delete spec.active.preflight.candidateProbeCommand
    writeFileSync(join(f.home, 'state/launch-spec.json'), JSON.stringify(spec))
    const r = f.run(false)
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('candidateProbeCommand')
    expect(r.calls.some(c => c[2] === 'reconfigure' || c[2] === 'schedule-exit')).toBe(false)
  })
})

/** A family bundle (packages/bundle) whose one member (packages/demo) currently sits in the profile as a standalone install. */
function familyFixture({ memberRegistered = true, bundleRegistered = true, memberPin = true, memberStash = true, coDeploy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deploy-family-')); roots.push(root)
  const home = join(root, 'home'), harness = join(root, 'harness'), profile = join(home, 'profiles/web'), bin = join(root, 'bin')
  for (const p of [profile, bin, join(home, 'state'), join(home, 'tarballs'), join(harness, 'apps/cli/lib'), join(root, 'packages/demo'), join(root, 'packages/bundle')]) mkdirSync(p, { recursive: true })
  const member = '@khorsheed/dsh-demo', bundleName = '@khorsheed/dsh-bundle'
  const memberManifest = { name: member, version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }
  const bundleSourceManifest = { name: bundleName, version: '1.0.0', dependencies: { [member]: 'workspace:*' }, dsh: { bundle: { patch: 'cordis.patch.yml', kind: 'family', members: [member] } } }
  const bundleDistManifest = { ...bundleSourceManifest, dependencies: { [member]: '^1.0.0' } } // as pack-dist rewrites it
  const memberOld = join(home, 'tarballs/khorsheed-dsh-demo-1.0.0+old.tgz'), bundleOld = join(home, 'tarballs/khorsheed-dsh-bundle-1.0.0+old.tgz')
  if (memberStash) writeFileSync(memberOld, JSON.stringify(memberManifest)) // the pin target must unpack to a real manifest
  writeFileSync(bundleOld, JSON.stringify(bundleDistManifest))
  writeFileSync(join(harness, 'apps/cli/lib/bin.js'), '// fixture')
  writeFileSync(join(root, 'packages/demo/package.json'), JSON.stringify(memberManifest))
  writeFileSync(join(root, 'packages/bundle/package.json'), JSON.stringify(bundleSourceManifest))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    dependencies: { ...(memberRegistered ? { [member]: `file:${memberOld}` } : {}), ...(bundleRegistered ? { [bundleName]: `file:${bundleOld}` } : {}) },
    dsh: { profile: { bundles: [...(memberRegistered ? [member] : []), ...(bundleRegistered ? [bundleName] : [])] } },
  }))
  const pins = [...(memberPin ? [`  '${member}': 'file:${memberOld}'`] : []), ...(bundleRegistered ? [`  '${bundleName}': 'file:${bundleOld}'`] : [])]
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), `overrides:\n${pins.join('\n')}${pins.length ? '\n' : ''}minimumReleaseAgeExclude:\n  - '@khorsheed/*'\n`)
  writeStubs(bin)
  return { root, home, profile, member, bundleName, memberOld, bundleOld, run() {
    // Bundle first, member second — proves the flow is safe in any --package order.
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, join(repo, 'scripts/deploy-3080.mts'), '--package', 'packages/bundle', ...(coDeploy ? ['--package', 'packages/demo'] : []), '--no-restart'], {
      cwd: root, env: { ...process.env, DSH_HOME: home, DSH_HARNESS: harness, PATH: bin, CALL_LOG: join(root, 'calls') }, encoding: 'utf8', timeout: 15000,
    })
    const calls = existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').map(x => JSON.parse(x) as string[]) : []
    return { ...result, calls, output: result.stdout + result.stderr }
  } }
}

describe('deploy 3080 family bundle member retreat', () => {
  it('retreats the member out of dependencies and the bundles roster while keeping its overrides pin', () => {
    const f = familyFixture(), r = f.run()
    expect(r.status, r.output).toBe(0)
    const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8'))
    expect(Object.keys(manifest.dependencies)).toEqual(['@khorsheed/dsh-bundle'])
    expect(manifest.dependencies['@khorsheed/dsh-bundle']).toMatch(/file:.*khorsheed-dsh-bundle-1\.0\.0\+\d{10}\.tgz$/)
    expect(manifest.dsh.profile.bundles).toEqual(['@khorsheed/dsh-bundle'])
    const ws = readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8')
    expect(ws).toContain(`  '${f.member}': 'file:${f.memberOld}'\n`) // the member pin stays, untouched
    expect(existsSync(f.memberOld)).toBe(true) // a member not co-named keeps its tarball (prune only touches named packages)
    // The member still resolves, but only inside the bundle's installed tree.
    expect(existsSync(join(f.profile, 'node_modules/@khorsheed/dsh-demo'))).toBe(false)
    expect(existsSync(join(f.profile, 'node_modules/@khorsheed/dsh-bundle/node_modules/@khorsheed/dsh-demo/package.json'))).toBe(true)
  })
  it('is idempotent: a repeated deploy logs the skip and keeps the retreated shape', () => {
    const f = familyFixture()
    expect(f.run().status).toBe(0)
    rmSync(join(f.root, 'calls'), { force: true }) // per-run call log
    const r = f.run()
    expect(r.status, r.output).toBe(0)
    expect(r.output).toContain('nothing to retreat')
    const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8'))
    expect(Object.keys(manifest.dependencies)).toEqual(['@khorsheed/dsh-bundle'])
    expect(manifest.dsh.profile.bundles).toEqual(['@khorsheed/dsh-bundle'])
    expect(readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8')).toContain(`'${f.member}': 'file:${f.memberOld}'`)
  })
  it('co-named member packs first and retreats under its bundle, its pin refreshed to the fresh tarball', () => {
    const f = familyFixture({ coDeploy: true }), r = f.run()
    expect(r.status, r.output).toBe(0)
    // The member never goes through official add — it rides the bundle's tree.
    expect(r.calls.some(c => c.includes('plugin'))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8'))
    expect(Object.keys(manifest.dependencies)).toEqual(['@khorsheed/dsh-bundle'])
    expect(manifest.dsh.profile.bundles).toEqual(['@khorsheed/dsh-bundle'])
    const pin = new RegExp(`'@khorsheed/dsh-demo': 'file:([^']*)'`).exec(readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8'))![1]
    expect(pin).toMatch(/khorsheed-dsh-demo-1\.0\.0\+\d{10}\.tgz$/) // refreshed to this call's tarball
    expect(existsSync(pin)).toBe(true)
    expect(existsSync(f.memberOld)).toBe(false) // the co-named member's stale tarball is pruned after success
  })
  it('first-installs the bundle through official plugin add while retreating the standalone member', () => {
    const f = familyFixture({ bundleRegistered: false }), r = f.run()
    expect(r.status, r.output).toBe(0)
    const add = r.calls.findIndex(c => c.includes('plugin'))
    expect(add).toBeGreaterThan(-1)
    expect(add).toBeGreaterThan(r.calls.findIndex(c => c.includes('--out'))) // registration after packing
    expect(r.calls[add].slice(2, 4)).toEqual(['plugin', 'add'])
    expect(r.calls[add].some(c => c.includes('khorsheed-dsh-bundle-'))).toBe(true) // only the bundle registers
    expect(r.calls[add].some(c => c.includes('khorsheed-dsh-demo-'))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8'))
    expect(Object.keys(manifest.dependencies)).toEqual(['@khorsheed/dsh-bundle'])
    expect(manifest.dsh.profile.bundles).toEqual(['@khorsheed/dsh-bundle'])
    expect(readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8')).toContain(`'${f.member}': 'file:${f.memberOld}'`)
  })
  it('skips and logs a member the profile never carried', () => {
    const f = familyFixture({ memberRegistered: false }), r = f.run()
    expect(r.status, r.output).toBe(0)
    expect(r.output).toContain('@khorsheed/dsh-demo is not in the profile manifest — nothing to retreat')
    expect(Object.keys(JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')).dependencies)).toEqual(['@khorsheed/dsh-bundle'])
  })
  it('restores a missing member pin from the newest stashed tarball, inside the overrides block', () => {
    const f = familyFixture({ memberRegistered: false, memberPin: false }), r = f.run()
    expect(r.status, r.output).toBe(0)
    expect(r.output).toContain('restored missing overrides pin for family member @khorsheed/dsh-demo')
    const ws = readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8')
    const block = ws.slice(ws.indexOf('overrides:'), ws.indexOf('minimumReleaseAgeExclude:'))
    expect(block).toContain(`  '${f.member}': 'file:${f.memberOld}'`)
  })
  it('refuses before the profile install when a member has neither a pin nor a stashed tarball', () => {
    const f = familyFixture({ memberRegistered: false, memberPin: false, memberStash: false }), r = f.run()
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('family member @khorsheed/dsh-demo has no overrides pin')
    expect(r.calls.some(c => c.includes('install'))).toBe(false)
    expect(existsSync(f.bundleOld)).toBe(true) // previous artifact retained on the failure path
  })
})
