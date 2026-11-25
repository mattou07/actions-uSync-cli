import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ApiError } from '../../src/api/http.js'
import type { ConnectData } from '../../src/stages/connect.js'
import { makeContext } from '../fixtures/stage-context.js'

const core = {
  info: jest.fn<(m: string) => void>(),
  warning: jest.fn<(m: string) => void>(),
  debug: jest.fn<(m: string) => void>()
}
const sleep = jest.fn<(ms: number) => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../../src/utils/sleep.js', () => ({ sleep }))

const { connectStage } = await import('../../src/stages/connect.js')

let now = 0
const apiError = (status: number) =>
  new ApiError(`GET x failed: ${status}`, status, 'GET', 'x', '')

beforeEach(() => {
  jest.resetAllMocks()
  now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  sleep.mockImplementation(async (ms) => {
    now += ms
  })
})

function ready() {
  const t = makeContext()
  t.umbraco.getServerStatus.mockResolvedValue({ serverStatus: 'Run' })
  t.usync.getSettings.mockResolvedValue({
    defaultSet: 'Live',
    processingMode: 'Background'
  })
  t.umbraco.getServerInformation.mockResolvedValue({ version: '17.4.0' })
  t.usync.getVersion.mockResolvedValue('17.5.0')
  t.usync.getStartupStatus.mockResolvedValue({ state: 'NotConfigured' })
  t.usync.getRunning.mockResolvedValue({})
  return t
}

