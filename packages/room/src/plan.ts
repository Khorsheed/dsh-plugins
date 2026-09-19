/** Formal goal state. Ordinary room chat does not create or mutate a plan. */
export interface PlanBudget {
  maxParallel: number
  maxAttempts: number
  maxAttemptsPerTask: number
  maxActiveMs: number
}
export interface PlanEvidence { summary: string; references: string[]; artifacts: string[] }
export interface PlanAttempt {
  id: string
  deliveryId: string
  number: number
  status: 'queued' | 'running' | 'submitted' | 'accepted' | 'rejected' | 'failed' | 'cancelled' | 'uncertain'
  createdAt: number
  startedAt?: number
  settledAt?: number
  submission?: PlanEvidence
  review?: { decision: 'accepted' | 'rework'; by: string; reason: string; references: string[]; time: number }
  error?: string
  retry?: { by: string; reason: string; time: number }
}
export interface PlanTask {
  id: string
  title: string
  stageId: string
  parentId?: string
  kind: 'group' | 'task'
  ownerMemberId?: string
  instruction: string
  criteria: string[]
  inputRefs: string[]
  artifactPaths: string[]
  dependsOn: string[]
  status: 'pending' | 'running' | 'submitted' | 'accepted' | 'failed' | 'cancelled'
  attempts: PlanAttempt[]
}
export interface RoomPlan {
  version: 1
  id: string
  revision: number
  objective: string
  status: 'draft' | 'running' | 'paused' | 'completed' | 'cancelled'
  reason?: string
  budget: PlanBudget
  activeMs: number
  resumedAt?: number
  stages: { id: string; title: string }[]
  tasks: PlanTask[]
  completion?: PlanEvidence
  requests: { id: string; signature: string }[]
}
export type PlanTaskInput = Omit<PlanTask, 'status' | 'attempts'>
interface CommandBase { requestId: string; expectedRevision: number }
export type PlanCommand = CommandBase & (
  | { action: 'create'; id: string; objective: string; mode: 'draft' | 'execute'; budget: PlanBudget }
  | { action: 'extend'; stages: { id: string; title: string }[]; tasks: PlanTaskInput[] }
  | { action: 'pause'; reason: string; goalId?: string }
  | { action: 'resume' }
  | { action: 'budget'; budget: PlanBudget }
  | { action: 'cancel'; reason: string }
  | { action: 'submit'; taskId: string; attemptId: string; evidence: PlanEvidence }
  | { action: 'review'; taskId: string; attemptId: string; decision: 'accepted' | 'rework'; reason: string; references: string[] }
  | { action: 'retry'; taskId: string; reason: string }
  | { action: 'reconcile'; taskId: string; attemptId: string; outcome: 'failed' | 'submitted'; evidence: PlanEvidence }
  | { action: 'complete'; evidence: PlanEvidence }
)
export interface PlanActor { kind: 'human' | 'coordinator' | 'worker'; memberId: string }
export interface PlanContext { actor: PlanActor; memberIds: ReadonlySet<string>; now: number }

