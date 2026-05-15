import * as core from '@actions/core'
import { ping } from '../src/lib/ping'

// Suppress core.info output during tests
jest.spyOn(core, 'info').mockImplementation()

describe('ping', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('resolves immediately when the first attempt succeeds', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok' })
    })

    await expect(
      ping('https://example.com', 'id', 'secret', 3, 0)
    ).resolves.toBeUndefined()

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('resolves after a retry when an earlier attempt fails', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Unavailable'
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok' })
      })

    await expect(
      ping('https://example.com', 'id', 'secret', 3, 0)
    ).resolves.toBeUndefined()

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting all retries', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Unavailable'
    })

    await expect(
      ping('https://example.com', 'id', 'secret', 3, 0)
    ).rejects.toThrow('did not respond after 3 attempts')

    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('does not wait after the final failed attempt', async () => {
    // retryDelayMs = 0 means no real delay; just confirm it doesn't hang
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    })

    await expect(
      ping('https://example.com', 'id', 'secret', 2, 0)
    ).rejects.toThrow()

    // 2 attempts, delay only between attempts (not after last one)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
