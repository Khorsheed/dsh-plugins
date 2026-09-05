#!/usr/bin/env node
import { formatMachineLeaseReport, inspectMachineTestLeases } from '../tests/helpers/process-lifecycle.ts'

const ageIndex = process.argv.indexOf('--age-ms')
const ageMs = ageIndex < 0 ? undefined : Number(process.argv[ageIndex + 1])
if (ageMs !== undefined && (!Number.isFinite(ageMs) || ageMs < 0)) {
  process.stderr.write('usage: report-test-leaks [--age-ms N] [--json]\n')
  process.exit(2)
}
const report = inspectMachineTestLeases(Date.now(), ageMs)
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else process.stdout.write(formatMachineLeaseReport(report))
