import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { PublisherApi } from '../../src/api/publisher-api.js'
import { ApiError } from '../../src/api/http.js'
import type { HttpClient } from '../../src/api/http.js'

const get = jest.fn<(path: string, options?: unknown) => Promise<unknown>>()
const api = new PublisherApi({ get } as unknown as HttpClient)

const notFound = (): ApiError => new ApiError('nf', 404, 'GET', 'p', '')

beforeEach(() => {
  jest.clearAllMocks()
  get.mockReset()
})

describe('PublisherApi', () => {
  it.each([true, false])(
    'getAllServers passes enabledOnly=%s',
    async (flag) => {
      const servers = [{ alias: 'live' }]
      get.mockResolvedValueOnce(servers)

      expect(await api.getAllServers(flag)).toBe(servers)
      expect(get).toHaveBeenCalledWith(
        'umbraco/usync/api/v1/Publisher/GetAllServers',
        { query: { enabledOnly: flag } }
      )
    }
  )

  it('getAllServers returns undefined on 404 and rethrows other errors', async () => {
    get.mockRejectedValueOnce(notFound())
    expect(await api.getAllServers(true)).toBeUndefined()

    get.mockRejectedValueOnce(new ApiError('x', 500, 'GET', 'p', ''))
    await expect(api.getAllServers(true)).rejects.toMatchObject({ status: 500 })
  })

  it('getCurrentServer returns the server, or undefined on 404 or an empty body', async () => {
    get.mockResolvedValueOnce({ alias: 'here' })
    expect(await api.getCurrentServer()).toEqual({ alias: 'here' })
    expect(get).toHaveBeenCalledWith(
      'umbraco/usync/api/v1/Publisher/GetCurrent'
    )

    get.mockRejectedValueOnce(notFound())
    expect(await api.getCurrentServer()).toBeUndefined()

    get.mockResolvedValueOnce(undefined)
    expect(await api.getCurrentServer()).toBeUndefined()
  })

  it('checkServer sends the alias as the server query parameter', async () => {
    get.mockResolvedValueOnce({ enabled: true, status: 'Success' })

    expect(await api.checkServer('live server')).toEqual({
      enabled: true,
      status: 'Success'
    })
    expect(get).toHaveBeenCalledWith(
      'umbraco/usync/api/v1/Publisher/CheckServer',
      { query: { server: 'live server' } }
    )
  })

  it('checkServer propagates errors (including 404)', async () => {
    get.mockRejectedValueOnce(notFound())
    await expect(api.checkServer('x')).rejects.toMatchObject({ status: 404 })
  })
})
