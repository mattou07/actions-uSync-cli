import * as core from '@actions/core'
import * as exec from '@actions/exec'

interface SetupResult {
  success: boolean
  dotnetVersion: string
  usyncVersion: string
  installLocation: string
  message: string
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const dotnetVersion = core.getInput('dotnet-version') || '8.0.x'
    const usyncVersion = core.getInput('usync-version') || 'latest'
    const forceReinstall = core.getInput('force-reinstall') === 'true'

    core.info('🔧 Setting up uSync CLI...')

    const result = await setupUSyncCli(
      dotnetVersion,
      usyncVersion,
      forceReinstall
    )

    // Set outputs
    core.setOutput('success', result.success)
    core.setOutput('dotnet-version', result.dotnetVersion)
    core.setOutput('usync-version', result.usyncVersion)
    core.setOutput('install-location', result.installLocation)
    core.setOutput('version', result.usyncVersion) // For backward compatibility

    // Generate summary
    await generateSetupSummary(result)

    if (!result.success) {
      core.setFailed(result.message)
    } else {
      core.info(`✅ ${result.message}`)
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred'
    core.error(`Setup failed: ${errorMessage}`)
    core.setFailed(errorMessage)

    // Set failure outputs
    core.setOutput('success', false)
    core.setOutput('dotnet-version', '')
    core.setOutput('usync-version', '')
    core.setOutput('install-location', '')
  }
}

async function setupUSyncCli(
  dotnetVersion: string,
  usyncVersion: string,
  forceReinstall: boolean
): Promise<SetupResult> {
  // Step 1: Check and validate .NET installation
  core.info('🔍 Checking .NET installation...')
  const dotnetInfo = await checkDotnetInstallation()

  if (!dotnetInfo.success) {
    return {
      success: false,
      dotnetVersion: '',
      usyncVersion: '',
      installLocation: '',
      message:
        'Failed to detect .NET installation. Please ensure .NET SDK is installed on the runner.'
    }
  }

  core.info(`✅ .NET detected: ${dotnetInfo.version}`)

  // Step 2: Check if uSync CLI is already installed
  if (!forceReinstall) {
    core.info('🔍 Checking for existing uSync CLI installation...')
    const existingInstall = await checkExistingUSyncInstallation()

    if (existingInstall.exists) {
      core.info(`✅ uSync CLI already installed: ${existingInstall.version}`)

      // Check if version matches what we want
      if (
        usyncVersion === 'latest' ||
        existingInstall.version.includes(usyncVersion)
      ) {
        return {
          success: true,
          dotnetVersion: dotnetInfo.version,
          usyncVersion: existingInstall.version,
          installLocation: existingInstall.location,
          message: `uSync CLI already installed (${existingInstall.version})`
        }
      } else {
        core.info(
          `⚠️  Version mismatch. Requested: ${usyncVersion}, Found: ${existingInstall.version}`
        )
      }
    }
  }

  // Step 3: Install or update uSync CLI
  core.info('📦 Installing uSync CLI...')
  const installResult = await installUSyncCli(usyncVersion, forceReinstall)

  if (!installResult.success) {
    return {
      success: false,
      dotnetVersion: dotnetInfo.version,
      usyncVersion: '',
      installLocation: '',
      message: `Failed to install uSync CLI: ${installResult.error}`
    }
  }

  // Step 4: Verify installation
  core.info('✅ Verifying uSync CLI installation...')
  const verifyResult = await verifyUSyncInstallation()

  return {
    success: verifyResult.success,
    dotnetVersion: dotnetInfo.version,
    usyncVersion: verifyResult.version,
    installLocation: verifyResult.location,
    message: verifyResult.success
      ? `uSync CLI successfully installed (${verifyResult.version})`
      : `Installation verification failed: ${verifyResult.error}`
  }
}

async function checkDotnetInstallation(): Promise<{
  success: boolean
  version: string
}> {
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

  try {
    const exitCode = await exec.exec('dotnet', ['--version'], {
      listeners,
      ignoreReturnCode: true
    })

    if (exitCode === 0 && output.trim()) {
      return {
        success: true,
        version: output.trim()
      }
    }

    return {
      success: false,
      version: ''
    }
  } catch (error) {
    core.debug(`Error checking .NET: ${error}`)
    return {
      success: false,
      version: ''
    }
  }
}

async function checkExistingUSyncInstallation(): Promise<{
  exists: boolean
  version: string
  location: string
}> {
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

  try {
    // First try to get version
    const exitCode = await exec.exec('uSync', ['--version'], {
      listeners,
      ignoreReturnCode: true
    })

    if (exitCode === 0 && output.trim()) {
      // Try to get installation location
      let locationOutput = ''
      const locationListeners = {
        stdout: (data: Buffer) => {
          locationOutput += data.toString()
        },
        stderr: (data: Buffer) => {
          /* ignore stderr for this check */
        }
      }

      try {
        await exec.exec('dotnet', ['tool', 'list', '-g'], {
          listeners: locationListeners,
          ignoreReturnCode: true
        })
      } catch (error) {
        core.debug(`Could not get tool list: ${error}`)
      }

      const usyncLine = locationOutput
        .split('\n')
        .find(
          line =>
            line.toLowerCase().includes('usync') &&
            line.toLowerCase().includes('cli')
        )

      return {
        exists: true,
        version: output.trim(),
        location: usyncLine ? usyncLine.trim() : 'Global .NET Tools'
      }
    }

    return {
      exists: false,
      version: '',
      location: ''
    }
  } catch (error) {
    core.debug(`Error checking existing uSync: ${error}`)
    return {
      exists: false,
      version: '',
      location: ''
    }
  }
}

