/** Wire payload vocabulary of the datasets Remote service (the web session tab's data face).
 * Everything here is a named re-export of the service-core types the Remote
 * signatures reuse — the tab and the tools share one semantics by sharing one
 * type source.
 * @module @khorsheed/dsh-datasets/types
 */

export type { DatasetBinding } from './binding.ts'
export type {
  DatasetOverview, DatasetOverviewRow, ItemBrief, Judgeability, PlayerFile, PlayerView,
} from './brief.ts'
export type { DatasetSummary, DescriptorWarning, ItemRecord, JsonObject } from './dataset.ts'
export type { SkeletonResult } from './scaffold.ts'
export type {
  ImportItemInput, ItemBriefRequest,
  ListDatasetsResult, ListItemsResult, ListRequest, PreviewRepoRequest, PreviewRepoResult,
  ReadPassthroughRequest, ReadQuery, ReadResult, ScaffoldDatasetInput, ScaffoldItemInput,
  ShowRequest, ShowResult, ValidateDatasetResult, ValidateError, ValidateRequest, ValidateResult,
} from './service.ts'
export type {
  DatasetExposure, DatasetRole, DatasetSlot, FileClassification,
} from './slots.ts'