const nonempty = (value: string, field: string): void => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 32000) throw new Error(`${field} must be non-empty and at most 32000 characters`)
}
const identifier = (value: string): void => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) throw new Error('Invalid plan identity')
}
const references = (values: readonly string[], field: string, required = false): void => {
  if (!Array.isArray(values) || values.length > 100 || (required && values.length === 0)) throw new Error(`${field} requires ${required ? '1' : '0'}–100 entries`)
  for (const value of values) nonempty(value, field)
}
function evidence(value: PlanEvidence): void {
  nonempty(value.summary, 'Evidence summary')
  references(value.references, 'Evidence references', true)
  references(value.artifacts, 'Artifact locations')
}
function validateBudget(value: PlanBudget): void {
  for (const [key, maximum] of [['maxParallel', 8], ['maxAttempts', 100], ['maxAttemptsPerTask', 10], ['maxActiveMs', 86400000]] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > maximum) throw new Error(`Invalid goal budget ${key}`)
  }
}
const clone = (plan: RoomPlan): RoomPlan => structuredClone(plan)
function stopClock(plan: RoomPlan, now: number): void {
  if (plan.resumedAt !== undefined) plan.activeMs += Math.max(0, now - plan.resumedAt)
  delete plan.resumedAt
}
export function activePlanMs(plan: RoomPlan, now: number): number {
  return plan.activeMs + (plan.resumedAt === undefined ? 0 : Math.max(0, now - plan.resumedAt))
}
export function latestAttempt(task: PlanTask): PlanAttempt | undefined { return task.attempts.at(-1) }
export function acceptedTask(plan: RoomPlan, taskId: string): boolean {
  const task = plan.tasks.find(task => task.id === taskId)
  if (task === undefined) return false
  if (task.kind === 'task') return task.status === 'accepted'
  const children = plan.tasks.filter(child => child.parentId === task.id)
  return children.length > 0 && children.every(child => acceptedTask(plan, child.id))
}
function dependenciesOf(plan: RoomPlan, task: PlanTask): string[] {
  const dependencies = [...task.dependsOn]
  const seen = new Set([task.id])
  let parentId = task.parentId
  while (parentId !== undefined) {
    if (seen.has(parentId)) throw new Error('Parent cycle')
    seen.add(parentId)
    const parent = plan.tasks.find(task => task.id === parentId)
    if (parent === undefined) throw new Error('Missing parent')
    dependencies.push(...parent.dependsOn); parentId = parent.parentId
  }
  return dependencies
}
/** Accepted leaves behind direct and inherited group prerequisites, once each. */
export function dependencyResults(plan: RoomPlan, task: PlanTask): { taskId: string; submission?: PlanEvidence }[] {
  const leaves = new Map<string, PlanTask>()
  const visit = (id: string): void => {
    const dependency = plan.tasks.find(candidate => candidate.id === id)
    if (dependency === undefined || !acceptedTask(plan, id)) return
    if (dependency.kind === 'task') leaves.set(id, dependency)
    else for (const child of plan.tasks.filter(candidate => candidate.parentId === id)) visit(child.id)
  }
  for (const id of dependenciesOf(plan, task)) visit(id)
  return [...leaves.values()].map(dependency => {
    const submission = dependency.attempts.at(-1)?.submission
    return { taskId: dependency.id, ...submission === undefined ? {} : { submission } }
  })
}

export function readyPlanTasks(plan: RoomPlan): PlanTask[] {
  if (plan.status !== 'running') return []
  return plan.tasks.filter(task => task.kind === 'task' && task.status === 'pending' && dependenciesOf(plan, task).every(id => acceptedTask(plan, id)))
}
export function activePlanAttempts(plan: RoomPlan): PlanAttempt[] {
  return plan.tasks.flatMap(task => task.attempts.filter(attempt => attempt.settledAt === undefined && ['queued', 'running', 'submitted', 'uncertain'].includes(attempt.status)))
}
function taskAndAttempt(plan: RoomPlan, taskId: string, attemptId: string): [PlanTask, PlanAttempt] {
  const task = plan.tasks.find(task => task.id === taskId)
  const attempt = task?.attempts.at(-1)
  if (task === undefined || attempt?.id !== attemptId) throw new Error('Attempt is missing or superseded')
  return [task, attempt]
}
function validateGraph(plan: RoomPlan, memberIds: ReadonlySet<string>): void {
  const stages = new Set<string>()
  for (const stage of plan.stages) { identifier(stage.id); nonempty(stage.title, 'Stage title'); if (stages.has(stage.id)) throw new Error('Duplicate stage'); stages.add(stage.id) }
  const tasks = new Map<string, PlanTask>()
  if (plan.tasks.length > 200 || plan.stages.length > 50) throw new Error('Plan exceeds 200 tasks or 50 stages')
  for (const task of plan.tasks) {
    identifier(task.id); nonempty(task.title, 'Task title')
    if (tasks.has(task.id) || !stages.has(task.stageId)) throw new Error('Duplicate task or missing stage')
    if (task.kind !== 'group' && task.kind !== 'task') throw new Error('Invalid task kind')
    if (task.kind === 'task') {
      if (task.ownerMemberId === undefined || !memberIds.has(task.ownerMemberId)) throw new Error('Task owner is not in the room')
      nonempty(task.instruction, 'Execution instruction'); references(task.criteria, 'Acceptance criteria', true)
    }
    references(task.inputRefs, 'Input references'); references(task.artifactPaths, 'Planned artifacts'); references(task.dependsOn, 'Task dependencies')
    tasks.set(task.id, task)
  }
  const edges = new Map<string, string[]>()
  for (const task of plan.tasks) {
    if (task.dependsOn.some(id => !tasks.has(id))) throw new Error('Missing task dependency')
    edges.set(task.id, dependenciesOf(plan, task))
    if (task.parentId !== undefined) {
      const parent = tasks.get(task.parentId)
      if (parent?.kind !== 'group' || parent.stageId !== task.stageId) throw new Error('Parent must be a group in the same stage')
    }
  }
  // A group becomes accepted through its children. These edges must participate
  // in cycle checks, otherwise a child waiting on its parent deadlocks forever.
  for (const task of plan.tasks) if (task.parentId !== undefined) edges.get(task.parentId)!.push(task.id)
  const visited = new Set<string>(); const visiting = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Task dependency or parent cycle')
    if (visited.has(id)) return
    visiting.add(id); for (const dependency of edges.get(id) ?? []) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const id of tasks.keys()) visit(id)
}

