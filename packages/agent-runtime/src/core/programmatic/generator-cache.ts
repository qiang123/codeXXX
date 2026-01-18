/**
 * Generator state management for programmatic agents
 */

import { clearProposedContentForRun } from '../../tools/handlers/tool/proposed-content-store'

import type { StepGenerator } from '@codebuff/common/types/agent-template'
import type { Logger } from '@codebuff/common/types/contracts/logger'

// Maintains generator state for all agents. Generator state can't be serialized, so we store it in memory.
const runIdToGenerator: Record<string, StepGenerator | undefined> = {}
export const runIdToStepAll: Set<string> = new Set()

/**
 * Gets the generator for a run ID
 */
export function getGenerator(runId: string): StepGenerator | undefined {
  return runIdToGenerator[runId]
}

/**
 * Sets the generator for a run ID
 */
export function setGenerator(runId: string, generator: StepGenerator): void {
  runIdToGenerator[runId] = generator
}

/**
 * Clears the generator for a run ID
 */
export function clearGenerator(runId: string): void {
  delete runIdToGenerator[runId]
  runIdToStepAll.delete(runId)
  clearProposedContentForRun(runId)
}

/**
 * Clears the entire generator cache for testing purposes
 */
export function clearAgentGeneratorCache(params: { logger: Logger }): void {
  for (const key in runIdToGenerator) {
    clearProposedContentForRun(key)
    delete runIdToGenerator[key]
  }
  runIdToStepAll.clear()
}

/**
 * Checks if a run is in STEP_ALL mode
 */
export function isInStepAllMode(runId: string): boolean {
  return runIdToStepAll.has(runId)
}

/**
 * Adds a run to STEP_ALL mode
 */
export function addToStepAllMode(runId: string): void {
  runIdToStepAll.add(runId)
}

/**
 * Removes a run from STEP_ALL mode
 */
export function removeFromStepAllMode(runId: string): void {
  runIdToStepAll.delete(runId)
}
