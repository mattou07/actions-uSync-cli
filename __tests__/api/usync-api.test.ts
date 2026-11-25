import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { USyncApi } from '../../src/api/usync-api.js'
import { ApiError } from '../../src/api/http.js'
import type { HttpClient } from '../../src/api/http.js'
import type { PerformActionRequest } from '../../src/types/usync.js'

const get = jest.fn<(path: string, options?: unknown) => Promise<unknown>>()
const post = jest.fn<(path: string, options?: unknown) => Promise<unknown>>()
const api = new USyncApi({ get, post } as unknown as HttpClient)

const notFound = (): ApiError => new ApiError('nf', 404, 'GET', 'p', '')
const serverError = (): ApiError => new ApiError('boom', 500, 'GET', 'p', '')

beforeEach(() => {
  jest.clearAllMocks()
  get.mockReset()
  post.mockReset()
})

describe('USyncApi.perform', () => {
  it('posts the request as JSON and only retries rate limits', async () => {
    const request = {
      requestId: '',
      action: 'Import',
      stepNumber: 0,
      options: {
        clientId: '',
        force: false,
        clean: false,
        files: false,
        group: 'all',
        set: ''
      }
    } as PerformActionRequest
    post.mockResolvedValueOnce({ complete: false })

    expect(await api.perform(request)).toEqual({ complete: false })
    expect(post).toHaveBeenCalledWith('umbraco/usync/api/v1/Perform', {
      json: request,
      retry: 'rate-limit-only'
    })
  })
})

describe('USyncApi endpoints that may not exist', () => {
  const cases: Array<[string, () => Promise<unknown>, string, unknown]> = [
    [
      'getOperationStatus',
      () => api.getOperationStatus('op-1'),
      'Status',
      { query: { operationId: 'op-1' } }
    ],
    ['getRunning', () => api.getRunning(), 'Running', undefined],
    [
      'getStartupStatus',
      () => api.getStartupStatus(),
      'StartupStatus',
      undefined
    ],
    ['getSets', () => api.getSets(), 'Sets', undefined],
    ['checkLegacy', () => api.checkLegacy(), 'CheckLegacy', undefined]
  ]

  it.each(cases)('%s returns the response', async (_n, call, path, options) => {
    get.mockResolvedValueOnce({ some: 'value' })

    expect(await call()).toEqual({ some: 'value' })
    const expected: unknown[] = [`umbraco/usync/api/v1/${path}`]
    if (options) expected.push(options)
    expect(get.mock.calls[0]).toEqual(expected)
  })

  it.each(cases)('%s returns undefined on 404', async (_n, call) => {
    get.mockRejectedValueOnce(notFound())

    expect(await call()).toBeUndefined()
  })

  it.each(cases)('%s rethrows other errors', async (_n, call) => {
    get.mockRejectedValueOnce(serverError())

    await expect(call()).rejects.toMatchObject({ status: 500 })
  })
})

describe('USyncApi.getSettings', () => {
  it('returns settings and propagates 404 as an error', async () => {
    get.mockResolvedValueOnce({ defaultSet: 'Default' })
    expect(await api.getSettings()).toEqual({ defaultSet: 'Default' })
    expect(get).toHaveBeenCalledWith('umbraco/usync/api/v1/Settings')

    get.mockRejectedValueOnce(notFound())
    await expect(api.getSettings()).rejects.toMatchObject({ status: 404 })
  })
})

describe('USyncApi.getVersion', () => {
  it('returns the add-on version', async () => {
    get.mockResolvedValueOnce({ version: '17.6.3' })

    expect(await api.getVersion()).toBe('17.6.3')
    expect(get).toHaveBeenCalledWith('umbraco/usync/api/v1/AddOns')
  })

  it('returns undefined on 404, an empty body or a missing version', async () => {
    get.mockRejectedValueOnce(notFound())
    expect(await api.getVersion()).toBeUndefined()

    get.mockResolvedValueOnce(undefined)
    expect(await api.getVersion()).toBeUndefined()

    get.mockResolvedValueOnce({})
    expect(await api.getVersion()).toBeUndefined()
  })

  it('rethrows other errors', async () => {
    get.mockRejectedValueOnce(serverError())
    await expect(api.getVersion()).rejects.toMatchObject({ status: 500 })
  })
})

describe('USyncApi.download', () => {
  it('posts and asks for a binary response', async () => {
    const zip = Buffer.from([80, 75, 3, 4])
    post.mockResolvedValueOnce(zip)

    expect(await api.download()).toBe(zip)
    expect(post).toHaveBeenCalledWith('umbraco/usync/api/v1/Download', {
      responseType: 'binary'
    })
  })
})
