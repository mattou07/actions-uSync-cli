import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ApiError } from '../../src/api/http.js'
import type { CheckConnectionsData } from '../../src/stages/check-connections.js'
import type { RebuildIndexesData } from '../../src/stages/rebuild-indexes.js'
import {
  CURRENT_SERVER,
  LIVE_SERVER,
  STAGING_SERVER
} from '../fixtures/publisher-responses.js'
import { makeContext } from '../fixtures/stage-context.js'

const core = {
  info: jest.fn<(m: string) => void>(),
  warning: jest.fn<(m: string) => void>()
}
const sleep = jest.fn<(ms: number) => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../../src/utils/sleep.js', () => ({ sleep }))

const { rebuildCacheStage } = await import('../../src/stages/rebuild-cache.js')
const { rebuildIndexesStage } =
  await import('../../src/stages/rebuild-indexes.js')
const { checkConnectionsStage } =
  await import('../../src/stages/check-connections.js')
const { STAGES } = await import('../../src/stages/index.js')

let now = 0
beforeEach(() => {
  jest.resetAllMocks()
  now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  sleep.mockImplementation(async (ms) => {
    now += ms
  })
})

const apiError = (status: number) =>
  new ApiError(`failed: ${status}`, status, 'POST', 'x', '')

describe('STAGES', () => {
  it('lists the stages in pipeline order', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'connect',
      'import',
      'report',
      'rebuild-cache',
      'rebuild-indexes',
      'export',
      'check-connections'
    ])
  })
})

describe('rebuildCacheStage', () => {
  it('is enabled by the rebuild-cache input', () => {
    const { ctx } = makeContext()
    expect(
      rebuildCacheStage.enabled({ ...ctx.inputs, rebuildCache: true })
    ).toBe(true)
    expect(
      rebuildCacheStage.enabled({ ...ctx.inputs, rebuildCache: false })
    ).toBe(false)
  })

  it('requests the rebuild and polls with a ramped delay until it is done', async () => {
    const t = makeContext()
    t.umbraco.rebuildPublishedCache.mockResolvedValue()
    t.umbraco.getPublishedCacheRebuildStatus
      .mockResolvedValueOnce({ isRebuilding: true })
      .mockResolvedValueOnce({ isRebuilding: true })
      .mockResolvedValueOnce({ isRebuilding: true })
      .mockResolvedValueOnce({ isRebuilding: true })
      .mockResolvedValueOnce({ isRebuilding: false })

    const outcome = await rebuildCacheStage.run(t.ctx)

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([
      2000, 3000, 4500, 6750, 10000
    ])
    expect(outcome.status).toBe('success')
    expect(outcome.summary).toBe('Published cache rebuilt in 26s')
    expect(outcome.data).toEqual({ durationMs: 26250 })
  })

  it('fails when the rebuild does not finish before the deadline', async () => {
    const t = makeContext({ timeoutMinutes: 1 })
    t.umbraco.rebuildPublishedCache.mockResolvedValue()
    t.umbraco.getPublishedCacheRebuildStatus.mockResolvedValue({
      isRebuilding: true
    })
    await expect(rebuildCacheStage.run(t.ctx)).rejects.toThrow(
      'did not finish within 1m 00s'
    )
  })
})

describe('rebuildIndexesStage', () => {
  it('is enabled when index names are given', () => {
    const { ctx } = makeContext()
    expect(
      rebuildIndexesStage.enabled({ ...ctx.inputs, rebuildIndexes: [] })
    ).toBe(false)
    expect(
      rebuildIndexesStage.enabled({ ...ctx.inputs, rebuildIndexes: ['A'] })
    ).toBe(true)
  })

  it('succeeds when every rebuild is requested', async () => {
    const t = makeContext({
      rebuildIndexes: ['ExternalIndex', 'InternalIndex']
    })
    t.umbraco.rebuildIndex.mockResolvedValue()
    const outcome = await rebuildIndexesStage.run(t.ctx)
    expect(outcome.status).toBe('success')
    expect(outcome.summary).toBe('Rebuild requested for 2 of 2 indexes')
    expect(t.umbraco.rebuildIndex.mock.calls).toEqual([
      ['ExternalIndex'],
      ['InternalIndex']
    ])
  })

  it('warns about a missing index', async () => {
    const t = makeContext({ rebuildIndexes: ['Missing', 'ExternalIndex'] })
    t.umbraco.rebuildIndex
      .mockRejectedValueOnce(apiError(404))
      .mockResolvedValueOnce()
    const outcome = await rebuildIndexesStage.run(t.ctx)
    expect(outcome.status).toBe('warning')
    expect(outcome.summary).toBe(
      'Rebuild requested for 1 of 2 indexes, 1 not found'
    )
    expect((outcome.data as RebuildIndexesData).indexes[0].status).toBe(
      'not-found'
    )
  })

  it('fails when a rebuild errors, whatever the error type', async () => {
    const t = makeContext({ rebuildIndexes: ['A', 'B', 'C'] })
    t.umbraco.rebuildIndex
      .mockRejectedValueOnce(apiError(500))
      .mockRejectedValueOnce('plain string')
      .mockRejectedValueOnce(apiError(404))
    const outcome = await rebuildIndexesStage.run(t.ctx)
    expect(outcome.status).toBe('failed')
    expect(outcome.summary).toBe(
      'Rebuild requested for 0 of 3 indexes, 1 not found, 2 failed'
    )
    expect((outcome.data as RebuildIndexesData).indexes).toEqual([
      { name: 'A', status: 'failed', error: 'failed: 500' },
      { name: 'B', status: 'failed', error: 'plain string' },
      { name: 'C', status: 'not-found' }
    ])
  })
})

