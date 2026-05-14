import * as core from '@actions/core'
import {
  executeUSyncCommand,
  generateUSyncSummary,
  USyncExecutionResult
} from '../shared/usync-utils'

/**
 * The main function for the import content action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const server = core.getInput('server')
    const clientId = core.getInput('client-id')
    const secret = core.getInput('secret')
    const force = core.getInput('force') === 'true'

    // Validate inputs
    if (!server || !clientId || !secret) {
      throw new Error('Server URL, client-id, and secret are required')
    }

    core.info('📄 Starting content import process...')

    const results: USyncExecutionResult[] = []

    // Perform import
    core.info('📥 Importing content...')
    const importResult = await executeUSyncCommand(
      'usync-import',
      server,
      clientId,
      secret,
      force
    )
    results.push(importResult)

    if (!importResult.success) {
      throw new Error(`Import failed: ${importResult.errorOutput}`)
    }

    // Set outputs
    core.setOutput('import-result', importResult.output)
    core.setOutput('changes-imported', importResult.changes)
    core.setOutput('success', true)

    // Generate summary
    await generateUSyncSummary('Content Import', results)

    core.info(`✅ Content import completed successfully`)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred'
    core.error(`Content import failed: ${errorMessage}`)
    core.setFailed(errorMessage)

    // Set failure outputs
    core.setOutput('success', false)
    core.setOutput('changes-imported', 0)
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
