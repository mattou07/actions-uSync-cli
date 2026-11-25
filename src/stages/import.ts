import { analyse } from '../usync/analyse.js'
import type { Analysis } from '../usync/analyse.js'
import { runPerform } from '../usync/perform.js'
import type { PerformResult } from '../usync/perform.js'
import type { PerformAction } from '../types/usync.js'
import { safeWarning } from '../utils/safe-log.js'
import type { Stage, StageContext } from './types.js'

export interface PerformData {
  result: PerformResult
  analysis: Analysis
  artifactName?: string
  zipBytes?: number
}

/** Runs a uSync action and analyses it, logging every failed item. */
export async function runPerformStage(
  ctx: StageContext,
  action: PerformAction,
  clean: boolean
): Promise<PerformData> {
  const { inputs, site } = ctx
  const result = await runPerform(ctx.usync, {
    action,
    set: site.set,
    group: inputs.group,
    force: action === 'Import' && inputs.force,
    clean,
    timeoutMs: inputs.timeoutMinutes * 60_000
  })
  const analysis = analyse(result.actions, result.status)
  for (const item of analysis.errors) {
    safeWarning(
      `${item.handler}: ${item.name} (${item.change})${item.message ? ` - ${item.message}` : ''}`
    )
  }
  return { result, analysis }
}

/** ` (operation Failed: message)` when a background run did not succeed. */
export function incompleteNote(result: PerformResult): string {
  if (result.succeeded) return ''
  const detail = result.message ? `: ${result.message}` : ''
  return ` (operation ${result.operationStatus ?? 'incomplete'}${detail})`
}

export const importStage: Stage = {
  id: 'import',
  title: 'Import',
  enabled: (inputs) => inputs.import,
  async run(ctx) {
    const data = await runPerformStage(ctx, 'Import', false)
    const { result, analysis } = data
    let status: 'failed' | 'warning' | 'success' = 'success'
    if (!result.succeeded || analysis.errors.length > 0) status = 'failed'
    else if (analysis.warnings.length > 0) status = 'warning'
    return {
      status,
      summary: `${analysis.changes.length} changes imported, ${analysis.errors.length} errors${incompleteNote(result)}`,
      data
    }
  }
}