/** Pure transition: the service persists the returned revision before dispatch. */
export function changePlan(current: RoomPlan | undefined, command: PlanCommand, context: PlanContext): RoomPlan {
  identifier(command.requestId)
  const signature = planCommandSignature(command)
  const receipt = current?.requests.find(receipt => receipt.id === command.requestId)
  if (receipt !== undefined) {
    if (receipt.signature !== signature) throw new Error('Plan request identity was reused for different input')
    return clone(current!)
  }
  if (context.actor.kind === 'worker' && command.action !== 'submit') throw new Error('Only the coordinator or human may organize or review a plan')
  // Concurrent submissions must not defeat a human stop request. Fence it
  // to the displayed goal so a stale browser cannot pause a replacement.
  if (command.action === 'pause' && command.goalId !== undefined && command.goalId !== current?.id) throw new Error('Goal changed; read the current plan before pausing')
  const humanPause = context.actor.kind === 'human' && command.action === 'pause' && command.goalId === current?.id && current !== undefined
  if (command.expectedRevision !== (current?.revision ?? 0) && context.actor.kind !== 'worker' && !humanPause) throw new Error('Plan revision changed; read the current plan before retrying')
  let plan: RoomPlan
  if (command.action === 'create') {
    if (current !== undefined && !['completed', 'cancelled'].includes(current.status)) throw new Error('An unfinished plan already exists')
    if (current?.id === command.id) throw new Error('A new goal requires a new identity')
    identifier(command.id); nonempty(command.objective, 'Goal'); validateBudget(command.budget)
    plan = { version: 1, id: command.id, revision: (current?.revision ?? 0) + 1, objective: command.objective,
      status: command.mode === 'execute' ? 'running' : 'draft', budget: structuredClone(command.budget), activeMs: 0,
      ...command.mode === 'execute' ? { resumedAt: context.now } : {}, stages: [], tasks: [], requests: [] }
  } else {
    if (current === undefined) throw new Error('No formal goal exists')
    plan = clone(current)
    if (['completed', 'cancelled'].includes(plan.status) && command.action !== 'reconcile') throw new Error('The plan is closed')
    switch (command.action) {
      case 'extend':
        plan.stages.push(...structuredClone(command.stages))
        for (const task of command.tasks) plan.tasks.push({ ...structuredClone(task), status: 'pending', attempts: [] })
        validateGraph(plan, context.memberIds)
        // Never invalidate the accepted output of a parent by appending work below it.
        for (const task of command.tasks) if (task.parentId !== undefined && acceptedTask(current, task.parentId)) throw new Error('Cannot extend an accepted group; add a new group')
        break
      case 'pause':
        nonempty(command.reason, 'Pause reason'); stopClock(plan, context.now); plan.status = 'paused'; plan.reason = command.reason
        break
      case 'budget':
        if (context.actor.kind !== 'human') throw new Error('Only a human may change the authorized budget')
        validateBudget(command.budget); plan.budget = structuredClone(command.budget)
        break
      case 'resume':
        if (activePlanAttempts(plan).some(attempt => attempt.status === 'uncertain')) throw new Error('Reconcile uncertain attempts before resuming')
        if (activePlanMs(plan, context.now) >= plan.budget.maxActiveMs) throw new Error('The active-time budget is exhausted')
        if (plan.status !== 'running') plan.resumedAt = context.now
        plan.status = 'running'; delete plan.reason
        break
      case 'cancel':
        nonempty(command.reason, 'Cancellation reason'); stopClock(plan, context.now); plan.status = 'cancelled'; plan.reason = command.reason
        for (const task of plan.tasks) if (task.status === 'pending') task.status = 'cancelled'
        break
      case 'submit': {
        const [task, attempt] = taskAndAttempt(plan, command.taskId, command.attemptId)
        if (context.actor.kind === 'worker' && task.ownerMemberId !== context.actor.memberId) throw new Error('Workers may only submit their own current attempt')
        if (attempt.status !== 'running') throw new Error('Only the running attempt may submit evidence')
        evidence(command.evidence)
        attempt.submission = structuredClone(command.evidence); attempt.status = 'submitted'; task.status = 'submitted'
        break
      }
      case 'review': {
        const [task, attempt] = taskAndAttempt(plan, command.taskId, command.attemptId)
        if (attempt.status !== 'submitted' || attempt.settledAt === undefined || attempt.submission === undefined) throw new Error('Review requires a settled submission')
        nonempty(command.reason, 'Review decision'); references(command.references, 'Review evidence', true)
        attempt.review = { decision: command.decision, by: context.actor.memberId, reason: command.reason, references: [...command.references], time: context.now }
        attempt.status = command.decision === 'accepted' ? 'accepted' : 'rejected'
        task.status = command.decision === 'accepted' ? 'accepted' : 'pending'
        break
      }
      case 'retry': {
        const task = plan.tasks.find(task => task.id === command.taskId)
        if (task?.kind !== 'task' || task.status !== 'failed') throw new Error('Only a failed task can be retried')
        nonempty(command.reason, 'Retry reason'); task.status = 'pending'
        const attempt = latestAttempt(task)
        if (attempt !== undefined) attempt.retry = { by: context.actor.memberId, reason: command.reason, time: context.now }
        break
      }
      case 'reconcile': {
        if (context.actor.kind !== 'human') throw new Error('Only a human may reconcile an uncertain execution')
        const [task, attempt] = taskAndAttempt(plan, command.taskId, command.attemptId)
        if (attempt.status !== 'uncertain') throw new Error('Attempt is not uncertain')
        evidence(command.evidence); attempt.submission = structuredClone(command.evidence)
        attempt.status = command.outcome; attempt.settledAt = context.now
        task.status = command.outcome === 'submitted' ? 'submitted' : 'failed'
        break
      }
      case 'complete':
        if (!plan.tasks.some(task => task.kind === 'task' && task.status === 'accepted') || plan.tasks.some(task => task.kind === 'task' && !['accepted', 'cancelled'].includes(task.status))) throw new Error('All remaining leaf tasks must be accepted before completing the goal')
        evidence(command.evidence); stopClock(plan, context.now); plan.status = 'completed'; plan.completion = structuredClone(command.evidence)
        break
    }
    plan.revision++
  }
  plan.requests.push({ id: command.requestId, signature })
  return plan
}

