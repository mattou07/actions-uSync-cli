import * as core from '@actions/core'
import * as exec from '@actions/exec'
//import { wait } from './wait'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    core.debug(`Checking for Dotnet`)
    await exec.exec('dotnet --version')

    core.debug(`Installing uSync.Cli`)
    await exec.exec('dotnet tool install uSync.Cli -g')

    const server: string = core.getInput('server')
    const key: string = core.getInput('key')

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    //core.debug(`Waiting ${ms} milliseconds ...`)

    // // Log the current timestamp, wait, then log the new timestamp
    // core.debug(new Date().toTimeString())
    // await wait(parseInt(ms, 10))
    // core.debug(new Date().toTimeString())

    // Set outputs for other workflow steps to use
    //core.setOutput('time', new Date().toTimeString())
    let myOutput = ''
    let myError = ''
    const options: any = {}
    options.listeners = {
      stdout: (data: Buffer) => {
        myOutput += data.toString()
      },
      stderr: (data: Buffer) => {
        myError += data.toString()
      }
    }

    core.debug(`Attempt to gather info of target ${server}`)
    await exec.exec('uSync run info', [`-s ${server}`, `-k ${key}`], options)

    // Set outputs for other workflow steps to use
    core.setOutput('version', myOutput)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
