import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import { ApiError } from '../api/http.js'
import { incompleteNote, runPerformStage } from './import.js'
import type { PerformData } from './import.js'
import type { Stage } from './types.js'

export const exportStage: Stage = {
  id: 'export',
  title: 'Export',
  enabled: (inputs) => inputs.export,
  async run(ctx) {
    const { inputs } = ctx
    const data: PerformData = await runPerformStage(
      ctx,
      'Export',
      inputs.exportClean
    )
    const { result, analysis } = data
    let summary = `${analysis.changes.length} items exported, ${analysis.errors.length} errors${incompleteNote(result)}`
    const failed = !result.succeeded || analysis.errors.length > 0

    if (inputs.downloadExport && result.succeeded) {
      let zip: Buffer
      try {
        zip = await ctx.usync.download()
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          return {
            status: 'failed',
            summary: `${summary}; downloading the export needs an API user in an admin group`,
            data
          }
        }
        throw error
      }
      const dir = path.join(ctx.tempDir, 'usync-export')
      const file = path.join(dir, `${inputs.exportArtifactName}.zip`)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(file, zip)
      await ctx.artifacts.upload(inputs.exportArtifactName, file, dir)
      data.artifactName = inputs.exportArtifactName
      data.zipBytes = zip.length
      core.info(
        `Uploaded artifact ${inputs.exportArtifactName} (${zip.length} bytes)`
      )
      summary += `; uploaded artifact ${inputs.exportArtifactName}`
    }

    return { status: failed ? 'failed' : 'success', summary, data }
  }
}
