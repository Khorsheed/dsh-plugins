/**
 * Locale-dependent chrome the content pane needs, as a plain object.
 *
 * The kernel owned no locale namespace by design: it registers no `ctx.locale`
 * dictionary (it is not a plugin), so every string it prints arrives from the
 * consuming surface. Each consumer keeps its own namespace and builds this
 * object from its own `t`, which is also why the two surfaces can stay on
 * different dictionaries while rendering through one implementation.
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Labels for the structured (JSON tree / CSV table / markdown) renderers. */
export interface StructuredLabels {
  /** JsonTree chrome (copy actions, node disclosure, failure text). */
  readonly json: JsonTreeLabels
  /** MarkdownText chrome (code-fence copy button, footnotes). */
  readonly markdown: MarkdownLabels
}
