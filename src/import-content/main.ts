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
    const key = core.getInput('key')
    const set = core.getInput('set')
    const force = core.getInput('force') === 'true'
    const reportFirst = core.getInput('report-first') === 'true'

    // Validate inputs
    if (!server || !key) {
      throw new Error('Server URL and HMAC key are required')
    }

    core.info('📄 Starting content import process...')

    const results: USyncExecutionResult[] = []
    let reportResult: USyncExecutionResult | undefined
    let importResult: USyncExecutionResult | undefined

    // Step 1: Run report if requested
    if (reportFirst) {
      core.info('📋 Checking for content changes...')
      reportResult = await executeUSyncCommand(
        'run report',
        server,
        key,
        set,
        'content'
      )
      results.push(reportResult)

      if (!reportResult.success) {
        throw new Error(`Report failed: ${reportResult.errorOutput}`)
      }

      core.info(
        `📋 Report completed: ${reportResult.changes} content changes detected`
      )

      if (reportResult.changes === 0) {
        core.info('✅ No content changes detected - import not needed')

        // Set outputs
        core.setOutput('report-result', reportResult.output)
        core.setOutput(
          'import-result',
          'No import needed - no changes detected'
        )
        core.setOutput('changes-detected', 0)
        core.setOutput('changes-imported', 0)
        core.setOutput('success', true)

        await generateUSyncSummary(
          'Content Import',
          results,
          'No changes detected - import skipped'
        )
        return
      }
    }

    // Step 2: Perform import
    core.info('📥 Importing content...')
    importResult = await executeUSyncCommand(
      'run import',
      server,
      key,
      set,
      'content',
      force
    )
    results.push(importResult)

    if (!importResult.success) {
      throw new Error(`Import failed: ${importResult.errorOutput}`)
    }

    // Set outputs
    core.setOutput('report-result', reportResult?.output || '')
    core.setOutput('import-result', importResult.output)
    core.setOutput('changes-detected', reportResult?.changes || 0)
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
    core.setOutput('changes-detected', 0)
    core.setOutput('changes-imported', 0)
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