describe('connectStage', () => {
  it('is always enabled, aborts on failure and titles itself by the wait input', () => {
    const { ctx } = makeContext()
    expect(connectStage.enabled(ctx.inputs)).toBe(true)
    expect(connectStage.abortOnFailure).toBe(true)
    expect(connectStage.getTitle?.({ ...ctx.inputs, wait: true })).toBe(
      'Wait for site'
    )
    expect(connectStage.getTitle?.({ ...ctx.inputs, wait: false })).toBe(
      'Connect'
    )
  })

  it('polls through startup problems until the site runs, then reads site info', async () => {
    const t = ready()
    t.umbraco.getServerStatus
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ serverStatus: 'Install' })
      .mockResolvedValueOnce({ serverStatus: 'Boot' })
      .mockResolvedValueOnce({ serverStatus: 'Run' })

    const outcome = await connectStage.run(t.ctx)

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([
      2000, 5000, 10000, 10000
    ])
    expect(outcome.status).toBe('success')
    expect(outcome.summary).toBe(
      'Umbraco 17.4.0 is running; uSync 17.5.0; set Live'
    )
    expect(t.ctx.site).toMatchObject({
      set: 'Live',
      umbracoVersion: '17.4.0',
      usyncVersion: '17.5.0'
    })
    const data = outcome.data as ConnectData
    expect(data).toMatchObject({
      runtimeLevel: 'Run',
      processingMode: 'Background',
      startupImport: { state: 'NotConfigured' }
    })
    expect(data.waitedMs).toBe(27000)
  })

  it('fails immediately when the site cannot boot', async () => {
    const t = ready()
    t.umbraco.getServerStatus.mockResolvedValue({ serverStatus: 'BootFailed' })
    await expect(connectStage.run(t.ctx)).rejects.toThrow('BootFailed')
    expect(t.usync.getSettings).not.toHaveBeenCalled()
  })

  it('does not retry client errors other than 404 and 429 on the status poll', async () => {
    const t = ready()
    t.umbraco.getServerStatus.mockRejectedValue(apiError(400))
    await expect(connectStage.run(t.ctx)).rejects.toThrow('400')
  })

  it('keeps polling on 404 and 429', async () => {
    const t = ready()
    t.umbraco.getServerStatus
      .mockRejectedValueOnce(apiError(404))
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce({ serverStatus: 'Run' })
    const outcome = await connectStage.run(t.ctx)
    expect(outcome.status).toBe('success')
  })

  it('times out naming the last run level seen', async () => {
    const t = ready()
    t.ctx.inputs.waitTimeoutMinutes = 1
    t.umbraco.getServerStatus.mockResolvedValue({ serverStatus: 'Upgrade' })
    await expect(connectStage.run(t.ctx)).rejects.toThrow(
      'Timed out after 1m 00s waiting for the site to reach run level Run (last seen: Upgrade)'
    )
  })

  it('times out reporting an unreachable site', async () => {
    const t = ready()
    t.ctx.inputs.waitTimeoutMinutes = 1
    t.umbraco.getServerStatus.mockRejectedValue(new TypeError('fetch failed'))
    await expect(connectStage.run(t.ctx)).rejects.toThrow(
      'last seen: unreachable'
    )
  })

  it('without wait it skips every polling call', async () => {
    const t = ready()
    t.ctx.inputs.wait = false
    t.ctx.inputs.set = 'Custom'
    t.umbraco.getServerInformation.mockRejectedValue(apiError(500))
    t.usync.getVersion.mockResolvedValue(undefined)

    const outcome = await connectStage.run(t.ctx)

    expect(t.umbraco.getServerStatus).not.toHaveBeenCalled()
    expect(t.usync.getStartupStatus).not.toHaveBeenCalled()
    expect(t.usync.getRunning).not.toHaveBeenCalled()
    expect(outcome.summary).toBe('Umbraco is reachable; set Custom')
    expect(core.debug).toHaveBeenCalled()
    expect((outcome.data as ConnectData).startupImport).toBe('not-checked')
  })

  it('falls back to the Default set', async () => {
    const t = ready()
    t.usync.getSettings.mockResolvedValue({})
    await connectStage.run(t.ctx)
    expect(t.ctx.site.set).toBe('Default')
  })

  it.each([
    [401, 'not authorised'],
    [403, 'needs access'],
    [404, 'not installed']
  ])('maps a %i from Settings to a clear message', async (status, text) => {
    const t = ready()
    t.usync.getSettings.mockRejectedValue(apiError(status))
    await expect(connectStage.run(t.ctx)).rejects.toThrow(text)
  })

  it('rethrows other Settings errors', async () => {
    const t = ready()
    t.usync.getSettings.mockRejectedValueOnce(apiError(500))
    await expect(connectStage.run(t.ctx)).rejects.toBeInstanceOf(ApiError)
    t.usync.getSettings.mockRejectedValueOnce(new Error('boom'))
    await expect(connectStage.run(t.ctx)).rejects.toThrow('boom')
  })

  it('treats a missing startup status endpoint as unsupported', async () => {
    const t = ready()
    t.usync.getStartupStatus.mockResolvedValue(undefined)
    const outcome = await connectStage.run(t.ctx)
    expect(outcome.status).toBe('success')
    expect((outcome.data as ConnectData).startupImport).toBe('unsupported')
  })

  it('waits for a running startup import to complete', async () => {
    const t = ready()
    t.usync.getStartupStatus
      .mockResolvedValueOnce({ state: 'Running' })
      .mockResolvedValueOnce({ state: 'Running' })
      .mockResolvedValueOnce({ state: 'Completed' })
    const outcome = await connectStage.run(t.ctx)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe('success')
  })

  it.each(['CompletedWithErrors', 'Failed', 'Blocked'])(
    'warns when the startup import ended as %s',
    async (state) => {
      const t = ready()
      t.usync.getStartupStatus.mockResolvedValue({ state })
      const outcome = await connectStage.run(t.ctx)
      expect(outcome.status).toBe('warning')
      expect(outcome.summary).toContain(state)
    }
  )

  it('warns about a stale startup import without waiting for it', async () => {
    const t = ready()
    t.usync.getStartupStatus.mockResolvedValue({
      state: 'Running',
      isStale: true
    })
    const outcome = await connectStage.run(t.ctx)
    expect(sleep).not.toHaveBeenCalled()
    expect(outcome.status).toBe('warning')
    expect(outcome.summary).toContain('stale')
  })

  it('times out waiting for the startup import', async () => {
    const t = ready()
    t.ctx.inputs.waitTimeoutMinutes = 1
    t.usync.getStartupStatus.mockResolvedValue({ state: 'Running' })
    await expect(connectStage.run(t.ctx)).rejects.toThrow('startup import')
  })

  it('skips the startup check when wait-for-startup-import is off', async () => {
    const t = ready()
    t.ctx.inputs.waitForStartupImport = false
    await connectStage.run(t.ctx)
    expect(t.usync.getStartupStatus).not.toHaveBeenCalled()
  })

  it('waits for another uSync operation to finish', async () => {
    const t = ready()
    t.usync.getRunning
      .mockResolvedValueOnce({ operationId: 'op-1', action: 'Import' })
      .mockResolvedValueOnce({})
    await connectStage.run(t.ctx)
    expect(t.usync.getRunning).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('times out waiting for another uSync operation', async () => {
    const t = ready()
    t.ctx.inputs.waitTimeoutMinutes = 1
    t.usync.getRunning.mockResolvedValue({ operationId: 'op-1' })
    await expect(connectStage.run(t.ctx)).rejects.toThrow(
      'running uSync operation'
    )
  })
})
