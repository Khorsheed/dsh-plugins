/**
 * Yield one event-loop turn before every test.
 *
 * vitest's worker reports each test start to the main process over a birpc
 * call (`onTaskUpdate`) whose reply must be *read* within a hardcoded 60s —
 * and the worker only reads replies when its own event loop reaches the poll
 * phase. The runner never yields between tests, so a run of synchronous test
 * bodies (spawnSync/execFileSync, sync tree walks) is one continuous block:
 * once it passes 60s, the timer fires ahead of the already-queued reply and
 * the run exits 1 with `[vitest-worker]: Timeout calling "onTaskUpdate"`
 * despite every assertion passing. Load does not cause it; it stretches the
 * block over the line (deploy-3080.spec: 44s idle → 100–150s loaded).
 *
 * `setImmediate` resumes in the check phase, which comes after poll, so the
 * pending replies are drained here. This shrinks the unyielded window from
 * "the whole file" to "one test"; a single test body that blocks for 60s on
 * its own still needs async subprocesses (see scripts/deploy-3080.spec.ts).
 */
import { beforeEach } from 'vitest'

beforeEach(() => new Promise<void>(resolve => setImmediate(resolve)))
