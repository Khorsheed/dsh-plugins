#!/usr/bin/env node
/**
 * Install the repo's git hooks: point core.hooksPath at .githooks so the
 * pre-commit hygiene check and the pre-push main-safety check run
 * automatically. One-time per clone; idempotent.
 */
import { execFileSync } from 'node:child_process'

execFileSync('git', ['config', 'core.hooksPath', '.githooks'])
console.log('git hooks path set to .githooks — pre-commit hygiene and pre-push main safety are active.')