describe('checkConnectionsStage', () => {
  it('is enabled by the check-connections input', () => {
    const { ctx } = makeContext()
    expect(
      checkConnectionsStage.enabled({ ...ctx.inputs, checkConnections: false })
    ).toBe(false)
    expect(
      checkConnectionsStage.enabled({ ...ctx.inputs, checkConnections: true })
    ).toBe(true)
  })

  it('is skipped when the Publisher is not installed', async () => {
    const t = makeContext()
    t.publisher.getAllServers.mockResolvedValue(undefined)
    const outcome = await checkConnectionsStage.run(t.ctx)
    expect(outcome.status).toBe('skipped')
    expect(outcome.summary).toContain('not installed')
    expect(t.publisher.getCurrentServer).not.toHaveBeenCalled()
  })

  it('is skipped when only the current server is configured', async () => {
    const t = makeContext()
    t.publisher.getAllServers.mockResolvedValue([CURRENT_SERVER])
    t.publisher.getCurrentServer.mockResolvedValue({ ...CURRENT_SERVER })
    const outcome = await checkConnectionsStage.run(t.ctx)
    expect(outcome).toEqual({
      status: 'skipped',
      summary: 'No Publisher servers configured'
    })
  })

  it('also drops the current server when only the alias matches', async () => {
    const t = makeContext()
    t.publisher.getAllServers.mockResolvedValue([
      { ...CURRENT_SERVER, key: 'other' },
      STAGING_SERVER
    ])
    t.publisher.getCurrentServer.mockResolvedValue(CURRENT_SERVER)
    t.publisher.checkServer.mockResolvedValue({
      enabled: true,
      status: 'Success'
    })
    const outcome = await checkConnectionsStage.run(t.ctx)
    expect(t.publisher.checkServer).toHaveBeenCalledTimes(1)
    expect(t.publisher.checkServer).toHaveBeenCalledWith('staging')
    expect(outcome.status).toBe('success')
  })

  it('succeeds when every server reports Success (no current server)', async () => {
    const t = makeContext()
    t.publisher.getAllServers.mockResolvedValue([STAGING_SERVER, LIVE_SERVER])
    t.publisher.getCurrentServer.mockResolvedValue(undefined)
    t.publisher.checkServer.mockResolvedValue({
      enabled: true,
      status: 'Success',
      message: null
    })
    const outcome = await checkConnectionsStage.run(t.ctx)
    expect(outcome.status).toBe('success')
    expect(outcome.summary).toBe('2 of 2 servers reported Success')
    expect((outcome.data as CheckConnectionsData).servers[0]).toEqual({
      alias: 'staging',
      name: 'Staging',
      url: 'https://staging.example.com',
      enabled: true,
      status: 'Success',
      message: undefined,
      healthy: true
    })
  })

  it('warns on unhealthy servers and turns thrown errors into an Error status', async () => {
    const t = makeContext()
    t.publisher.getAllServers.mockResolvedValue([STAGING_SERVER, LIVE_SERVER])
    t.publisher.getCurrentServer.mockResolvedValue(undefined)
    t.publisher.checkServer
      .mockResolvedValueOnce({
        enabled: true,
        status: 'Unauthorized',
        message: 'Bad key'
      })
      .mockRejectedValueOnce(new Error('timed out'))
    const outcome = await checkConnectionsStage.run(t.ctx)
    expect(outcome.status).toBe('warning')
    expect(outcome.summary).toBe('0 of 2 servers reported Success')
    expect((outcome.data as CheckConnectionsData).servers).toMatchObject([
      { status: 'Unauthorized', message: 'Bad key', healthy: false },
      { status: 'Error', message: 'timed out', healthy: false }
    ])
    expect(core.warning).toHaveBeenCalledTimes(2)
  })

  it('fails on unhealthy servers with fail-on-connection-error', async () => {
    const t = makeContext({ failOnConnectionError: true })
    t.publisher.getAllServers.mockResolvedValue([STAGING_SERVER])
    t.publisher.getCurrentServer.mockResolvedValue(undefined)
    t.publisher.checkServer.mockResolvedValue({
      enabled: false,
      status: 'Disabled'
    })
    expect((await checkConnectionsStage.run(t.ctx)).status).toBe('failed')
  })
})
