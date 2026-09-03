/**
 * The eval service face: the offline verbs the orchestrator (and the CLI)
 * are built from. Execution verbs (run / report / readiness / provision)
 * land in I2 and will live beside these; the offline surface is stable.
 * @module @khorsheed/dsh-eval
 */
import { hashConditionDocument, hashHome, type HomeHash } from './hash.ts'
import { CONDITION_SCHEMA_ID } from './schema.ts'
import { conditionDiagnostics, validatePlan, type EvalDiagnostic, type PlanValidation } from './validate.ts'

/** Thrown when a verb is handed a document that violates its contract. */
export class EvalContractError extends Error {}

/** Result of hashing one condition document. */
export interface ConditionHash {
  /** sha256 hex of the canonical condition JSON (notes excluded). */
  sha: string
  /** Unresolved fields and the like — not failures, listed for the caller. */
  warnings: EvalDiagnostic[]
}

/**
 * The offline kernel: contract checking and deterministic hashing. Holds no
 * state; every method is a pure function of its arguments (plus the files
 * they name).
 */
export class EvalService {
  /**
   * Validate a plan document against `dataseek.plan/1` and resolve what it
   * references (condition declarations, locks, stage schemas). Data problems
   * come back as diagnostics, never as throws.
   */
  validatePlan(planPath: string): Promise<PlanValidation> {
    return validatePlan(planPath)
  }

  /**
   * Hash a condition document (canonical JSON, `notes` excluded).
   * @throws {@link EvalContractError} when the document violates
   * `dataseek.condition/1` — a hash of an invalid document means nothing.
   */
  hashCondition(condition: unknown): ConditionHash {
    const { errors, warnings } = conditionDiagnostics(condition)
    if (errors.length > 0) {
      throw new EvalContractError(
        `condition violates ${CONDITION_SCHEMA_ID}:\n${errors.map(e => `  - [${e.code}] ${e.message}`).join('\n')}`,
      )
    }
    return { sha: hashConditionDocument(condition), warnings }
  }

  /**
   * Hash a scoped home's config content (deny-listed files excluded, content
   * never leaves the digest).
   * @throws Error when the directory does not exist.
   */
  hashHome(homeDir: string): Promise<HomeHash> {
    return hashHome(homeDir)
  }
}
