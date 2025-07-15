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
    const sourceKey = core.getInput('source-key')
    const targetServer = core.getInput('target-server')
    const targetKey = core.getInput('target-key')
    const set = core.getInput('set')
    const force = core.getInput('force') === 'true'
    const reportFirst = core.getInput('report-first') === 'true'

    // Validate inputs
    if (!sourceServer || !sourceKey || !targetServer || !targetKey) {
      throw new Error(
        'Source and target server URLs and HMAC keys are required'
      )
    }

    core.info('🔄 Starting content sync process...')

    const results: USyncExecutionResult[] = []
    let exportResult: USyncExecutionResult | undefined
    let importResult: USyncExecutionResult | undefined
    let reportResult: USyncExecutionResult | undefined

    // Step 1: Export from source
    core.info('📤 Exporting content from source environment...')
    exportResult = await executeUSyncCommand(
      'run export',
      sourceServer,
      sourceKey,
      set,
      'content'
    )
    results.push(exportResult)

    if (!exportResult.success) {
      throw new Error(`Export failed: ${exportResult.errorOutput}`)
    }

    core.info(
      `📤 Export completed: ${exportResult.changes} content items exported`
    )

    // Step 2: Run report on target if requested
    if (reportFirst) {
      core.info('📋 Checking for changes on target environment...')
      reportResult = await executeUSyncCommand(
        'run report',
        targetServer,
        targetKey,
        set,
        'content'
      )
      results.push(reportResult)

      if (!reportResult.success) {
        throw new Error(`Report failed: ${reportResult.errorOutput}`)
      }

      core.info(
        `📋 Report completed: ${reportResult.changes} content changes detected on target`
      )

      if (reportResult.changes === 0) {
        core.info('✅ No content changes detected on target - sync not needed')

        // Set outputs
        core.setOutput('export-result', exportResult.output)
        core.setOutput('report-result', reportResult.output)
        core.setOutput(
          'import-result',
          'No import needed - no changes detected'
        )
        core.setOutput('source-changes', exportResult.changes)
        core.setOutput('target-changes-detected', 0)
        core.setOutput('target-changes-imported', 0)
        core.setOutput('success', true)

        await generateUSyncSummary(
          'Content Sync',
          results,
          'No changes detected on target - sync skipped'
        )
        return
      }
    }

    // Step 3: Import to target
    core.info('📥 Importing content to target environment...')
    importResult = await executeUSyncCommand(
      'run import',
      targetServer,
      targetKey,
      set,
      'content',
      force
    )
    results.push(importResult)

    if (!importResult.success) {
      throw new Error(`Import failed: ${importResult.errorOutput}`)
    }

    // Set outputs
    core.setOutput('export-result', exportResult.output)
    core.setOutput('report-result', reportResult?.output || '')
    core.setOutput('import-result', importResult.output)
    core.setOutput('source-changes', exportResult.changes)
    core.setOutput('target-changes-detected', reportResult?.changes || 0)
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
