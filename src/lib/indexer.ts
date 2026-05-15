import * as core from '@actions/core'
import { UmbracoClient } from './umbraco-client'

export interface IndexRebuildResult {
  name: string
  /** requested = fire-and-forget accepted; Umbraco rebuilds asynchronously */
  status: 'requested' | 'not-found' | 'failed'
  error?: string
}

/**
 * Triggers a rebuild for each index name in parallel and returns a result per
 * index. 404 responses are reported as warnings rather than errors so a missing
 * index does not abort the remaining rebuilds.
 *
 * Umbraco processes rebuilds asynchronously — this function does not poll for
 * completion; it simply fires the request and moves on.
 *
 * Reference: uSync.Commands/Index/IndexerRebuildCommand.cs
 * Endpoint:  POST /umbraco/management/api/v1/indexer/{indexName}/rebuild
 */
export async function rebuildIndexes(
  server: string,
  token: string,
  indexNames: string[]
): Promise<IndexRebuildResult[]> {
  const client = new UmbracoClient(server, token)

  const results = await Promise.all(
    indexNames.map(async (name): Promise<IndexRebuildResult> => {
      const path = `umbraco/management/api/v1/indexer/${encodeURIComponent(name)}/rebuild`
      core.info(`🔨 Requesting rebuild of index "${name}"`)
      try {
        const response = await client.postRaw(path)
        if (response.status === 404) {
          core.warning(`Index "${name}" was not found on the server`)
          return { name, status: 'not-found' }
        }
        if (!response.ok) {
          const msg = `${response.status} ${response.statusText}`
          core.warning(`Rebuild request for "${name}" failed: ${msg}`)
          return { name, status: 'failed', error: msg }
        }
        core.info(
          `✅ Rebuild requested for "${name}" (Umbraco will process asynchronously)`
        )
        return { name, status: 'requested' }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        core.warning(`Rebuild request for "${name}" failed: ${msg}`)
        return { name, status: 'failed', error: msg }
      }
    })
  )

  return results
}
