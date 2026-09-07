/**
 * The model-tool face of the mission service (agent-first interface). Every
 * tool is a thin adapter over {@link MissionService} — the service is the
 * body, the tools only translate. Write tools ride the standard
 * `tools/pre-execute` approval pipeline (no plugin-side approval flags); the
 * calling session id is recorded into history as `tool:<sessionId>`. There is
 * deliberately NO export tool: sharing is an initiating-class human decision
 * and stays CLI/slash-only.
 *
 * Which tools exist at all is a mount-time decision ({@link MissionToolsTier}):
 * a profile where something other than the model owns the writing — a
 * service-face driver, the CLI, a person at the tab — mounts `read` or `none`
 * so the model cannot reach the write tools. A preset cannot subtract a tool
 * the profile registered, so the group has to be chosen where registration
 * happens.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { MissionService } from './service.ts'
import { RETRY_CATEGORIES } from './types.ts'

/**
 * Tag model-visible tools with their origin (AGENTS.md § Tool origin tagging;
 * seam S12): the catalog reads this `Symbol.for`-keyed tag back through
 * `ctx.tools.get()`. The tag is host-side only — the model-facing schema is
 * rebuilt by `schemaOf()` and never carries it.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: '@khorsheed/dsh-mission' },
  })

/** A JSON pass-through canonical output with a one-line text rendering. */
function jsonOutput(renderText: (value: never) => string) {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: never) => [{ type: 'text' as const, text: renderText(value) }],
  }
}

/**
 * The tool group a mount opens: every tool (default), the read-only queue
 * queries, or no model tools at all.
 */
export type MissionToolsTier = 'all' | 'read' | 'none'

/**
 * The `read` group: the four queries that project the queue and open one
 * mission. `mission_is_releasable` is read-only too but stays out — it answers
 * a question about destroying a resource, which belongs with the side that
 * holds it, and a `read` mount is by definition not that side.
 */
export const MISSION_READ_TOOLS: readonly string[] = [
  'mission_run_list', 'mission_run_status', 'mission_list', 'mission_get',
]

/**
 * Register the mission tools of the given group on the plugin context.
 * @param ctx - plugin context carrying the tool registry.
 * @param service - the service every tool adapts.
 * @param tier - which group to register (default: all twelve).
 */
