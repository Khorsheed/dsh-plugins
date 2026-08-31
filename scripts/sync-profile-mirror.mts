#!/usr/bin/env node
/**
 * sync-profile-mirror — thin wrapper over scripts/sync-mirror.mts
 * (kind `profile`). Kept for muscle memory and existing docs; new artifact
 * kinds go through sync-mirror directly.
 *
 * Usage: npx tsx scripts/sync-profile-mirror.mts <name> [--dry-run|--check]
 * @module scripts/sync-profile-mirror
 */
const name = process.argv.slice(2).find((a) => !a.startsWith('--'))
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'))
process.argv = [process.argv[0], process.argv[1], 'profile', ...(name === undefined ? [] : [name]), ...flags]
await import('./sync-mirror.mts')
