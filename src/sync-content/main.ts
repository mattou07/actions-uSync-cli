import * as core from '@actions/core'
import {
  executeUSyncCommand,
  generateUSyncSummary,
  USyncExecutionResult
} from '../shared/usync-utils'

/**
 * The main function for the sync content action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const sourceServer = core.getInput('source-server')
    const sourceClientId = core.getInput('source-client-id')
    const sourceSecret = core.getInput('source-secret')
    const targetServer = core.getInput('target-server')
    const targetClientId = core.getInput('target-client-id')
    const targetSecret = core.getInput('target-secret')
    const force = core.getInput('force') === 'true'

    // Validate inputs
    if (
      !sourceServer ||
      !sourceClientId ||
      !sourceSecret ||
      !targetServer ||
      !targetClientId ||
      !targetSecret
    ) {
      throw new Error(
        'Source and target server URLs, client IDs, and secrets are required'
      )
    }

    core.info('🔄 Starting content sync process...')

    const results: USyncExecutionResult[] = []
    let exportResult: USyncExecutionResult | undefined
    let importResult: USyncExecutionResult | undefined

    // Step 1: Export from source
    core.info('📤 Exporting content from source environment...')
    exportResult = await executeUSyncCommand(
      'usync-export',
      sourceServer,
      sourceClientId,
      sourceSecret
    )
    results.push(exportResult)

    if (!exportResult.success) {
      throw new Error(`Export failed: ${exportResult.errorOutput}`)
    }

    core.info(
      `📤 Export completed: ${exportResult.changes} content items exported`
    )

    // Step 2: Import to target
    core.info('📥 Importing content to target environment...')
    importResult = await executeUSyncCommand(
      'usync-import',
      targetServer,
      targetClientId,
      targetSecret,
      force
    )
    results.push(importResult)

    if (!importResult.success) {
      throw new Error(`Import failed: ${importResult.errorOutput}`)
    }

    // Set outputs
    core.setOutput('export-result', exportResult.output)
    core.setOutput('import-result', importResult.output)
    core.setOutput('source-changes', exportResult.changes)
    core.setOutput('target-changes-imported', importResult.changes)
    core.setOutput('success', true)

    // Generate summary
    await generateUSyncSummary('Content Sync', results)

    core.info(`✅ Content sync completed successfully`)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred'
    core.error(`Content sync failed: ${errorMessage}`)
    core.setFailed(errorMessage)

    // Set failure outputs
    core.setOutput('success', false)
    core.setOutput('source-changes', 0)
    core.setOutput('target-changes-detected', 0)
    core.setOutput('target-changes-imported', 0)
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