async function installUSyncCli(
  version: string,
  forceReinstall: boolean
): Promise<{ success: boolean; error?: string }> {
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

  try {
    const args = ['tool', 'install', 'uSync.Cli', '-g']

    // Add version specification if not latest
    if (version && version !== 'latest') {
      args.push('--version', version)
    }

    // Add update flag if force reinstall
    if (forceReinstall) {
      // Use update instead of install for force reinstall
      args[1] = 'update'
    }

    core.info(`Executing: dotnet ${args.join(' ')}`)

    const exitCode = await exec.exec('dotnet', args, {
      listeners,
      ignoreReturnCode: true
    })

    if (exitCode === 0) {
      return { success: true }
    }

    // If install failed, try update (tool might already exist)
    if (!forceReinstall && errorOutput.includes('already installed')) {
      core.info('Tool already exists, attempting update...')
      const updateArgs = ['tool', 'update', 'uSync.Cli', '-g']

      if (version && version !== 'latest') {
        updateArgs.push('--version', version)
      }

      const updateExitCode = await exec.exec('dotnet', updateArgs, {
        listeners,
        ignoreReturnCode: true
      })

      return {
        success: updateExitCode === 0,
        error: updateExitCode !== 0 ? errorOutput : undefined
      }
    }

    return {
      success: false,
      error: errorOutput || 'Installation failed with unknown error'
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Unknown installation error'
    }
  }
}

async function verifyUSyncInstallation(): Promise<{
  success: boolean
  version: string
  location: string
  error?: string
}> {
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

  try {
    // Test version command
    const exitCode = await exec.exec('uSync', ['--version'], {
      listeners,
      ignoreReturnCode: true
    })

    if (exitCode === 0 && output.trim()) {
      // Test a simple command to ensure it's working
      let helpOutput = ''
      const helpListeners = {
        stdout: (data: Buffer) => {
          helpOutput += data.toString()
        },
        stderr: (data: Buffer) => {
          /* ignore stderr for help */
        }
      }

      const helpExitCode = await exec.exec('uSync', ['--help'], {
        listeners: helpListeners,
        ignoreReturnCode: true
      })

      return {
        success: helpExitCode === 0,
        version: output.trim(),
        location: 'Global .NET Tools',
        error:
          helpExitCode !== 0
            ? 'Tool installed but not responding to commands'
            : undefined
      }
    }

    return {
      success: false,
      version: '',
      location: '',
      error: errorOutput || 'Could not verify uSync CLI installation'
    }
  } catch (error) {
    return {
      success: false,
      version: '',
      location: '',
      error:
        error instanceof Error ? error.message : 'Unknown verification error'
    }
  }
}

async function generateSetupSummary(result: SetupResult): Promise<void> {
  let summary = `## 🔧 uSync CLI Setup Results\n\n`

  summary += `**Status:** ${result.success ? '✅ Success' : '❌ Failed'}\n`
  summary += `**Message:** ${result.message}\n\n`

  if (result.success) {
    summary += `### Installation Details\n\n`
    summary += `**uSync CLI Version:** ${result.usyncVersion}\n`
    summary += `**.NET Version:** ${result.dotnetVersion}\n`
    summary += `**Install Location:** ${result.installLocation}\n\n`

    summary += `### Next Steps\n\n`
    summary += `✅ uSync CLI is ready to use in subsequent steps\n\n`
    summary += `**Available commands:**\n`
    summary += `- \`uSync run report\` - Generate reports\n`
    summary += `- \`uSync run import\` - Import changes\n`
    summary += `- \`uSync run export\` - Export changes\n`
    summary += `- \`uSync --help\` - Show all available commands\n\n`

    summary += `**Example usage in workflow:**\n`
    summary += `\`\`\`yaml\n`
    summary += `- name: Run uSync Report\n`
    summary += `  uses: mattou07/actions-uSync-cli/invoke@v1\n`
    summary += `  with:\n`
    summary += `    action: 'report'\n`
    summary += `    server: \${{ vars.UMBRACO_URL }}\n`
    summary += `    key: \${{ secrets.USYNC_HMAC_KEY }}\n`
    summary += `\`\`\`\n`
  } else {
    summary += `### Troubleshooting\n\n`
    summary += `❌ Setup failed. Common issues:\n\n`
    summary += `**Missing .NET SDK:**\n`
    summary += `- Ensure .NET SDK 6.0+ is installed on the runner\n`
    summary += `- Add \`uses: actions/setup-dotnet@v4\` before this action\n\n`
    summary += `**Network Issues:**\n`
    summary += `- Check if the runner can access NuGet.org\n`
    summary += `- Verify no firewall blocking package downloads\n\n`
    summary += `**Permission Issues:**\n`
    summary += `- Ensure runner has permission to install global tools\n`
    summary += `- Try using \`force-reinstall: true\`\n\n`
  }

  await core.summary.addRaw(summary).write()
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
