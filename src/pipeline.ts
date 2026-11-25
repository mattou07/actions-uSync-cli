import * as core from '@actions/core'
import { safeInfo } from './utils/safe-log.js'
import { STAGES } from './stages/index.js'
import type { Stage, StageContext, StageResult } from './stages/types.js'
import { errorMessage } from './stages/types.js'

/**
 * Runs the stages in order. Disabled stages are skipped; a failing stage that
 * is marked `abortOnFailure` stops the remaining ones, any other failure is
 * recorded and the pipeline carries on.
 */
export async function runPipeline(
  ctx: StageContext,
  stages: Stage[] = STAGES
): Promise<StageResult[]> {
  const results: StageResult[] = []
  let aborted: string | undefined

  for (const stage of stages) {
    const title = stage.getTitle?.(ctx.inputs) ?? stage.title
    let outcome: Omit<StageResult, 'id' | 'title'>

    if (!stage.enabled(ctx.inputs)) {
      outcome = { status: 'skipped', summary: 'Disabled' }
    } else if (aborted) {
      outcome = { status: 'skipped', summary: `Not run: ${aborted} failed` }
    } else {
      core.startGroup(title)
      try {
        outcome = await stage.run(ctx)
      } catch (error) {
        outcome = { status: 'failed', summary: errorMessage(error) }
      } finally {
        core.endGroup()
      }
      if (outcome.status === 'failed' && stage.abortOnFailure) aborted = title
    }

    const result: StageResult = { id: stage.id, title, ...outcome }
    results.push(result)
    ctx.results[stage.id] = result
    safeInfo(`${title}: ${result.status} - ${result.summary}`)
  }

  return results
}