export function registerMissionTools(ctx: Context, service: MissionService, tier: MissionToolsTier = 'all'): void {
  if (tier === 'none') return
  /** Register one definition when the configured group contains it. */
  const register = (definition: ToolDefinition): void => {
    if (tier === 'all' || MISSION_READ_TOOLS.includes(definition.name)) {
      ctx.tools.register(definePluginTool(definition))
    }
  }

  const by = (exec: { agent?: { session: { id: string } } | undefined }): string =>
    `tool:${exec.agent?.session.id ?? 'unknown'}`
  const originOf = (exec: { agent?: { session: { id: string } } | undefined }): string | undefined =>
    exec.agent?.session.id

  register(defineTool({
    name: 'mission_run_create',
    description: 'Create a run (a batch of missions) from a run template: the template\'s state machine '
      + 'freezes into the run and its mission batch materializes. A template that fails lint is refused. '
      + 'Give `template_path` (a JSON file) or an inline `template` object.',
    parameters: {
      template_path: { type: 'string', description: 'Path to a run-template JSON file.' },
      template: { type: 'json', description: 'Inline template object: {name?, stateMachine|states/transitions/releasableStates, missions?}.' },
      run_id: { type: 'string', description: 'Explicit run id (default: generated). Re-creating with the identical template and meta is a no-op.' },
      meta: { type: 'json', description: 'Opaque metadata object recorded on the run.' },
    },
    output: jsonOutput(v => {
      const value = v as { runId: string; missions: number; warnings: string[]; existed: boolean }
      return `run ${value.runId}: ${value.missions} mission(s)${value.existed ? ' (already existed)' : ''}`
        + (value.warnings.length > 0 ? `\nlint warnings:\n${value.warnings.map(w => `  - ${w}`).join('\n')}` : '')
    }),
    async execute(args, exec) {
      const origin = originOf(exec)
      const result = await service.runCreate({
        ...(args.template_path !== undefined ? { templatePath: args.template_path } : {}),
        ...(args.template !== undefined ? { template: args.template } : {}),
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        ...(args.meta !== undefined ? { meta: args.meta as Record<string, unknown> } : {}),
        ...(origin !== undefined ? { originSession: origin } : {}),
        by: by(exec),
      })
      return {
        runId: result.run.id, missions: result.run.missions.length,
        warnings: result.lint.warnings, existed: result.existed,
      } as unknown as JsonValue
    },
  }))

  register(defineTool({
    name: 'mission_run_list',
    description: 'List all runs (id, template, mission count, state).',
    parameters: {},
    output: jsonOutput(v => JSON.stringify(v, null, 2)),
    isConcurrencySafe: () => true,
    execute() {
      return Promise.resolve(service.runList() as unknown as JsonValue)
    },
  }))

  register(defineTool({
    name: 'mission_run_status',
    description: 'Projected status of one run: every mission with its five-bucket projection '
      + '(ready/scheduled/blocked/active/done), the bucket grouping, and missions holding an '
      + 'unreleased resource.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'The run to project.' },
    },
    output: jsonOutput(v => {
      const value = v as { buckets: Record<string, string[]>; unreleased: string[] }
      const lines = Object.entries(value.buckets).map(([b, ids]) => `${b}: ${ids.length}`)
      if (value.unreleased.length > 0) lines.push(`⚠ resource held but not releasable: ${value.unreleased.join(', ')}`)
      return lines.join('\n')
    }),
    isConcurrencySafe: () => true,
    execute(args) {
      return Promise.resolve(service.runStatus(args.run_id) as unknown as JsonValue)
    },
  }))

  register(defineTool({
    name: 'mission_create',
    description: 'Queue one work item. Without `run_id` it lands in this session\'s implicit run '
      + '(built-in `simple` template: queued → active → done | failed) — zero configuration. '
      + 'Optional plan data: `depends_on` (unlocks when every named mission reaches a terminal state) '
      + 'and `scheduled_at` (epoch ms; not ready before then). Plan data only changes the projection — '
      + 'nothing fires automatically.',
    parameters: {
      run_id: { type: 'string', description: 'Target run (default: the session\'s implicit run).' },
      id: { type: 'string', description: 'Explicit mission id, unique within the run (default: next number).' },
      title: { type: 'string', description: 'Human-readable title.' },
      labels: { type: 'json', description: 'Arbitrary string coordinate map (e.g. {"layer": "dwd"}).' },
      depends_on: { type: 'array', items: { type: 'string' }, description: 'Ids of missions that must reach a terminal state first.' },
      scheduled_at: { type: 'number', description: 'Epoch ms before which the mission is not ready (one-shot).' },
    },
    output: jsonOutput(v => {
      const value = v as { runId: string; id: string; state: string }
      return `mission ${value.id} queued in run ${value.runId} (state ${value.state})`
    }),
    async execute(args, exec) {
      const origin = originOf(exec)
      const { run, mission, existed } = await service.create({
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.labels !== undefined ? { labels: args.labels as Record<string, string> } : {}),
        ...(args.depends_on !== undefined ? { dependsOn: args.depends_on } : {}),
        ...(args.scheduled_at !== undefined ? { scheduledAt: args.scheduled_at } : {}),
        ...(origin !== undefined ? { originSession: origin } : {}),
        by: by(exec),
      })
      return { runId: run.id, id: mission.id, state: mission.attempts[0]?.state, existed } as unknown as JsonValue
    },
  }))

  register(defineTool({
    name: 'mission_list',
    description: 'List missions with their five-bucket projection, optionally filtered by run, bucket, '
      + 'and exact label matches.',
    parameters: {
      run_id: { type: 'string', description: 'Only this run (default: all runs).' },
      bucket: { type: 'string', enum: ['ready', 'scheduled', 'blocked', 'active', 'done'], description: 'Only this projection bucket.' },
      labels: { type: 'json', description: 'Exact-match label filter (string map).' },
    },
    output: jsonOutput(v => JSON.stringify(v, null, 2)),
    isConcurrencySafe: () => true,
    execute(args) {
      return Promise.resolve(service.list({
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        ...(args.bucket !== undefined ? { bucket: args.bucket } : {}),
        ...(args.labels !== undefined ? { labels: args.labels as Record<string, string> } : {}),
      }) as unknown as JsonValue)
    },
  }))

  register(defineTool({
    name: 'mission_get',
    description: 'Full detail of one mission: attempts with states/history/refs/checkpoints/artifacts, '
      + 'and all annotations.',
    parameters: {
      mission_id: { type: 'string', required: true, description: 'Mission id (unique within its run).' },
      run_id: { type: 'string', description: 'Disambiguate when the id exists in several runs.' },
    },
    output: jsonOutput(v => JSON.stringify(v, null, 2)),
    isConcurrencySafe: () => true,
    execute(args) {
      const { run, mission } = service.get(args.mission_id, args.run_id)
      return Promise.resolve({ runId: run.id, mission } as unknown as JsonValue)
    },
  }))

  register(defineTool({
    name: 'mission_transition',
    description: 'Move a mission along an edge its run\'s state machine DECLARES: undeclared transitions '
      + 'fail, and a declared guard (file-check / schema-check / attested) is enforced — a failed guard '
      + 'leaves the mission where it is. Repeating a transition already in the target state is a no-op.',
    parameters: {
      mission_id: { type: 'string', required: true, description: 'Mission id.' },
      to: { type: 'string', required: true, description: 'Target state (must be declared from the current state).' },
      note: { type: 'string', description: 'Recorded into the history entry.' },
      run_id: { type: 'string', description: 'Disambiguate when the id exists in several runs.' },
    },
    output: jsonOutput(v => {
      const value = v as { changed: boolean; from: string; to: string }
      return value.changed ? `${value.from} → ${value.to}` : `already in ${value.to} (no-op)`
    }),
    async execute(args, exec) {
      return await service.transition(args.mission_id, args.to, {
        ...(args.note !== undefined ? { note: args.note } : {}),
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        by: by(exec),
      }) as unknown as JsonValue
    },
  }))

  register(defineTool({
    name: 'mission_submit',
    description: 'Submit outputs of the current attempt: files are appended into the attempt\'s run-data '
      + 'directory (append-only — same bytes are a no-op, different bytes at an existing path fail), '
      + 'indexed as artifacts, and a NO-REF checkpoint is registered. A `json` payload is validated '
      + 'against the intended `to` edge BEFORE anything is written; `to` is required when several '
      + 'submission schema-check edges leave the current state.',
    parameters: {
      mission_id: { type: 'string', required: true, description: 'Mission id.' },
      files: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Relative path inside the attempt\'s run-data directory.' },
            content: { type: 'string', required: true, description: 'File content (utf8 text, or base64 with encoding).' },
            encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Content encoding (default utf8).' },
          },
        },
        description: 'Files to append into the run-data directory.',
      },
      json: { type: 'json', description: 'Structured payload recorded as the attempt\'s submission (schema-checked).' },
      to: { type: 'string', description: 'Intended outgoing target for submit-time schema validation.' },
      checkpoint: { type: 'string', description: 'Checkpoint name (default "submit").' },
      run_id: { type: 'string', description: 'Disambiguate when the id exists in several runs.' },
    },
    output: jsonOutput(v => {
      const value = v as { written: string[]; checkpoint: string }
      return `submitted: ${value.written.length} file(s) written, checkpoint ${value.checkpoint}`
    }),
    async execute(args, exec) {
      return await service.submit(args.mission_id, {
        ...(args.files !== undefined ? { files: args.files } : {}),
        ...(args.json !== undefined ? { json: args.json } : {}),
        ...(args.to !== undefined ? { to: args.to } : {}),
        ...(args.checkpoint !== undefined ? { checkpoint: args.checkpoint } : {}),
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        by: by(exec),
      }) as unknown as JsonValue
    },
  }))

  register(defineTool({
    name: 'mission_annotate',
    description: 'Append an annotation to the current attempt under a namespace. Annotations are '
      + 'append-only and ns-isolated — nothing rewrites or deletes them. An identical (ns, payload) '
      + 'repeat is a no-op.',
    parameters: {
      mission_id: { type: 'string', required: true, description: 'Mission id.' },
      ns: { type: 'string', required: true, description: 'Namespace (write side is free; integrity is checked on the reading side).' },
      payload: { type: 'json', required: true, description: 'Opaque payload object.' },
      run_id: { type: 'string', description: 'Disambiguate when the id exists in several runs.' },
    },
    output: jsonOutput(v => ((v as { added: boolean }).added ? 'annotation appended' : 'identical annotation already present (no-op)')),
    async execute(args, exec) {
      return await service.annotate(args.mission_id, args.ns, args.payload, {
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        by: by(exec),
      }) as unknown as JsonValue
    },
  }))

  register(defineTool({
    name: 'mission_attest',
    description: 'Register an attestation key for the current attempt — the confirmation an '
      + '`attested` transition guard checks. Repeating a key is a no-op.',
    parameters: {
      mission_id: { type: 'string', required: true, description: 'Mission id.' },
      key: { type: 'string', required: true, description: 'The key the template\'s attested guard names.' },
      note: { type: 'string', description: 'Recorded with the attestation.' },
      run_id: { type: 'string', description: 'Disambiguate when the id exists in several runs.' },
    },
    output: jsonOutput(v => ((v as { added: boolean }).added ? 'attested' : 'already attested (no-op)')),
    async execute(args, exec) {
      return await service.attest(args.mission_id, args.key, {
        ...(args.note !== undefined ? { note: args.note } : {}),
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        by: by(exec),
      }) as unknown as JsonValue
    },
  }))

  register(defineTool({
    name: 'mission_retry',
    description: 'Re-run a mission for an explicit reason: opens a NEW attempt at the initial state. '
      + 'The old attempt stays immutable; the reason, category, caller, and time are recorded on the '
      + 'new attempt and in its history.',
    parameters: {
      mission_id: { type: 'string', required: true, description: 'Mission id.' },
      reason: { type: 'string', required: true, description: 'Non-empty free-text reason for opening a fresh attempt.' },
      category: { type: 'string', required: true, enum: RETRY_CATEGORIES, description: 'Domain-neutral retry category.' },
      run_id: { type: 'string', description: 'Disambiguate when the id exists in several runs.' },
    },
    output: jsonOutput(v => `attempt ${(v as { attempt: number }).attempt} opened`),
    async execute(args, exec) {
      return await service.retry(args.mission_id, {
        reason: args.reason,
        category: args.category,
        ...(args.run_id !== undefined ? { runId: args.run_id } : {}),
        by: by(exec),
      }) as unknown as JsonValue
    },
  }))

  register(defineTool({
    name: 'mission_is_releasable',
    description: 'May this mission\'s held resources be destroyed? True exactly when its current state '
      + 'is one of the run\'s declared releasableStates.',
    parameters: {
      mission_id: { type: 'string', required: true, description: 'Mission id.' },
      run_id: { type: 'string', description: 'Disambiguate when the id exists in several runs.' },
    },
    output: jsonOutput(v => ((v as { releasable: boolean }).releasable ? 'releasable' : 'NOT releasable')),
    isConcurrencySafe: () => true,
    execute(args) {
      return Promise.resolve({ releasable: service.isReleasable(args.mission_id, args.run_id) } as unknown as JsonValue)
    },
  }))
}
