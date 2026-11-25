import * as os from 'node:os'
import * as core from '@actions/core'
import { DefaultArtifactClient } from '@actions/artifact'
import { HttpClient } from './api/http.js'
import { PublisherApi } from './api/publisher-api.js'
import { TokenProvider } from './api/token-provider.js'
import { UmbracoApi } from './api/umbraco-api.js'
import { USyncApi } from './api/usync-api.js'
import { getInputs } from './inputs.js'
import { runPipeline } from './pipeline.js'
import { setOutputs, writeResultsFile } from './report/outputs.js'
import { writeSummary } from './report/summary.js'
import type { ArtifactUploader, StageContext } from './stages/types.js'
import { errorMessage } from './stages/types.js'

function createArtifactUploader(): ArtifactUploader {
  return {
    async upload(name, filePath, rootDir) {
      const response = await new DefaultArtifactClient().uploadArtifact(
        name,
        [filePath],
        rootDir
      )
      return { id: response.id, size: response.size }
    }
  }
}

/** Runs the uSync pipeline described by the action inputs. */
export async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const http = new HttpClient(inputs.server, {
      requestTimeoutMs: inputs.requestTimeoutSeconds * 1000
    })
    http.setAuth(new TokenProvider(http, inputs.clientId, inputs.clientSecret))

    const tempDir = process.env.RUNNER_TEMP || os.tmpdir()
    const ctx: StageContext = {
      inputs,
      umbraco: new UmbracoApi(http),
      usync: new USyncApi(http),
      publisher: new PublisherApi(http),
      site: { set: inputs.set },
      results: {},
      artifacts: createArtifactUploader(),
      tempDir
    }

    const results = await runPipeline(ctx)

    let resultsFile = ''
    try {
      resultsFile = await writeResultsFile(results, tempDir)
    } catch (error) {
      core.warning(`Could not write the results file: ${errorMessage(error)}`)
    }
    try {
      setOutputs(results, resultsFile)
    } catch (error) {
      core.warning(`Could not set the outputs: ${errorMessage(error)}`)
    }
    try {
      await writeSummary(results, ctx.site, inputs.server)
    } catch (error) {
      core.warning(`Could not write the job summary: ${errorMessage(error)}`)
    }

    const failed = results.filter((r) => r.status === 'failed')
    if (failed.length > 0) {
      core.setFailed(`uSync failed: ${failed.map((r) => r.title).join(', ')}`)
    }
  } catch (error) {
    core.setFailed(errorMessage(error))
  }
}
