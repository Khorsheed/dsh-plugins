/**
 * Human-readable renderings of service results, shared by the tool `render`
 * callbacks, the slash command, and the CLI so all three faces present the
 * same text.
 */
import type { DescriptorWarning, ItemRecord } from './dataset.ts'
import type { ListDatasetsResult, ListItemsResult, ShowResult, ValidateResult } from './service.ts'

function formatItem(item: ItemRecord): string {
  const layerBits = Object.entries(item.layers)
    .map(([layer, files]) => `${layer}/(${files.length})`)
    .join(' ')
  const meta = item.metadata === undefined ? '' : ` ${JSON.stringify(item.metadata)}`
  return `${item.id}${meta}${layerBits === '' ? '' : `  [${layerBits}]`}`
}

/** Render `datasets_list` output. */
export function formatList(result: ListDatasetsResult | ListItemsResult): string {
  if (result.kind === 'datasets') {
    if (result.datasets.length === 0) return 'no datasets'
    return result.datasets
      .map(dataset => {
        const flags = dataset.nonModelFacingLayers.length > 0
          ? ` (non-model-facing: ${dataset.nonModelFacingLayers.join(', ')})`
          : ''
        const name = dataset.name === undefined ? '' : ` — ${dataset.name}`
        return `${dataset.id}${name}  ${dataset.itemCount} items  layers: ${dataset.layers.join(', ')}${flags}`
      })
      .join('\n')
  }
  const header = `${result.dataset.id}  ${result.dataset.itemCount} items  layers: ${result.dataset.layers.join(', ')}`
  const sharedBits = Object.entries(result.datasetLayers)
    .map(([layer, files]) => `${layer}/(${files.length})`)
    .join(' ')
  const sharedLine = sharedBits === '' ? '' : `\nshared: ${sharedBits}`
  if (result.items.length === 0) return `${header}${sharedLine}\nno items`
  return `${header}${sharedLine}\n${result.items.map(formatItem).join('\n')}`
}

/** Render validation warnings (mixed-sensitivity undeclared-modelFacing layers), one per line. */
export function formatWarnings(warnings: readonly DescriptorWarning[]): string {
  return warnings
    .map(warning => `warn [${warning.code}]: layer ${JSON.stringify(warning.layer)} does not declare modelFacing `
      + '(defaults to true; declare it explicitly in a mixed-sensitivity dataset)')
    .join('\n')
}

/** Render `datasets_show` output. */
export function formatShow(result: ShowResult): string {
  const lines = [
    `${result.dataset.id} @${result.commit.slice(0, 12)}  ${result.dataset.itemCount} items`,
    `layers: ${result.dataset.layers.join(', ')}${
      result.dataset.nonModelFacingLayers.length > 0
        ? ` (non-model-facing: ${result.dataset.nonModelFacingLayers.join(', ')})`
        : ''
    }`,
    `descriptor: ${JSON.stringify(result.descriptor)}`,
  ]
  const sharedEntries = Object.entries(result.datasetLayers)
  if (sharedEntries.length > 0) {
    lines.push('shared:')
    for (const [layer, files] of sharedEntries) {
      for (const file of files) lines.push(`  ${layer}/${file}`)
    }
  }
  for (const item of result.items) {
    lines.push(formatItem(item))
    for (const [layer, files] of Object.entries(item.layers)) {
      for (const file of files) lines.push(`  ${layer}/${file}`)
    }
  }
  return lines.join('\n')
}

/** Render `datasets_validate` output: one line per dataset, then its issues. */
export function formatValidate(result: ValidateResult): string {
  if (result.datasets.length === 0) return 'no datasets'
  const lines: string[] = []
  for (const dataset of result.datasets) {
    const verdict = dataset.errors.length > 0
      ? `${dataset.errors.length} error(s)`
      : dataset.warnings.length > 0
        ? `${dataset.warnings.length} warning(s)`
        : 'ok'
    lines.push(`${dataset.id}: ${verdict}`)
    for (const error of dataset.errors) lines.push(`  error [${error.code}]: ${error.message}`)
    for (const warning of dataset.warnings) lines.push(`  warn [${warning.code}]: ${warning.message}`)
  }
  return lines.join('\n')
}

/**
 * The `/datasets bind` receipt.
 *
 * Its layer sentence is the reason this is a function rather than a template
 * at the call site. It used to read "(all layers)" for a binding with no
 * `--layers`, and that was wrong in the direction that matters: with no
 * whitelist an agent sees the dataset's model-facing layers and nothing else,
 * so a person reading the receipt believed the reference answers and the
 * rubric were already open to the planning agent when they were not — and
 * would have had no reason to check on a dataset where they WERE (I5·T39 ·
 * G3). A widened binding now names what it widened to, because that is the
 * case worth reading twice.
 * @param binding - the binding as it was recorded.
 * @returns the one-line receipt.
 */
export function formatBindReceipt(binding: { repoPath: string; datasets?: readonly string[]; layers?: readonly string[] }): string {
  return `bound ${binding.repoPath}`
    + `${binding.datasets === undefined ? '' : ` datasets: ${binding.datasets.join(', ')}`}`
    + `${binding.layers === undefined
      ? ' — agent-visible: the model-facing layers only'
        + ' (add --layers <a,b> to open more, including sensitive ones)'
      : ` — agent-visible layers: ${binding.layers.join(', ')} (named explicitly, sensitive ones included)`}`
}
