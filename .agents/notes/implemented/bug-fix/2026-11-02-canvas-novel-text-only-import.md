# Agent Note: Novel import stays text-only

Status: implemented

## Problem

The first document-import implementation added Mammoth for DOCX. Its Node entry pulled server-only modules and global assumptions into the browser bundle, so the novel plugin could not activate on 3080 despite a successful build, preflight and canary. Switching to Mammoth's browser distribution could repair that entry, but the user chose to avoid the parser dependency and the Word document attack surface for now.

## Decision

- Novel import accepts only `.txt`, `.md` and `.markdown`. The file input and directory scanner no longer offer DOCX, and Mammoth plus the test-only JSZip dependency are removed rather than replaced with another converter. Zod remains for generated Remote schemas.
- `.doc` and `.docx` produce an explicit instruction to save as UTF-8 TXT or Markdown. The directory scanner returns that guidance without reading the Word file's bytes or counting it against the supported-document byte cap. Unsupported formats, hidden entries and symlinks are still skipped.
- Text decoding, chapter recognition, preview, consecutive manuscript writes, retry and reconciliation are unchanged. Native and official browse directory selection remain available.
- The real `lib/client.js` factory is evaluated in a VM with browser globals and platform-module stubs, with Node built-ins, `process`, `Buffer` and `setImmediate` absent. This remains as a general browser-loading regression test, not as a reason to keep a DOCX dependency.
- This partially supersedes the DOCX arm of [document import](../feature/2026-11-02-canvas-novel-document-import.md). Other document and folder import behavior remains in force.

## Alternatives considered

- **Ship Mammoth's official browser distribution.** It parsed the acceptance DOCX without Node globals, but retaining DOCX still adds parser supply-chain exposure, malicious ZIP/XML input and a conversion dependency the user does not want at this stage.
- **Require host Office/LibreOffice.** Rejected: that optional capability would become a hard dependency for a plugin that must install independently. There is no need for a converter in a text-only feature.
- **Implement DOCX parsing locally.** Rejected: a private ZIP/WordprocessingML parser would be more code and more risk, not less.
- **Drop the browser artifact smoke test with Mammoth.** Rejected: the host canary still does not evaluate client factories, so the browser-only execution check remains useful for any future dependency.

## Consequences

- Word users must save or export their manuscript as UTF-8 TXT or Markdown before import. This is one manual conversion step in exchange for no Word parser, no DOCX test generator and no Node-only browser dependency graph.
- Text-only import does not claim that all third-party dependencies are gone: Zod still validates generated Remote schemas, React and official host packages remain peers, and development tools remain development-only.
- Host canary PASS remains insufficient browser evidence. The artifact test covers evaluation, while actual UI, picker interaction and model reconciliation quality still need separate acceptance.

## Validation

- Parser tests cover Chinese, English and Markdown headings, front matter, natural and Chinese-numeral file ordering, UTF-8/GB18030 text, empty and oversized files, and conversion instructions for both `.doc` and `.docx`.
- Directory tests prove that a Word file produces guidance but is absent from the byte results, while a neighboring text chapter still imports. Native and official browse selection, path normalization, skips and caps retain their coverage.
- The built client factory executes without Node modules or Node globals. Existing manuscript, Remote and preview tests continue to cover the unchanged write and reconciliation contracts.
