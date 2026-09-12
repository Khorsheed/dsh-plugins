#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkDeploymentLinks } from './dependency-links.mts'

try {
  if (process.argv.length > 2) throw new Error('Use DSH_HOME and DSH_HARNESS to select scan roots; no positional arguments are accepted.')
  checkDeploymentLinks(process.env.DSH_HOME ?? join(homedir(), '.dsh-official'), process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness'))
  console.log('deploy:check-links PASS (physical home and harness trees; home scratch and .git excluded; no files changed)')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
