import { incompleteNote, runPerformStage } from './import.js'
import type { Stage } from './types.js'

export const reportStage: Stage = {
  id: 'report',
  title: 'Report',
  enabled: (inputs) => inputs.report,
  async run(ctx) {
    const data = await runPerformStage(ctx, 'Report', false)
    const { result, analysis } = data
    const pending = analysis.changes.length
    const importStatus = ctx.results.import?.status
    const afterImport = importStatus !== undefined && importStatus !== 'skipped'

    let summary = 'No pending changes'
    if (pending > 0) {
      summary = afterImport
        ? `${pending} items still differ after import`
        : `${pending} pending changes`
    }
    if (analysis.errors.length > 0) {
      summary += `, ${analysis.errors.length} errors`
    }
    if (analysis.warnings.length > 0) {
      summary += `, ${analysis.warnings.length} warnings`
    }
    summary += incompleteNote(result)

    let status: 'failed' | 'warning' | 'success' = 'success'
    if (!result.succeeded || (ctx.inputs.failOnChanges && pending > 0)) {
      status = 'failed'
    } else if (
      pending > 0 ||
      analysis.errors.length > 0 ||
      analysis.warnings.length > 0
    ) {
      status = 'warning'
    }
    return { status, summary, data }
  }
}
