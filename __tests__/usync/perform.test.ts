import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { PerformApi, PerformOptions } from '../../src/usync/perform.js'
import type {
  PerformAction,
  PerformActionResponse,
  SyncHandlerSummary
} from '../../src/types/usync.js'
import {
  ALREADY_RUNNING_RESPONSE,
  BACKGROUND_OPERATION_ID,
  BACKGROUND_START_RESPONSE,
  BACKGROUND_STATUS_ENQUEUED,
  BACKGROUND_STATUS_FAILED,
  BACKGROUND_STATUS_RUNNING,
  BACKGROUND_STATUS_STALE,
  BACKGROUND_STATUS_SUCCESS,
  EXPORT_RESPONSE,
  IMPORT_REQUEST_ID,
  IMPORT_STEP_RESPONSES,
  REPORT_RESPONSE
} from '../fixtures/usync-responses.js'

const info = jest.fn<(message: string) => void>()
const sleep = jest.fn<(ms: number) => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => ({ info }))
jest.unstable_mockModule('../../src/utils/sleep.js', () => ({ sleep }))

const { runPerform, USyncBusyError } =
  await import('../../src/usync/perform.js')

let now = 1_000_000

const api = {
  perform: jest.fn<PerformApi['perform']>(),
  getOperationStatus: jest.fn<PerformApi['getOperationStatus']>(),
  getRunning: jest.fn<PerformApi['getRunning']>()
}

const options = (overrides: Partial<PerformOptions> = {}): PerformOptions => ({
  action: 'Import',
  set: 'Default',
  group: 'all',
  force: false,
  clean: false,
  timeoutMs: 600_000,
  ...overrides
})

const body = (
  stepNumber: number,
  requestId: string,
  action: PerformAction = 'Import',
  overrides: Record<string, unknown> = {}
) => ({
  requestId,
  action,
  stepNumber,
  options: {
    clientId: '',
    force: false,
    clean: false,
    files: false,
    group: 'all',
    set: 'Default',
    ...overrides
  }
})

const logged = () => info.mock.calls.map((c) => c[0])

beforeEach(() => {
  jest.resetAllMocks()
  now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  sleep.mockImplementation(async (ms) => {
    now += ms
  })
})