/** Reserve a single executable leaf and count the attempt before side effects. */
export function queuePlanAttempt(current: RoomPlan, taskId: string, attemptId: string, deliveryId: string, now: number): RoomPlan {
  const plan = clone(current)
  if (!readyPlanTasks(plan).some(task => task.id === taskId)) throw new Error('Task is not ready for execution')
  if (activePlanAttempts(plan).length >= plan.budget.maxParallel) throw new Error('Goal concurrency is full')
  const task = plan.tasks.find(task => task.id === taskId)!
  if (activePlanMs(plan, now) >= plan.budget.maxActiveMs || task.attempts.length >= plan.budget.maxAttemptsPerTask
    || plan.tasks.reduce((count, task) => count + task.attempts.length, 0) >= plan.budget.maxAttempts) {
    stopClock(plan, now); plan.status = 'paused'; plan.reason = 'Execution budget exhausted'; plan.revision++
    return plan
  }
  identifier(attemptId); nonempty(deliveryId, 'Delivery identity')
  if (plan.tasks.some(task => task.attempts.some(attempt => attempt.id === attemptId || attempt.deliveryId === deliveryId))) throw new Error('Attempt or delivery identity already exists')
  task.attempts.push({ id: attemptId, deliveryId, number: task.attempts.length + 1, status: 'queued', createdAt: now })
  task.status = 'running'; plan.revision++
  return plan
}

