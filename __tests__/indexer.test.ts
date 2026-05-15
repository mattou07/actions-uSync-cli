import * as core from '@actions/core'
import { rebuildIndexes } from '../src/lib/indexer'

jest.spyOn(core, 'info').mockImplementation()
jest.spyOn(core, 'warning').mockImplementation()

const warnMock = core.warning as jest.Mock

describe('rebuildIndexes', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('POSTs to the correct URL with the Bearer token', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200
    })

    await rebuildIndexes('https://example.com', 'my-token', ['ExternalIndex'])

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/umbraco/management/api/v1/indexer/ExternalIndex/rebuild',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token'
        })
      })
    )
  })

  it('returns "requested" status for each successfully triggered index', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const results = await rebuildIndexes('https://example.com', 'tok', [
      'ExternalIndex',
      'InternalIndex'
    ])

    expect(results).toEqual([
      { name: 'ExternalIndex', status: 'requested' },
      { name: 'InternalIndex', status: 'requested' }
    ])
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns "not-found" and warns instead of throwing when an index returns 404', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    })

    const results = await rebuildIndexes('https://example.com', 'tok', [
      'MissingIndex'
    ])

    expect(results).toEqual([{ name: 'MissingIndex', status: 'not-found' }])
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining('"MissingIndex" was not found')
    )
  })

  it('continues processing remaining indexes when one returns 404', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const results = await rebuildIndexes('https://example.com', 'tok', [
      'MissingIndex',
      'ExternalIndex'
    ])

    expect(results[0]).toMatchObject({
      name: 'MissingIndex',
      status: 'not-found'
    })
    expect(results[1]).toMatchObject({
      name: 'ExternalIndex',
      status: 'requested'
    })
  })

  it('returns "failed" for non-404 error responses', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    })

    const results = await rebuildIndexes('https://example.com', 'tok', [
      'ExternalIndex'
    ])

    expect(results[0]).toMatchObject({
      name: 'ExternalIndex',
      status: 'failed'
    })
    expect(results[0].error).toContain('500')
  })

  it('URL-encodes index names that contain special characters', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200
    })

    await rebuildIndexes('https://example.com', 'tok', ['My Index'])

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toContain('My%20Index')
  })

  it('normalises a bare server hostname before building the URL', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200
    })

    await rebuildIndexes('example.com', 'tok', ['ExternalIndex'])

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toMatch(/^https:\/\/example\.com\//)
  })
})
