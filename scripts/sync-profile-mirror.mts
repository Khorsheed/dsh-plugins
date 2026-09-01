#!/usr/bin/env node
/**
 * sync-profile-mirror — thin wrapper over scripts/sync-mirror.mts
 * (kind `profile`). Kept for muscle memory and existing docs; new artifact
 * kinds go through sync-mirror directly.
 *
 * Usage: npx tsx scripts/sync-profile-mirror.mts <name> [--dry-run|--check]
 * @module scripts/sync-profile-mirror
 */
import { main } from './sync-mirror.mts'

const args = process.argv.slice(2)
const name = args.find((a) => !a.startsWith('--'))

main(['profile', ...(name === undefined ? [] : [name]), ...args.filter((a) => a.startsWith('--'))])
