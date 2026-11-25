import { incompleteNote, runPerformStage } from './import.js'
import type { PerformData } from './import.js'
import type { Stage } from './types.js'
import type { USyncActionView } from '../types/usync.js'
import { safeWarning } from '../utils/safe-log.js'

export interface ReportData extends PerformData {
  /** After an import: changes the import should have applied but did not. */
  unapplied?: USyncActionView[]
  /** After an import: changes that were not pending before it. */
  appeared?: USyncActionView[]
}

const EMPTY_KEY = /^[0-]*$/

/** handler|key, falling back to the name when uSync gives no (or an all-zero) key. */
const itemId = (item: USyncActionView): string =>
  `${item.handler}|${item.key && !EMPTY_KEY.test(item.key) ? item.key : item.name}`

export const reportStage: Stage = {
  id: 'report',
  title: 'Report',
  getTitle: (inputs) => (inputs.import ? 'Report after import' : 'Report'),
  enabled: (inputs) => inputs.report,
  async run(ctx) {
    const data: ReportData = await runPerformStage(ctx, 'Report', false)
    const { result, analysis } = data
    const pending = analysis.changes.length
    const importStatus = ctx.results.import?.status
    const afterImport = importStatus !== undefined && importStatus !== 'skipped'

    const extras: string[] = []
    if (analysis.errors.length > 0) {
      extras.push(`${analysis.errors.length} errors`)
    }
    if (analysis.warnings.length > 0) {
      extras.push(`${analysis.warnings.length} warnings`)
    }
    const withExtras = (text: string): string =>
      [text, ...extras].join(', ') + incompleteNote(result)

    if (!afterImport) {
      let status: 'failed' | 'warning' | 'success' = 'success'
      if (!result.succeeded || (ctx.inputs.failOnChanges && pending > 0)) {
        status = 'failed'
      } else if (pending > 0 || extras.length > 0) {
        status = 'warning'
      }
      return {
        status,
        summary: withExtras(
          pending > 0 ? `${pending} pending changes` : 'No pending changes'
        ),
        data
      }
    }

    const before = ctx.results['pre-report']?.data as PerformData | undefined
    let unapplied = analysis.changes
    let appeared: USyncActionView[] = []
    if (before) {
      const beforeIds = new Set(before.analysis.changes.map(itemId))
      unapplied = analysis.changes.filter((i) => beforeIds.has(itemId(i)))
      appeared = analysis.changes.filter((i) => !beforeIds.has(itemId(i)))
    }
    data.unapplied = unapplied
    data.appeared = appeared
    for (const item of unapplied) {
      safeWarning(`${item.handler}: ${item.name} (${item.change})`)
    }

    const parts: string[] = []
    if (unapplied.length > 0) {
      parts.push(`${unapplied.length} changes were not applied by the import`)
    }
    if (appeared.length > 0) {
      parts.push(`${appeared.length} new changes appeared after the import`)
    }

    let status: 'failed' | 'warning' | 'success' = 'success'
    if (
      !result.succeeded ||
      unapplied.length > 0 ||
      (ctx.inputs.failOnChanges && pending > 0)
    ) {
      status = 'failed'
    } else if (appeared.length > 0 || extras.length > 0) {
      status = 'warning'
    }
    return {
      status,
      summary: withExtras(
        parts.length > 0 ? parts.join(', ') : 'No pending changes'
      ),
      data
    }
  }
}
