import * as core from '@actions/core'
import { executeUSyncCommand } from '../shared/usync-utils'

/**
 * The main function for the invoke action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const command = core.getInput('command')
    const server = core.getInput('server')
    const key = core.getInput('key')
    const set = core.getInput('set')
    const force = core.getInput('force') === 'true'
    const mode = core.getInput('mode')

    // Validate inputs
    if (!command) {
      throw new Error('Command is required')
    }
    if (!server || !key) {
      throw new Error('Server URL and HMAC key are required')
    }

    core.info(`🚀 Executing uSync command: ${command}`)

    // Execute the command using shared utilities
    const result = await executeUSyncCommand(
      command,
      server,
      key,
      set,
      mode,
      force
    )

    if (!result.success) {
      throw new Error(`Command failed: ${result.errorOutput}`)
    }

    // Set outputs
    core.setOutput('result', result.output)
    core.setOutput('changes', result.changes)
    core.setOutput('success', true)

    core.info(`✅ Command completed successfully: ${result.changes} changes`)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred'
    core.error(`Command failed: ${errorMessage}`)
    core.setFailed(errorMessage)

    // Set failure outputs
    core.setOutput('success', false)
    core.setOutput('changes', 0)
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
