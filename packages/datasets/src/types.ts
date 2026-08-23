/** Wire payload vocabulary of the datasets Remote service (the web session tab's data face).
 * Everything here is a named re-export of the service-core types the Remote
 * signatures reuse — the tab and the tools share one semantics by sharing one
 * type source.
 * @module @khorsheed/dsh-datasets/types
 */

export type { DatasetBinding } from './binding.ts'
export type { DatasetSummary, ItemRecord, JsonObject } from './dataset.ts'
export type {
  ListDatasetsResult, ListItemsResult, ListRequest, PreviewRepoRequest, PreviewRepoResult,
  ReadQuery, ReadResult, ShowRequest, ShowResult,
} from './service.ts'
