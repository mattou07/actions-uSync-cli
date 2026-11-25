import { incompleteNote, runPerformStage } from './import.js'
import type { PerformData } from './import.js'
import type { Stage } from './types.js'

/**
 * Reports what an import is about to change. Pending changes are expected here
 * and never fail the stage; the report after the import checks they applied.
 */
export const preReportStage: Stage = {
  id: 'pre-report',
  title: 'Report before import',
  enabled: (inputs) => inputs.import && inputs.report,
  async run(ctx) {
    const data: PerformData = await runPerformStage(ctx, 'Report', false)
    const { result, analysis } = data
    const pending = analysis.changes.length

    let summary =
      pending > 0 ? `${pending} changes to import` : 'Nothing to import'
    if (analysis.errors.length > 0) {
      summary += `, ${analysis.errors.length} errors`
    }
    if (analysis.warnings.length > 0) {
      summary += `, ${analysis.warnings.length} warnings`
    }
    summary += incompleteNote(result)

    let status: 'failed' | 'warning' | 'success' = 'success'
    if (!result.succeeded) {
      status = 'failed'
    } else if (analysis.errors.length > 0 || analysis.warnings.length > 0) {
      status = 'warning'
    }
    return { status, summary, data }
  }
}
