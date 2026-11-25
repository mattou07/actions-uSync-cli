import * as core from '@actions/core'
import { formatDuration } from '../utils/duration.js'
import { sleep } from '../utils/sleep.js'
import type { Stage } from './types.js'

const START_DELAY_MS = 2000
const MAX_DELAY_MS = 10000

export const rebuildCacheStage: Stage = {
  id: 'rebuild-cache',
  title: 'Rebuild cache',
  enabled: (inputs) => inputs.rebuildCache,
  async run(ctx) {
    const start = Date.now()
    const timeoutMs = ctx.inputs.timeoutMinutes * 60_000
    await ctx.umbraco.rebuildPublishedCache()
    core.info('Published cache rebuild requested, waiting for it to finish...')

    let delay = START_DELAY_MS
    for (;;) {
      await sleep(delay)
      delay = Math.min(delay * 1.5, MAX_DELAY_MS)
      const { isRebuilding } =
        await ctx.umbraco.getPublishedCacheRebuildStatus()
      if (!isRebuilding) break
      if (Date.now() - start >= timeoutMs) {
        throw new Error(
          `The published cache rebuild did not finish within ${formatDuration(timeoutMs)}`
        )
      }
    }

    const durationMs = Date.now() - start
    return {
      status: 'success',
      summary: `Published cache rebuilt in ${formatDuration(durationMs)}`,
      data: { durationMs }
    }
  }
}