/** Durable admission; a pause after reservation prevents the native side effect. */
export function admitPlanAttempt(current: RoomPlan, taskId: string, attemptId: string, now: number): RoomPlan {
  const plan = clone(current)
  if (plan.status !== 'running' || activePlanMs(plan, now) >= plan.budget.maxActiveMs) throw new Error('Goal is paused or its active-time budget is exhausted')
  const [, attempt] = taskAndAttempt(plan, taskId, attemptId)
  if (attempt.status !== 'queued') throw new Error('Attempt is not queued')
  attempt.status = 'running'; attempt.startedAt = now; plan.revision++
  return plan
}

/** A normal native result is a submission to review, never implicit acceptance. */
export function settlePlanAttempt(current: RoomPlan, taskId: string, attemptId: string, result: { state: 'done' | 'failed' | 'cancelled'; evidence?: PlanEvidence; error?: string }, now: number): RoomPlan {
  const plan = clone(current)
  const task = plan.tasks.find(task => task.id === taskId)
  const attempt = task?.attempts.at(-1)
  // Duplicate or late results cannot rewrite a reviewed or newer attempt.
  if (task === undefined || attempt?.id !== attemptId || attempt.settledAt !== undefined || attempt.status === 'uncertain') return plan
  if (attempt.startedAt === undefined && current.status === 'paused') {
    attempt.status = 'cancelled'; attempt.error = 'Paused before native admission'; attempt.settledAt = now
    task.status = 'pending'; plan.revision++; return plan
  }
  if (result.state === 'done') {
    if (result.evidence !== undefined && attempt.submission === undefined) { evidence(result.evidence); attempt.submission = structuredClone(result.evidence) }
    if (attempt.submission === undefined) { attempt.status = 'failed'; task.status = 'failed'; attempt.error = 'Execution finished without submission evidence' }
    else { attempt.status = 'submitted'; task.status = 'submitted' }
  } else {
    attempt.status = result.state; task.status = result.state === 'cancelled' ? 'cancelled' : 'failed'
    if (result.error !== undefined) attempt.error = result.error
  }
  attempt.settledAt = now; plan.revision++
  return plan
}

/** Restart always pauses automation and fences native executions with unknown outcomes. */
export function recoverPlan(current: RoomPlan, now: number): RoomPlan {
  const plan = clone(current)
  if (plan.status === 'completed') return plan
  if (plan.status === 'running') { stopClock(plan, now); plan.status = 'paused'; plan.reason = 'Host restarted; review and resume explicitly' }
  for (const task of plan.tasks) {
    const attempt = latestAttempt(task)
    if (attempt !== undefined && attempt.settledAt === undefined && ['running', 'submitted'].includes(attempt.status)) {
      attempt.status = 'uncertain'; attempt.error = 'Execution outcome is unknown after restart'; task.status = 'failed'
      if (plan.status !== 'cancelled') plan.status = 'paused'
      plan.reason = 'Reconcile uncertain attempts before continuing'
    }
  }
  plan.revision++
  return plan
}

