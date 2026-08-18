/**
 * TaskPilot bundle layout, via the shared clientBundle preset:
 *
 * - lib/index.js    — node half (ESM), registers the stop/interrupt commands.
 * - lib/invariant.js — invariant companion (registered by the invariants service).
 * - lib/client.js   — browser half, closure-factory bundle speaking the
 *   @deepseek-ai/dsh-client-modules loader contract (window.__ModuleLoader__).
 *
 * The preset owns the loader handoff, the platform-module external table
 * (shared with the shell's frozen module table), the CSS-modules pipeline,
 * and the bundle purity gate — see build/tsdown.client.ts. The only
 * package-local facts are the plugin id and the tsc-emitted lib entries.
 */
import { clientBundle } from '../../build/tsdown.client.ts'

export default clientBundle('@khorsheed/dsh-taskpilot', ['lib/types/index.js', 'lib/types/invariant.js'])