describe('runPerform normal mode', () => {
  it('steps until complete, handing the requestId back each time', async () => {
    for (const r of IMPORT_STEP_RESPONSES) api.perform.mockResolvedValueOnce(r)

    const result = await runPerform(api, options({ force: true, clean: true }))

    expect(api.perform.mock.calls.map((c) => c[0])).toEqual([
      body(0, '', 'Import', { force: true, clean: true }),
      body(1, IMPORT_REQUEST_ID, 'Import', { force: true, clean: true }),
      body(2, IMPORT_REQUEST_ID, 'Import', { force: true, clean: true })
    ])
    const last = IMPORT_STEP_RESPONSES[2]
    expect(result).toEqual({
      action: 'Import',
      mode: 'normal',
      requestId: IMPORT_REQUEST_ID,
      succeeded: true,
      status: last.status,
      actions: last.actions,
      message: undefined,
      steps: 3,
      durationMs: 0
    })
    expect(api.getOperationStatus).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('logs each handler once as it completes or errors', async () => {
    for (const r of IMPORT_STEP_RESPONSES) api.perform.mockResolvedValueOnce(r)
    await runPerform(api, options())
    expect(logged()).toEqual([
      '  Data Types: complete (1 changes)',
      '  Content Types: complete (1 changes)',
      '  Templates: finished with errors (0 changes)'
    ])
  })

  it('does not log pending or processing handlers', async () => {
    api.perform.mockResolvedValueOnce({
      requestId: 'r',
      complete: true,
      status: [
        { name: 'A', status: 'Pending', changes: 0, inError: false },
        { name: 'B', status: 'Processing', changes: 0, inError: false }
      ],
      actions: []
    })
    await runPerform(api, options())
    expect(info).not.toHaveBeenCalled()
  })

  it('neutralises workflow commands in handler names', async () => {
    const status: SyncHandlerSummary[] = [
      { name: '::warning::x', status: 'Complete', changes: 1, inError: false }
    ]
    api.perform.mockResolvedValueOnce({
      requestId: 'r',
      complete: true,
      status,
      actions: []
    })
    await runPerform(api, options())
    expect(logged()[0]).toBe('  :​:warning::x: complete (1 changes)')
  })

  it('runs Report and Export with their own action', async () => {
    api.perform.mockResolvedValueOnce(REPORT_RESPONSE)
    const report = await runPerform(api, options({ action: 'Report' }))
    expect(report.action).toBe('Report')
    expect(report.actions).toBe(REPORT_RESPONSE.actions)
    expect(api.perform.mock.calls[0][0].action).toBe('Report')

    api.perform.mockResolvedValueOnce(EXPORT_RESPONSE)
    const exported = await runPerform(api, options({ action: 'Export' }))
    expect(exported.action).toBe('Export')
    expect(exported.steps).toBe(1)
  })

  it('uses empty arrays when the final response has no status or actions', async () => {
    api.perform.mockResolvedValueOnce({
      requestId: 'r',
      complete: true,
      status: null,
      actions: null
    })
    const result = await runPerform(api, options())
    expect(result.status).toEqual([])
    expect(result.actions).toEqual([])
  })

  it('passes through an abort message when there are actions', async () => {
    api.perform.mockResolvedValueOnce({
      requestId: 'r',
      complete: true,
      message: 'Aborted by handler',
      actions: [IMPORT_STEP_RESPONSES[0].actions![0]]
    })
    const result = await runPerform(api, options())
    expect(result.message).toBe('Aborted by handler')
    expect(result.succeeded).toBe(true)
  })

  it('does not treat a message on a background response as busy', async () => {
    api.perform.mockResolvedValueOnce({
      requestId: 'r',
      complete: true,
      inBackground: true,
      message: 'ok',
      actions: []
    })
    const result = await runPerform(api, options())
    expect(result.mode).toBe('normal')
    expect(result.message).toBe('ok')
    expect(api.getRunning).not.toHaveBeenCalled()
  })

  it('reports the elapsed time', async () => {
    api.perform.mockImplementationOnce(async () => {
      now += 4500
      return REPORT_RESPONSE
    })
    const result = await runPerform(api, options({ action: 'Report' }))
    expect(result.durationMs).toBe(4500)
  })

  it('throws when the deadline passes between steps', async () => {
    api.perform.mockImplementation(async () => {
      now += 5000
      return IMPORT_STEP_RESPONSES[0]
    })
    await expect(runPerform(api, options({ timeoutMs: 8000 }))).rejects.toThrow(
      'uSync Import run did not finish within 8s'
    )
    expect(api.perform).toHaveBeenCalledTimes(2)
  })

  it('throws when maxSteps is exceeded', async () => {
    api.perform.mockResolvedValue(IMPORT_STEP_RESPONSES[0])
    await expect(runPerform(api, options({ maxSteps: 3 }))).rejects.toThrow(
      'uSync Import exceeded 3 steps without completing'
    )
    expect(api.perform).toHaveBeenCalledTimes(3)
  })

  it('applies a default step cap of 200', async () => {
    api.perform.mockResolvedValue(IMPORT_STEP_RESPONSES[0])
    await expect(runPerform(api, options())).rejects.toThrow(
      'exceeded 200 steps'
    )
    expect(api.perform).toHaveBeenCalledTimes(200)
  })

  it('propagates api errors', async () => {
    api.perform.mockRejectedValueOnce(new Error('boom'))
    await expect(runPerform(api, options())).rejects.toThrow('boom')
  })
})

describe('runPerform background mode', () => {
  it('polls Status with a growing interval until Success', async () => {
    api.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    api.getOperationStatus
      .mockResolvedValueOnce(BACKGROUND_STATUS_ENQUEUED)
      .mockResolvedValueOnce(BACKGROUND_STATUS_RUNNING)
      .mockResolvedValueOnce(BACKGROUND_STATUS_SUCCESS)

    const result = await runPerform(api, options())

    expect(api.perform).toHaveBeenCalledTimes(1)
    expect(api.perform).toHaveBeenCalledWith(body(0, ''))
    expect(api.getOperationStatus.mock.calls).toEqual([
      [BACKGROUND_OPERATION_ID],
      [BACKGROUND_OPERATION_ID],
      [BACKGROUND_OPERATION_ID]
    ])
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 3000, 4500])
    expect(result).toEqual({
      action: 'Import',
      mode: 'background',
      requestId: IMPORT_REQUEST_ID,
      operationId: BACKGROUND_OPERATION_ID,
      operationStatus: 'Success',
      succeeded: true,
      status: BACKGROUND_STATUS_SUCCESS.status,
      actions: BACKGROUND_STATUS_SUCCESS.actions,
      message: undefined,
      steps: 1,
      durationMs: 9500
    })
    // Data Types is reported by both the Running and the Success poll: once.
    expect(logged()).toEqual([
      'uSync Import is running in the background',
      '  Data Types: complete (1 changes)',
      '  Content Types: complete (1 changes)'
    ])
  })

  it('caps the poll interval at 15 seconds', async () => {
    api.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    api.getOperationStatus
      .mockResolvedValueOnce(BACKGROUND_STATUS_RUNNING)
      .mockResolvedValueOnce(BACKGROUND_STATUS_RUNNING)
      .mockResolvedValueOnce(BACKGROUND_STATUS_RUNNING)
      .mockResolvedValueOnce(BACKGROUND_STATUS_SUCCESS)
    await runPerform(api, options({ pollIntervalMs: 10_000 }))
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([
      10_000, 15_000, 15_000, 15_000
    ])
  })

  it('keeps the earlier status and actions when a poll omits them', async () => {
    api.perform.mockResolvedValueOnce({
      ...BACKGROUND_START_RESPONSE,
      status: IMPORT_STEP_RESPONSES[0].status,
      actions: IMPORT_STEP_RESPONSES[0].actions
    })
    api.getOperationStatus.mockResolvedValueOnce({
      operationId: BACKGROUND_OPERATION_ID,
      operationStatus: 'Success',
      complete: true,
      status: null,
      actions: null,
      message: null
    })
    const result = await runPerform(api, options())
    expect(result.status).toBe(IMPORT_STEP_RESPONSES[0].status)
    expect(result.actions).toBe(IMPORT_STEP_RESPONSES[0].actions)
    expect(result.message).toBeUndefined()
  })

  it('falls back to empty arrays when the start response has none', async () => {
    api.perform.mockResolvedValueOnce({
      requestId: 'r',
      complete: false,
      inBackground: true,
      operationId: 'op'
    })
    api.getOperationStatus.mockResolvedValueOnce({
      operationId: 'op',
      operationStatus: 'Success',
      complete: true
    })
    const result = await runPerform(api, options())
    expect(result.status).toEqual([])
    expect(result.actions).toEqual([])
  })

  it('reports Failed as not succeeded, with the server message', async () => {
    api.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    api.getOperationStatus.mockResolvedValueOnce(BACKGROUND_STATUS_FAILED)
    const result = await runPerform(api, options())
    expect(result.succeeded).toBe(false)
    expect(result.operationStatus).toBe('Failed')
    expect(result.message).toBe('The operation failed')
    expect(logged()).toContain('  Templates: finished with errors (0 changes)')
  })

  it('reports Stale as not succeeded', async () => {
    api.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    api.getOperationStatus.mockResolvedValueOnce(BACKGROUND_STATUS_STALE)
    const result = await runPerform(api, options())
    expect(result.succeeded).toBe(false)
    expect(result.operationStatus).toBe('Stale')
    expect(result.message).toBe('The operation stopped reporting progress')
  })

  it('throws when the server cannot report operation status', async () => {
    api.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    api.getOperationStatus.mockResolvedValueOnce(undefined)
    await expect(runPerform(api, options())).rejects.toThrow(
      'does not expose the Status endpoint'
    )
  })

  it('throws when the deadline passes while polling', async () => {
    api.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    api.getOperationStatus.mockResolvedValue(BACKGROUND_STATUS_RUNNING)
    await expect(runPerform(api, options({ timeoutMs: 5000 }))).rejects.toThrow(
      'uSync Import background run did not finish within 5s'
    )
    expect(api.getOperationStatus).toHaveBeenCalledTimes(3)
  })
})

