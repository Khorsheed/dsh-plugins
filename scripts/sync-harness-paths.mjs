#!/usr/bin/env node
/**
 * sync-harness-paths: regenerate packages/taskpilot/tsconfig.paths.json, the
 * gitignored dev-time type-resolution map both taskpilot tsconfigs extend.
 * The npm release chain is incomplete (client packages depend on unpublished
 * @deepseek-ai/dsh-compact), so taskpilot resolves product types through
 * `paths` into a local deepseek-harness checkout's lib/types artifacts —
 * DSH_HARNESS selects the checkout (default ~/code/deepseek-harness), the
 * same dev-time path dependency as scripts/gen-typert.mts and the shared
 * vitest preset (build/vitest.ts).
 *
 * Usage: node scripts/sync-harness-paths.mjs   (or DSH_HARNESS=/elsewhere …)
 */
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const harness = process.env['DSH_HARNESS'] ?? join(homedir(), 'code/deepseek-harness')
const out = join(REPO_ROOT, 'packages/taskpilot/tsconfig.paths.json')

/** Specifier → harness-relative type artifact candidates (first existing wins). */
const TARGETS = {
  '@deepseek-ai/cordis': ['vendor/cordis/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-commands': ['packages/interaction/commands/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-commands/remote': ['packages/interaction/commands/lib/typert.remote-client.d.ts'],
  '@deepseek-ai/dsh-jobs': ['packages/jobs/jobs/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-jobs/brand': ['packages/jobs/jobs/lib/types/brand.d.ts'],
  '@deepseek-ai/dsh-subagent': ['packages/subagent/subagent/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-session': ['packages/core/session/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-session/types': ['packages/core/session/lib/types/types.d.ts'],
  '@deepseek-ai/dsh-invariants': ['packages/runtime-diagnostics/invariants/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-client-ui-slots': ['packages/client/ui-slots/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-client-ui-primitives': ['packages/client/ui-primitives/lib/types/index.d.ts'],
  // Host line ≤0.1.1 (removed in 0.1.2-alpha.1) — skipped with a warning when absent.
  '@deepseek-ai/dsh-client-runtime/client': ['packages/client/runtime/lib/types/client/index.d.ts'],
  // Host line ≥0.1.2 (store engine rehomed out of client-runtime).
  '@deepseek-ai/dsh-client-store': ['packages/client/store/lib/types/index.d.ts'],
  '@deepseek-ai/dsh-client-ui-conversation/client': ['packages/client/ui-conversation/lib/types/client/index.d.ts'],
  '@deepseek-ai/dsh-client-ui-chat/client': ['packages/client/ui-chat/lib/types/client/index.d.ts'],
  '@deepseek-ai/dsh-client-ui-layout/client': ['packages/client/ui-layout/lib/types/client/index.d.ts'],
  '@deepseek-ai/dsh-client-locale/client': ['packages/client/locale/lib/types/client/index.d.ts'],
  '@deepseek-ai/dsh-api-remotes/client': ['packages/api/remotes/lib/types/client/index.d.ts'],
  '@deepseek-ai/dsh-client-connection/client': ['packages/client/connection/lib/types/client/index.d.ts'],
  // Host line ≤0.1.1 (ApiProxy package removed in 0.1.2-alpha.1).
  '@deepseek-ai/dsh-host-apiproxy/api': ['packages/host/apiproxy/lib/types/api/index.d.ts'],
  '@deepseek-ai/dsh-host-apiproxy/client': ['packages/host/apiproxy/lib/types/fetch/client.d.ts'],
  '@deepseek-ai/dsh-tools/presentation': ['packages/core/tools/lib/types/presentation.d.ts'],
}

const paths = {}
const skipped = []
for (const [specifier, candidates] of Object.entries(TARGETS)) {
  const hit = candidates.map((target) => join(harness, target)).find((absolute) => existsSync(absolute))
  if (hit === undefined) {
    skipped.push(specifier)
    continue
  }
  paths[specifier] = [hit]
}
if (skipped.length > 0) {
  console.warn(`sync-harness-paths: skipped ${skipped.join(', ')} — not present in this host line (DSH_HARNESS=${harness})`)
}

writeFileSync(out, `${JSON.stringify({ compilerOptions: { paths } }, null, 2)}\n`)
console.log(`sync-harness-paths: wrote ${out} (DSH_HARNESS=${harness})`)
