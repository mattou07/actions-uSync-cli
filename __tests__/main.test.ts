/**
 * Unit tests for the root generic invoke action, src/main.ts
 */

import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as main from '../src/main'

// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Mock the GitHub Actions core and exec libraries
let getInputMock: jest.SpiedFunction<typeof core.getInput>
let setFailedMock: jest.SpiedFunction<typeof core.setFailed>
let setOutputMock: jest.SpiedFunction<typeof core.setOutput>
let setSecretMock: jest.SpiedFunction<typeof core.setSecret>
let infoMock: jest.SpiedFunction<typeof core.info>
let execMock: jest.SpiedFunction<typeof exec.exec>

describe('run', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
    setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation()
    setSecretMock = jest.spyOn(core, 'setSecret').mockImplementation()
    infoMock = jest.spyOn(core, 'info').mockImplementation()
    execMock = jest
      .spyOn(exec, 'exec')
      .mockImplementation(async () => 0) as jest.SpiedFunction<typeof exec.exec>
  })

  it('executes the uSync command with correct arguments on success', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'server':
          return 'https://example.com'
        case 'client-id':
          return 'my-client-id'
        case 'secret':
          return 'my-secret'
        case 'command':
          return 'usync-ping'
        case 'additional-args':
          return ''
        default:
          return ''
      }
    })

    await main.run()
    expect(runMock).toHaveReturned()

    expect(setSecretMock).toHaveBeenCalledWith('my-secret')
    expect(execMock).toHaveBeenCalledWith(
      'uSync',
      [
        'usync-ping',
        '-s',
        'https://example.com',
        '-k',
        'my-client-id',
        '--secret',
        'my-secret'
      ],
      expect.objectContaining({ ignoreReturnCode: true })
    )
    expect(setOutputMock).toHaveBeenCalledWith('success', true)
    expect(setOutputMock).toHaveBeenCalledWith('exit-code', 0)
    expect(setFailedMock).not.toHaveBeenCalled()
  })

  it('passes additional-args to the CLI', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'server':
          return 'https://example.com'
        case 'client-id':
          return 'my-client-id'
        case 'secret':
          return 'my-secret'
        case 'command':
          return 'usync-import'
        case 'additional-args':
          return '--force'
        default:
          return ''
      }
    })

    await main.run()

    expect(execMock).toHaveBeenCalledWith(
      'uSync',
      [
        'usync-import',
        '-s',
        'https://example.com',
        '-k',
        'my-client-id',
        '--secret',
        'my-secret',
        '--force'
      ],
      expect.objectContaining({ ignoreReturnCode: true })
    )
  })

  it('calls setFailed when the command exits with a non-zero code', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'server':
          return 'https://example.com'
        case 'client-id':
          return 'my-client-id'
        case 'secret':
          return 'my-secret'
        case 'command':
          return 'usync-import'
        case 'additional-args':
          return ''
        default:
          return ''
      }
    })
    // First call: uSync --version check (already installed → 0)
    // Second call: uSync usync-import (fails → 1)
    execMock
      .mockResolvedValueOnce(0) // version check
      .mockResolvedValueOnce(1) // command execution

    await main.run()

    expect(setOutputMock).toHaveBeenCalledWith('success', false)
    expect(setFailedMock).toHaveBeenCalledWith(
      expect.stringContaining('usync-import')
    )
  })

  it('calls setFailed when required inputs are missing', async () => {
    getInputMock.mockImplementation(
      (name: string, options?: core.InputOptions) => {
        if (options?.required) {
          throw new Error(`Input required and not supplied: ${name}`)
        }
        return ''
      }
    )

    await main.run()

    expect(setFailedMock).toHaveBeenCalled()
  })
})