interface WireSchema {
  type?: 'string' | 'integer' | 'object' | 'array'
  enum?: readonly string[]
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  items?: WireSchema
  properties?: Record<string, WireSchema>
  required?: string[]
  additionalProperties?: false
  oneOf?: WireSchema[]
}
const shortText: WireSchema = { type: 'string', minLength: 1, maxLength: 32000 }
const idSchema: WireSchema = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$' }
const strings: WireSchema = { type: 'array', items: shortText, maxItems: 100 }
const object = (properties: Record<string, WireSchema>, optional: string[] = []): WireSchema => ({ type: 'object', properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false })
const enumeration = (...values: string[]): WireSchema => ({ type: 'string', enum: values })
const integer = (minimum: number, maximum: number): WireSchema => ({ type: 'integer', minimum, maximum })
const evidenceSchema = object({ summary: shortText, references: { ...strings, minItems: 1 }, artifacts: strings })
const budgetSchema = object({ maxParallel: integer(1, 8), maxAttempts: integer(1, 100), maxAttemptsPerTask: integer(1, 10), maxActiveMs: integer(1, 86400000) })
const taskSchema = object({ id: idSchema, title: shortText, stageId: idSchema, parentId: idSchema, kind: enumeration('task', 'group'), ownerMemberId: idSchema, instruction: { type: 'string', maxLength: 32000 }, criteria: strings, inputRefs: strings, artifactPaths: strings, dependsOn: { type: 'array', items: idSchema, maxItems: 100 } }, ['parentId', 'ownerMemberId'])
const base = { requestId: idSchema, expectedRevision: integer(0, Number.MAX_SAFE_INTEGER) }
const commandSchema: WireSchema = { oneOf: [
  object({ ...base, action: enumeration('create'), id: idSchema, objective: shortText, mode: enumeration('draft', 'execute'), budget: budgetSchema }),
  object({ ...base, action: enumeration('extend'), stages: { type: 'array', items: object({ id: idSchema, title: shortText }), maxItems: 50 }, tasks: { type: 'array', items: taskSchema, maxItems: 200 } }),
  object({ ...base, action: enumeration('pause'), reason: shortText, goalId: idSchema }, ['goalId']),
  object({ ...base, action: enumeration('resume') }),
  object({ ...base, action: enumeration('budget'), budget: budgetSchema }),
  object({ ...base, action: enumeration('cancel'), reason: shortText }),
  object({ ...base, action: enumeration('submit'), taskId: idSchema, attemptId: idSchema, evidence: evidenceSchema }),
  object({ ...base, action: enumeration('review'), taskId: idSchema, attemptId: idSchema, decision: enumeration('accepted', 'rework'), reason: shortText, references: { ...strings, minItems: 1 } }),
  object({ ...base, action: enumeration('retry'), taskId: idSchema, reason: shortText }),
  object({ ...base, action: enumeration('reconcile'), taskId: idSchema, attemptId: idSchema, outcome: enumeration('failed', 'submitted'), evidence: evidenceSchema }),
  object({ ...base, action: enumeration('complete'), evidence: evidenceSchema }),
] }

/** Validate only the small JSON-schema vocabulary used by the published contract. */
function validateWire(value: unknown, schema: WireSchema, path: string): void {
  const fail = (): never => { throw new Error(`Invalid plan command at ${path}`) }
  if (schema.oneOf !== undefined) {
    for (const alternative of schema.oneOf) { try { validateWire(value, alternative, path); return } catch { /* try the next action */ } }
    fail()
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail()
    const text = value as string
    if ((schema.minLength !== undefined && text.length < schema.minLength) || (schema.maxLength !== undefined && text.length > schema.maxLength)
      || (schema.enum !== undefined && !schema.enum.includes(text)) || (schema.pattern !== undefined && !new RegExp(schema.pattern).test(text))) fail()
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < schema.minimum! || value > schema.maximum!) fail()
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail()
    const items = value as unknown[]
    if (items.length < (schema.minItems ?? 0) || items.length > (schema.maxItems ?? Infinity)) fail()
    for (const [index, item] of items.entries()) validateWire(item, schema.items!, `${path}[${index}]`)
  } else if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail()
    const record = value as Record<string, unknown>
    if (schema.required?.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !Object.hasOwn(schema.properties!, key))) fail()
    for (const [key, item] of Object.entries(record)) validateWire(item, schema.properties![key]!, `${path}.${key}`)
  }
}

/** One bounded, strict wire grammar is shared by native tools, MCP and the UI. */
export function parsePlanCommand(text: string): PlanCommand {
  if (typeof text !== 'string' || text.length > 131072) throw new Error('Plan command exceeds 128 KiB')
  const value: unknown = JSON.parse(text)
  validateWire(value, commandSchema, 'command')
  return value as PlanCommand
}

/** JSON schema supplied through room_read so both harness families see one contract. */
export function planCommandContract(): object { return structuredClone(commandSchema) }

/** Object field order is not part of a retry identity; array order remains meaningful. */
export function planCommandSignature(command: PlanCommand): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value
  return JSON.stringify(stable(command))
}
