import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const core = { setSecret: jest.fn(), info: jest.fn() }
jest.unstable_mockModule('@actions/core', () => core)

const { ApiError } = await import('../../src/api/http.js')
const { TokenProvider, TOKEN_PATH } =
  await import('../../src/api/token-provider.js')
type HttpClient = import('../../src/api/http.js').HttpClient

const post = jest.fn<(path: string, options?: unknown) => Promise<unknown>>()
const http = { post } as unknown as HttpClient

let clock = 1_000_000
const now = (): number => clock

function make(): InstanceType<typeof TokenProvider> {
  return new TokenProvider(http, 'umbraco-back-office-test', 'the-secret', now)
}

beforeEach(() => {
  jest.clearAllMocks()
  post.mockReset()
  clock = 1_000_000
})

describe('TokenProvider', () => {
  it('requests a client_credentials token without auth and registers it as a secret', async () => {
    post.mockResolvedValueOnce({ access_token: 'abc', expires_in: 3600 })

    expect(await make().getToken()).toBe('abc')

    expect(post).toHaveBeenCalledWith(TOKEN_PATH, {
      auth: false,
      retry: 'transient',
      form: {
        grant_type: 'client_credentials',
        client_id: 'umbraco-back-office-test',
        client_secret: 'the-secret'
      }
    })
    expect(TOKEN_PATH).toBe(
      'umbraco/management/api/v1/security/back-office/token'
    )
    expect(core.setSecret).toHaveBeenCalledWith('abc')
  })

  it('caches the token until 60 seconds before it expires', async () => {
    post.mockResolvedValueOnce({ access_token: 'one', expires_in: 300 })
    post.mockResolvedValueOnce({ access_token: 'two', expires_in: 300 })
    const provider = make()

    expect(await provider.getToken()).toBe('one')
    clock += 239_000
    expect(await provider.getToken()).toBe('one')
    expect(post).toHaveBeenCalledTimes(1)

    clock += 1_000
    expect(await provider.getToken()).toBe('two')
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('defaults expires_in to 300 seconds', async () => {
    post.mockResolvedValueOnce({ access_token: 'one' })
    post.mockResolvedValueOnce({ access_token: 'two' })
    const provider = make()

    await provider.getToken()
    clock += 239_000
    expect(await provider.getToken()).toBe('one')
    clock += 1_000
    expect(await provider.getToken()).toBe('two')
  })

  it('shares one in-flight request between concurrent callers', async () => {
    let resolve!: (value: unknown) => void
    post.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const provider = make()

    const a = provider.getToken()
    const b = provider.getToken()
    resolve({ access_token: 'shared', expires_in: 300 })

    expect(await Promise.all([a, b])).toEqual(['shared', 'shared'])
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('invalidate forces a new token request', async () => {
    post.mockResolvedValueOnce({ access_token: 'one', expires_in: 300 })
    post.mockResolvedValueOnce({ access_token: 'two', expires_in: 300 })
    const provider = make()

    await provider.getToken()
    provider.invalidate()
    expect(await provider.getToken()).toBe('two')
  })

  it('allows a new request after a failure (in-flight state is cleared)', async () => {
    post.mockRejectedValueOnce(new Error('network down'))
    post.mockResolvedValueOnce({ access_token: 'ok', expires_in: 300 })
    const provider = make()

    await expect(provider.getToken()).rejects.toThrow('network down')
    expect(await provider.getToken()).toBe('ok')
  })

  it.each([400, 401])(
    'maps a %d from the token endpoint to a credentials error',
    async (status) => {
      post.mockRejectedValueOnce(
        new ApiError(
          'm',
          status,
          'POST',
          TOKEN_PATH,
          '{"error":"invalid_client","error_description":"The client credentials are invalid."}'
        )
      )

      await expect(make().getToken()).rejects.toThrow(
        'Umbraco rejected the API user credentials (invalid_client: The client credentials are invalid.). Check client-id / client-secret and that the API user exists on this site.'
      )
      expect(core.setSecret).not.toHaveBeenCalled()
    }
  )

  it('rethrows other ApiErrors unchanged', async () => {
    const error = new ApiError('boom', 500, 'POST', TOKEN_PATH, '')
    post.mockRejectedValueOnce(error)

    await expect(make().getToken()).rejects.toBe(error)
  })

  it.each([undefined, {}, { access_token: '' }])(
    'throws when the response has no access_token (%j)',
    async (response) => {
      post.mockResolvedValueOnce(response)

      await expect(make().getToken()).rejects.toThrow(
        'did not return an access_token'
      )
    }
  )

  it('uses Date.now by default', async () => {
    post.mockResolvedValueOnce({ access_token: 'one', expires_in: 300 })
    const provider = new TokenProvider(http, 'umbraco-back-office-test', 's')

    expect(await provider.getToken()).toBe('one')
    expect(await provider.getToken()).toBe('one')
    expect(post).toHaveBeenCalledTimes(1)
  })
})
