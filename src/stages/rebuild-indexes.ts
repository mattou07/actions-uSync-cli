import { isNotFound } from '../api/http.js'
import { safeInfo, safeWarning } from '../utils/safe-log.js'
import type { Stage } from './types.js'
import { errorMessage } from './types.js'

export interface IndexRebuild {
  name: string
  status: 'requested' | 'not-found' | 'failed'
  error?: string
}

export interface RebuildIndexesData {
  indexes: IndexRebuild[]
}

export const rebuildIndexesStage: Stage = {
  id: 'rebuild-indexes',
  title: 'Rebuild indexes',
  enabled: (inputs) => inputs.rebuildIndexes.length > 0,
  async run(ctx) {
    const indexes: IndexRebuild[] = []
    for (const name of ctx.inputs.rebuildIndexes) {
      try {
        await ctx.umbraco.rebuildIndex(name)
        indexes.push({ name, status: 'requested' })
        safeInfo(`Rebuild requested for index ${name}`)
      } catch (error) {
        if (isNotFound(error)) {
          indexes.push({ name, status: 'not-found' })
          safeWarning(`Index ${name} was not found`)
        } else {
          const message = errorMessage(error)
          indexes.push({ name, status: 'failed', error: message })
          safeWarning(`Rebuilding index ${name} failed: ${message}`)
        }
      }
    }

    const count = (status: IndexRebuild['status']) =>
      indexes.filter((i) => i.status === status).length
    const failed = count('failed')
    const missing = count('not-found')
    let summary = `Rebuild requested for ${count('requested')} of ${indexes.length} indexes`
    if (missing > 0) summary += `, ${missing} not found`
    if (failed > 0) summary += `, ${failed} failed`

    let status: 'failed' | 'warning' | 'success' = 'success'
    if (failed > 0) status = 'failed'
    else if (missing > 0) status = 'warning'
    return { status, summary, data: { indexes } satisfies RebuildIndexesData }
  }
}
