import * as core from '@actions/core'
import * as exec from '@actions/exec'

export interface USyncExecutionResult {
  success: boolean
  exitCode: number
  output: string
  errorOutput: string
  changes: number
  command: string
}

/**
 * Execute a uSync CLI command with standard parameters
 */
export async function executeUSyncCommand(
  command: string,
  server: string,
  key: string,
  set?: string,
  group?: string,
  force?: boolean,
  additionalArgs?: string
): Promise<USyncExecutionResult> {
  let output = ''
  let errorOutput = ''

  const listeners = {
    stdout: (data: Buffer) => {
      output += data.toString()
    },
    stderr: (data: Buffer) => {
      errorOutput += data.toString()
    }
  }

  // Build the command arguments
  const args = [command, '-s', server, '-k', key]

  if (set && set !== 'default') {
    args.push('-set', set)
  }

  if (group && group !== 'all') {
    args.push('-group', group)
  }

  if (force) {
    args.push('-force')
  }

  if (additionalArgs) {
    args.push(...additionalArgs.split(' ').filter(arg => arg.trim()))
  }

  const fullCommand = `uSync ${args.join(' ')}`

  try {
    core.info(`Executing: ${fullCommand}`)

    const exitCode = await exec.exec('uSync', args, {
      listeners,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string },
      ignoreReturnCode: true
    })

    const changes = parseChangesFromOutput(output)

    // Log output for debugging
    if (output) {
      core.info('uSync Output:')
      core.info(output)
    }

    if (errorOutput) {
      if (exitCode === 0) {
        core.warning('uSync Warnings:')
        core.warning(errorOutput)
      } else {
        core.error('uSync Errors:')
        core.error(errorOutput)
      }
    }

    return {
      success: exitCode === 0,
      exitCode,
      output,
      errorOutput,
      changes,
      command: fullCommand
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown execution error'
    return {
      success: false,
      exitCode: -1,
      output,
      errorOutput: errorOutput || errorMessage,
      changes: 0,
      command: fullCommand
    }
  }
}

/**
 * Parse change count from uSync output
 */
export function parseChangesFromOutput(output: string): number {
  let changes = 0

  const lines = output.split('\n').filter(line => line.trim())

  for (const line of lines) {
    if (
      line.includes('Changes:') ||
      line.includes('changes detected') ||
      line.includes('items processed') ||
      line.includes('changes found') ||
      line.includes('Document Type') ||
      line.includes('Data Type') ||
      line.includes('ContentType') ||
      line.includes('DataType')
    ) {
      const match = line.match(/(\d+)/)
      if (match) {
        changes = Math.max(changes, parseInt(match[1], 10))
      }
    }
  }

  return changes
}

/**
 * Generate a standardized summary for uSync operations
 */
export async function generateUSyncSummary(
  operation: string,
  results: USyncExecutionResult[],
  additionalInfo?: string
): Promise<void> {
  let summary = `## 🔧 uSync ${operation} Results\n\n`

  const overallSuccess = results.every(r => r.success)
  summary += `**Overall Status:** ${overallSuccess ? '✅ Success' : '❌ Failed'}\n\n`

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const stepName = result.command.includes('report')
      ? 'Report'
      : result.command.includes('import')
        ? 'Import'
        : result.command.includes('export')
          ? 'Export'
          : `Step ${i + 1}`

    summary += `### ${stepName}\n\n`
    summary += `**Command:** \`${result.command}\`\n`
    summary += `**Status:** ${result.success ? '✅ Success' : '❌ Failed'}\n`
    summary += `**Changes:** ${result.changes}\n`

    if (result.output) {
      summary += `**Output:** \`${result.output.trim().substring(0, 200)}${result.output.length > 200 ? '...' : ''}\`\n`
    }

    if (result.errorOutput && !result.success) {
      summary += `**Error:** \`${result.errorOutput.trim().substring(0, 200)}${result.errorOutput.length > 200 ? '...' : ''}\`\n`
    }

    summary += `\n`
  }

  if (additionalInfo) {
    summary += `### Additional Information\n\n${additionalInfo}\n\n`
  }

  if (!overallSuccess) {
    summary += `### Troubleshooting\n\n`
    summary += `❌ Operation failed. Common issues:\n\n`
    summary += `- Check server URL and HMAC key\n`
    summary += `- Verify uSync is properly configured on the target site\n`
    summary += `- Ensure network connectivity to the Umbraco server\n`
    summary += `- Check uSync logs in Umbraco for detailed error information\n\n`
  }

  await core.summary.addRaw(summary).write()
}
