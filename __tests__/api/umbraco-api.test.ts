import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { UmbracoApi } from '../../src/api/umbraco-api.js'
import type { HttpClient } from '../../src/api/http.js'

const get = jest.fn<(path: string, options?: unknown) => Promise<unknown>>()
const post = jest.fn<(path: string, options?: unknown) => Promise<unknown>>()
const api = new UmbracoApi({ get, post } as unknown as HttpClient)

beforeEach(() => {
  jest.clearAllMocks()
})

describe('UmbracoApi', () => {
  it('getServerStatus is anonymous and never retried', async () => {
    get.mockResolvedValueOnce({ serverStatus: 'Run' })

    expect(await api.getServerStatus()).toEqual({ serverStatus: 'Run' })
    expect(get).toHaveBeenCalledWith(
      'umbraco/management/api/v1/server/status',
      { auth: false, retry: 'none' }
    )
  })

  it('getServerInformation is authenticated', async () => {
    get.mockResolvedValueOnce({ version: '17.0.0' })

    expect(await api.getServerInformation()).toEqual({ version: '17.0.0' })
    expect(get).toHaveBeenCalledWith(
      'umbraco/management/api/v1/server/information'
    )
  })

  it('rebuildIndex posts to the encoded index name and ignores the body', async () => {
    post.mockResolvedValueOnce(undefined)

    expect(await api.rebuildIndex('External Index/1')).toBeUndefined()
    expect(post).toHaveBeenCalledWith(
      'umbraco/management/api/v1/indexer/External%20Index%2F1/rebuild',
      { responseType: 'none' }
    )
  })

  it('rebuildPublishedCache posts and ignores the body', async () => {
    post.mockResolvedValueOnce(undefined)

    expect(await api.rebuildPublishedCache()).toBeUndefined()
    expect(post).toHaveBeenCalledWith(
      'umbraco/management/api/v1/published-cache/rebuild',
      { responseType: 'none' }
    )
  })

  it('getPublishedCacheRebuildStatus reads the status', async () => {
    get.mockResolvedValueOnce({ isRebuilding: true })

    expect(await api.getPublishedCacheRebuildStatus()).toEqual({
      isRebuilding: true
    })
    expect(get).toHaveBeenCalledWith(
      'umbraco/management/api/v1/published-cache/rebuild/status'
    )
  })
})
