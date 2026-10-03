#!/usr/bin/env node
// Ship the Dataset Authoring Protocol next to the dataset-authoring skill.
//
// The protocol's single source of truth is the repo-level bilingual pair
// (docs/dataset-authoring-protocol.md = Chinese, .en.md = English). The skill
// says «the protocol wins», so the protocol must exist where the skill points
// AFTER INSTALL — a package's `files` cannot reach outside its own directory,
// so the build copies both sides into skills/dataset-authoring/ (gitignored;
// `skills/**/*.md` in `files` ships them). T94: before this, the skill named a
// repo path that no installed package carries, and the organizing agent
// searched the whole disk for it.
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(pkg, '..', '..', 'docs')
const skill = join(pkg, 'skills', 'dataset-authoring')

const pairs = [
  ['dataset-authoring-protocol.en.md', 'protocol.en.md'],
  ['dataset-authoring-protocol.md', 'protocol.zh.md'],
]

for (const [from, to] of pairs) {
  const source = join(docs, from)
  if (!existsSync(source)) {
    // Fail loud: a build without the protocol would pack a skill that points
    // at a missing file — exactly the failure this step exists to prevent.
    console.error(`copy-protocol: ${source} is missing — the dataset-authoring skill cannot ship without it`)
    process.exit(1)
  }
  copyFileSync(source, join(skill, to))
}
