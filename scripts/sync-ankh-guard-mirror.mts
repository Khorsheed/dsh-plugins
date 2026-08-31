#!/usr/bin/env node
/**
 * sync-ankh-guard-mirror — thin wrapper over scripts/sync-mirror.mts
 * (kind `package`, name `ankh-guard`). Kept for muscle memory and existing
 * docs; new artifact kinds go through sync-mirror directly.
 * @module scripts/sync-ankh-guard-mirror
 */
process.argv = [process.argv[0], process.argv[1], 'package', 'ankh-guard', ...process.argv.slice(2)]
await import('./sync-mirror.mts')