describe('runPerform busy handling', () => {
  const busy = (): PerformActionResponse => ALREADY_RUNNING_RESPONSE

  it('waits for the running operation to finish then restarts once', async () => {
    api.perform
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(IMPORT_STEP_RESPONSES[0])
      .mockResolvedValueOnce(IMPORT_STEP_RESPONSES[1])
      .mockResolvedValueOnce(IMPORT_STEP_RESPONSES[2])
    api.getRunning
      .mockResolvedValueOnce({ operationId: 'op-1' })
      .mockResolvedValueOnce({ operationId: 'op-1', requestId: 'req-1' })
      .mockResolvedValueOnce({
        operationId: null,
        requestId: null,
        action: null
      })

    const result = await runPerform(api, options())

    expect(api.getRunning).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 3000])
    expect(api.perform.mock.calls.map((c) => c[0])).toEqual([
      body(0, ''),
      body(0, ''),
      body(1, IMPORT_REQUEST_ID),
      body(2, IMPORT_REQUEST_ID)
    ])
    expect(result.steps).toBe(4)
    expect(result.succeeded).toBe(true)
    expect(logged()[0]).toBe(
      'uSync reports another run is in progress: A Import process is already running...'
    )
  })

  it('throws USyncBusyError when it is busy again after restarting', async () => {
    api.perform.mockResolvedValue(busy())
    api.getRunning.mockResolvedValue({})
    const error = await runPerform(api, options()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(USyncBusyError)
    expect((error as Error).name).toBe('USyncBusyError')
    expect((error as Error).message).toBe(
      'A Import process is already running...'
    )
    expect(api.perform).toHaveBeenCalledTimes(2)
    expect(api.getRunning).toHaveBeenCalledTimes(1)
  })

  it('throws USyncBusyError when Running is unavailable', async () => {
    api.perform.mockResolvedValue(busy())
    api.getRunning.mockResolvedValue(undefined)
    await expect(runPerform(api, options())).rejects.toBeInstanceOf(
      USyncBusyError
    )
    expect(api.perform).toHaveBeenCalledTimes(1)
  })

  it('throws USyncBusyError if Running disappears mid-wait', async () => {
    api.perform.mockResolvedValue(busy())
    api.getRunning
      .mockResolvedValueOnce({ operationId: 'op' })
      .mockResolvedValueOnce(undefined)
    await expect(runPerform(api, options())).rejects.toBeInstanceOf(
      USyncBusyError
    )
  })

  it('caps the interval while waiting for the running operation', async () => {
    api.perform
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(REPORT_RESPONSE)
    api.getRunning
      .mockResolvedValueOnce({ operationId: 'op' })
      .mockResolvedValueOnce({ operationId: 'op' })
      .mockResolvedValueOnce({ operationId: 'op' })
      .mockResolvedValueOnce({})
    await runPerform(api, options({ pollIntervalMs: 12_000 }))
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([12_000, 15_000, 15_000])
  })

  it('throws when the deadline passes while waiting for the running operation', async () => {
    api.perform.mockResolvedValue(busy())
    api.getRunning.mockResolvedValue({ operationId: 'op' })
    await expect(runPerform(api, options({ timeoutMs: 5000 }))).rejects.toThrow(
      'uSync Import wait for the running operation did not finish within 5s'
    )
    expect(api.perform).toHaveBeenCalledTimes(1)
  })
})
