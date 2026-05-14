import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as os from 'os'
import * as path from 'path'

/**
 * The main function for the uSync CLI action.
 * Installs the CLI if not already present, then runs the requested command.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const server = core.getInput('server', { required: true })
    const clientId = core.getInput('client-id', { required: true })
    const secret = core.getInput('secret', { required: true })
    const command = core.getInput('command', { required: true })
    const usyncVersion = core.getInput('usync-version') || 'latest'
    const additionalArgs = core.getInput('additional-args')

    // Mask the secret so it never appears in logs
    core.setSecret(secret)

    // Step 1: Ensure the uSync CLI is installed
    await ensureUSyncCli(usyncVersion)

    // Step 2: Run the requested command
    core.info(`🚀 Running uSync command: ${command}`)

    let output = ''
    const listeners = {
      stdout: (data: Buffer) => {
        output += data.toString()
      },
      stderr: (data: Buffer) => {
        output += data.toString()
      }
    }

    // -s <server>, -s <secret>, -k <clientId>
    const args = [command, '-s', server, '-s', secret, '-k', clientId]

    if (additionalArgs) {
      args.push(...additionalArgs.split(' ').filter(a => a.trim().length > 0))
    }

    const exitCode = await exec.exec('uSyncCli', args, {
      listeners,
      ignoreReturnCode: true
    })

    const success = exitCode === 0

    core.setOutput('success', success)
    core.setOutput('exit-code', exitCode)
    core.setOutput('output', output)

    if (success) {
      core.info(`✅ Command '${command}' completed successfully`)
    } else {
      core.setFailed(
        `uSync command '${command}' failed with exit code ${exitCode}`
      )
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred'
    core.setFailed(message)
    core.setOutput('success', false)
    core.setOutput('exit-code', -1)
    core.setOutput('output', '')
  }
}

/**
 * Installs uSync.Cli as a global .NET tool if it is not already present.
 */
async function ensureUSyncCli(version: string): Promise<void> {
  // The dotnet global tools directory is not always on PATH (e.g. on GitHub
  // Actions runners when the tool is installed mid-job). Add it now so both
  // the version check and the subsequent command invocation can find the binary.
  const dotnetToolsDir = path.join(os.homedir(), '.dotnet', 'tools')
  core.addPath(dotnetToolsDir) // persists for subsequent workflow steps
  process.env.PATH = `${dotnetToolsDir}${path.delimiter}${process.env.PATH ?? ''}` // current process

  // Check if already installed
  const checkCode = await exec.exec('uSyncCli', ['--version'], {
    ignoreReturnCode: true,
    silent: true
  })

  if (checkCode === 0) {
    core.info('✅ uSync CLI already installed')
    return
  }

  core.info('📦 Installing uSync CLI...')

  const args = ['tool', 'install', 'uSync.Cli', '-g']
  if (version !== 'latest') {
    args.push('--version', version)
  }

  let errorOutput = ''
  const installCode = await exec.exec('dotnet', args, {
    ignoreReturnCode: true,
    listeners: {
      stderr: (data: Buffer) => {
        errorOutput += data.toString()
      }
    }
  })

  if (installCode !== 0) {
    // Tool may already be installed under a different version — try updating
    if (errorOutput.includes('already installed')) {
      core.info('⚠️ Tool already installed, updating...')
      const updateArgs = ['tool', 'update', 'uSync.Cli', '-g']
      if (version !== 'latest') {
        updateArgs.push('--version', version)
      }
      const updateCode = await exec.exec('dotnet', updateArgs, {
        ignoreReturnCode: true
      })
      if (updateCode !== 0) {
        throw new Error('Failed to update uSync CLI')
      }
    } else {
      throw new Error(`Failed to install uSync CLI: ${errorOutput}`)
    }
  }

  core.info('✅ uSync CLI installed')
}
