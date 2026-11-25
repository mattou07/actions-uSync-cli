import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const core = { info: jest.fn(), warning: jest.fn(), debug: jest.fn() }
jest.unstable_mockModule('@actions/core', () => core)

const sleep = jest.fn<(ms: number) => Promise<void>>(() => Promise.resolve())
jest.unstable_mockModule('../../src/utils/sleep.js', () => ({ sleep }))

const {
  ApiError,
  HttpClient,
  isNotFound,
  isRetryableError,
  optional,
  parseErrorBody
} = await import('../../src/api/http.js')
type AuthProvider = import('../../src/api/http.js').AuthProvider

const BASE = 'https://example.com'
const fetchMock = jest.fn<typeof fetch>()
globalThis.fetch = fetchMock

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

function textResponse(
  body: string,
  status: number,
  init: ResponseInit = {}
): Response {
  return new Response(body, { status, ...init })
}

function makeProvider(): AuthProvider & {
  getToken: jest.Mock<() => Promise<string>>
  invalidate: jest.Mock<() => void>
} {
  let n = 0
  return {
    getToken: jest.fn(() => Promise.resolve(`tok-${++n}`)),
    invalidate: jest.fn()
  }
}

function makeClient(
  options: ConstructorParameters<typeof HttpClient>[1] = {}
): {
  client: InstanceType<typeof HttpClient>
  provider: ReturnType<typeof makeProvider>
} {
  const client = new HttpClient(BASE, options)
  const provider = makeProvider()
  client.setAuth(provider)
  return { client, provider }
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url: String(url), init: init as RequestInit }
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>
}

function allLogged(): string {
  return JSON.stringify([
    ...core.info.mock.calls,
    ...core.warning.mock.calls,
    ...core.debug.mock.calls
  ])
}

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock.mockReset()
})

describe('HttpClient requests', () => {
  it('sends an authenticated GET with bearer token, accept header and timeout signal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { client } = makeClient()

    const result = await client.get<{ ok: boolean }>('umbraco/x/y')

    expect(result).toEqual({ ok: true })
    const { url, init } = lastCall()
    expect(url).toBe('https://example.com/umbraco/x/y')
    expect(init.method).toBe('GET')
    expect(headersOf(init).Authorization).toBe('Bearer tok-1')
    expect(headersOf(init).Accept).toBe('application/json')
    expect(init.body).toBeUndefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.redirect).toBe('error')
  })

  it('tolerates a leading slash in the path and a trailing slash on the base url', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const client = new HttpClient('https://example.com/site/')
    client.setAuth(makeProvider())

    expect(client.baseUrl).toBe('https://example.com/site')
    await client.get('/umbraco/x')
    expect(lastCall().url).toBe('https://example.com/site/umbraco/x')
  })

  it('encodes the query string and omits undefined values', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})))
    const { client } = makeClient()

    await client.get('p', {
      query: { a: 'x y&z=1', b: 2, c: true, d: undefined, e: false }
    })

    expect(lastCall().url).toBe(
      'https://example.com/p?a=x+y%26z%3D1&b=2&c=true&e=false'
    )

    await client.get('p', { query: { only: undefined } })
    expect(lastCall().url).toBe('https://example.com/p')
  })

  it('sends a JSON body with a content type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const { client } = makeClient()

    await client.post('p', { json: { a: 1, b: 'two' } })

    const { init } = lastCall()
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1,"b":"two"}')
    expect(headersOf(init)['Content-Type']).toBe('application/json')
  })

  it('sends a form body url-encoded', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const { client } = makeClient()

    await client.post('p', {
      auth: false,
      form: { grant_type: 'client_credentials', client_secret: 'a b&c=d/é' }
    })

    const { init } = lastCall()
    expect(init.body).toBe(
      'grant_type=client_credentials&client_secret=a+b%26c%3Dd%2F%C3%A9'
    )
    expect(headersOf(init)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    )
  })

  it('does not fetch a token or send Authorization when auth is false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const { client, provider } = makeClient()

    await client.get('p', { auth: false })

    expect(provider.getToken).not.toHaveBeenCalled()
    expect(headersOf(lastCall().init).Authorization).toBeUndefined()
  })

  it('fails clearly when an authenticated request has no auth provider', async () => {
    const client = new HttpClient(BASE)
    await expect(client.get('p')).rejects.toThrow('No auth provider configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the configured per-attempt timeout to AbortSignal.timeout', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout')
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const { client } = makeClient({ requestTimeoutMs: 1234 })

    await client.get('p')

    expect(spy).toHaveBeenCalledWith(1234)
    spy.mockRestore()
  })

  it('clamps nonsensical option values', async () => {
    fetchMock.mockResolvedValue(textResponse('', 503))
    const { client } = makeClient({
      maxRetries: -4,
      retryBaseDelayMs: -1,
      requestTimeoutMs: 0
    })

    await expect(client.get('p')).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('HttpClient responses', () => {
  it('returns undefined for an empty or whitespace JSON body', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('', 200))
    fetchMock.mockResolvedValueOnce(textResponse('  \n', 200))
    const { client } = makeClient()

    expect(await client.get('p')).toBeUndefined()
    expect(await client.get('p')).toBeUndefined()
  })

  it('throws a clear error for a non-JSON success body', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('<html>nope</html>', 200))
    const { client } = makeClient()

    await expect(client.get('some/path')).rejects.toThrow(
      'GET some/path returned a response that is not valid JSON'
    )
  })

  it('returns a Buffer for binary responses and does not ask for JSON', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    fetchMock.mockResolvedValueOnce(new Response(bytes, { status: 200 }))
    const { client } = makeClient()

    const result = await client.post<Buffer>('dl', { responseType: 'binary' })

    expect(Buffer.isBuffer(result)).toBe(true)
    expect([...result]).toEqual([0, 1, 2, 250, 255])
    expect(headersOf(lastCall().init).Accept).toBeUndefined()
  })

  it("returns undefined for responseType 'none' with or without a body", async () => {
    fetchMock.mockResolvedValueOnce(textResponse('ignored', 200))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { client } = makeClient()

    expect(await client.post('p', { responseType: 'none' })).toBeUndefined()
    expect(await client.post('p', { responseType: 'none' })).toBeUndefined()
  })
})

describe('HttpClient errors', () => {
  it('throws ApiError with the documented message format and status text', async () => {
    fetchMock.mockResolvedValueOnce(
      textResponse(JSON.stringify({ detail: 'Nope' }), 403, {
        statusText: 'Forbidden'
      })
    )
    const { client } = makeClient()

    const error = (await client.get('a/b').catch((e) => e)) as InstanceType<
      typeof ApiError
    >

    expect(error).toBeInstanceOf(ApiError)
    expect(error.name).toBe('ApiError')
    expect(error.message).toBe('GET a/b failed: 403 Forbidden - Nope')
    expect(error.status).toBe(403)
    expect(error.method).toBe('GET')
    expect(error.path).toBe('a/b')
  })

  it('omits the status text when there is none and handles an empty body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    const { client } = makeClient({ maxRetries: 0 })

    await expect(client.post('a/b')).rejects.toThrow(
      'POST a/b failed: 500 - (empty response body)'
    )
  })

  it('exposes problem details type and title', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { type: 'https://x/y', title: 'Bad thing', detail: 'd' },
        400
      )
    )
    const { client } = makeClient()

    const error = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >
    expect(error.problemType).toBe('https://x/y')
    expect(error.title).toBe('Bad thing')
  })

  it('redacts secrets from the message and body, never leaking the token', async () => {
    fetchMock.mockResolvedValueOnce(
      textResponse(
        '{"error":"x","access_token":"leaky-token-1","client_secret":"leaky-secret-2"} Bearer leaky-bearer-3 refresh_token=leaky-4',
        400
      )
    )
    const { client } = makeClient()

    const error = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >

    for (const leak of [
      'leaky-token-1',
      'leaky-secret-2',
      'leaky-bearer-3',
      'leaky-4',
      'tok-1'
    ]) {
      expect(error.message).not.toContain(leak)
      expect(error.body).not.toContain(leak)
      expect(allLogged()).not.toContain(leak)
    }
    expect(error.body).toContain('[REDACTED]')
  })

  it('caps the error body at 64 KB', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('a'.repeat(100 * 1024), 400))
    const { client } = makeClient()

    const error = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >
    expect(error.body).toHaveLength(64 * 1024)
  })

  it('caps across several stream chunks and reads small chunked bodies fully', async () => {
    const chunked = (parts: string[]): Response => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of parts) controller.enqueue(encoder.encode(part))
            controller.close()
          }
        }),
        { status: 400 }
      )
    }
    fetchMock.mockResolvedValueOnce(
      chunked(['a'.repeat(30000), 'b'.repeat(30000), 'c'.repeat(30000)])
    )
    fetchMock.mockResolvedValueOnce(chunked(['ab', 'cd']))
    const { client } = makeClient()

    const big = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >
    expect(big.body).toHaveLength(64 * 1024)
    expect(big.body.endsWith('c'.repeat(5536))).toBe(true)

    const small = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >
    expect(small.body).toBe('abcd')
  })

  it('reads Retry-After from the header, or from the body text', async () => {
    fetchMock.mockResolvedValueOnce(
      textResponse('', 429, { headers: { 'Retry-After': '12' } })
    )
    fetchMock.mockResolvedValueOnce(
      textResponse('Rate limit. Try again in 7 seconds.', 429)
    )
    fetchMock.mockResolvedValueOnce(
      textResponse('nothing', 429, {
        headers: { 'Retry-After': 'Wed, 21 Oct' }
      })
    )
    const { client } = makeClient({ maxRetries: 0 })

    const a = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >
    const b = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >
    const c = (await client.get('p').catch((e) => e)) as InstanceType<
      typeof ApiError
    >
    expect(a.retryAfterSeconds).toBe(12)
    expect(b.retryAfterSeconds).toBe(7)
    expect(c.retryAfterSeconds).toBeUndefined()
  })
})

describe('HttpClient retries', () => {
  it('retries transient statuses with exponential backoff, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('', 502))
      .mockResolvedValueOnce(textResponse('', 503))
      .mockResolvedValueOnce(textResponse('', 504))
      .mockResolvedValueOnce(jsonResponse({ done: true }))
    const { client } = makeClient()

    expect(await client.get('p')).toEqual({ done: true })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000, 8000])
  })

  it('gives up after maxRetries extra attempts and throws the last error', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(textResponse('', 503)))
    const { client } = makeClient({ maxRetries: 2, retryBaseDelayMs: 10 })

    await expect(client.get('p')).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20])
  })

  it('honours Retry-After (+1s) over the backoff delay', async () => {
    fetchMock
      .mockResolvedValueOnce(
        textResponse('', 429, { headers: { 'Retry-After': '5' } })
      )
      .mockResolvedValueOnce(textResponse('Try again in 9 seconds', 429))
      .mockResolvedValueOnce(jsonResponse({}))
    const { client } = makeClient()

    await client.get('p')
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([6000, 10000])
  })

  it('logs retries without leaking the token or headers', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('', 503))
      .mockResolvedValueOnce(jsonResponse({}))
    const { client } = makeClient()

    await client.get('p')

    const log = allLogged()
    expect(log).toContain('retry 1/3')
    expect(log).toContain('HTTP 503')
    expect(log).not.toContain('tok-')
    expect(log).not.toContain('Bearer')
  })

  it('retries network errors and timeouts under the transient policy', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError')
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }))
    const { client } = makeClient()

    expect(await client.get('p')).toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(allLogged()).toContain('TypeError')
    expect(allLogged()).toContain('TimeoutError')
  })

  it('does not retry client errors', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('', 400))
    const { client } = makeClient()

    await expect(client.get('p')).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry unknown (non network) errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('weird'))
    const { client } = makeClient()

    await expect(client.get('p')).rejects.toThrow('weird')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retry: 'none' never retries", async () => {
    fetchMock.mockResolvedValueOnce(textResponse('', 503))
    const { client } = makeClient()

    await expect(client.get('p', { retry: 'none' })).rejects.toMatchObject({
      status: 503
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retry: 'rate-limit-only' retries 429 but not 503 or timeouts", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('', 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { client } = makeClient()
    expect(await client.post('p', { retry: 'rate-limit-only' })).toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(textResponse('', 503))
    await expect(
      client.post('p', { retry: 'rate-limit-only' })
    ).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockClear()
    fetchMock.mockRejectedValueOnce(new DOMException('t', 'TimeoutError'))
    await expect(
      client.post('p', { retry: 'rate-limit-only' })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('HttpClient 401 handling', () => {
  it('invalidates the token and retries once with a fresh one', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('', 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { client, provider } = makeClient()

    expect(await client.get('p')).toEqual({ ok: true })

    expect(provider.invalidate).toHaveBeenCalledTimes(1)
    expect(provider.getToken).toHaveBeenCalledTimes(2)
    const auths = fetchMock.mock.calls.map(
      ([, init]) => headersOf(init as RequestInit).Authorization
    )
    expect(auths).toEqual(['Bearer tok-1', 'Bearer tok-2'])
    expect(sleep).not.toHaveBeenCalled()
  })

  it('throws when the retried request is rejected again', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(textResponse('', 401)))
    const { client, provider } = makeClient()

    await expect(client.get('p')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(provider.invalidate).toHaveBeenCalledTimes(1)
  })

  it('does not count the refresh against maxRetries', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('', 401))
      .mockResolvedValueOnce(textResponse('', 503))
      .mockResolvedValueOnce(textResponse('', 503))
      .mockResolvedValueOnce(textResponse('', 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { client } = makeClient({ maxRetries: 3 })

    expect(await client.get('p')).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('does not invalidate for unauthenticated requests', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('', 401))
    const { client, provider } = makeClient()

    await expect(client.post('p', { auth: false })).rejects.toMatchObject({
      status: 401
    })
    expect(provider.invalidate).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('parseErrorBody', () => {
  it('uses problem details detail, keeping type and title', () => {
    expect(
      parseErrorBody(
        '{"type":"https://t/x","title":"T","detail":"Detail here"}'
      )
    ).toEqual({
      summary: 'Detail here',
      problemType: 'https://t/x',
      title: 'T'
    })
  })

  it('prefixes a non-URL type code', () => {
    expect(parseErrorBody('{"type":"BadThing","detail":"why"}').summary).toBe(
      'BadThing: why'
    )
  })

  it('falls back through message, oauth, errors and title', () => {
    expect(parseErrorBody('{"message":"m"}').summary).toBe('m')
    expect(
      parseErrorBody(
        '{"error":"invalid_client","error_description":"bad creds"}'
      ).summary
    ).toBe('invalid_client: bad creds')
    expect(parseErrorBody('{"error_description":"only desc"}').summary).toBe(
      'only desc'
    )
    expect(parseErrorBody('{"error":"only_code"}').summary).toBe('only_code')
    expect(
      parseErrorBody(
        '{"errors":{"Name":["too short"," "],"Nested":{"a":"bad"},"n":5},"title":"T"}'
      ).summary
    ).toBe('too short; bad')
    expect(
      parseErrorBody('{"errors":"text","title":"The title"}').summary
    ).toBe('The title')
    expect(parseErrorBody('{"errors":{"a":[]},"title":"T2"}').summary).toBe(
      'T2'
    )
  })

  it('falls back to the raw text when JSON has no usable fields or is invalid', () => {
    expect(parseErrorBody('{"x":1}').summary).toBe('{"x":1}')
    expect(parseErrorBody('{not json').summary).toBe('{not json')
    expect(parseErrorBody('plain\n  text').summary).toBe('plain text')
  })

  it('reports an empty body and truncates long summaries', () => {
    expect(parseErrorBody('  ').summary).toBe('(empty response body)')
    const long = parseErrorBody('x'.repeat(600)).summary
    expect(long).toHaveLength(501)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('error helpers', () => {
  const apiError = (status: number): InstanceType<typeof ApiError> =>
    new ApiError('m', status, 'GET', 'p', '')

  it.each([429, 502, 503, 504])('treats %d as retryable', (status) => {
    expect(isRetryableError(apiError(status))).toBe(true)
  })

  it.each([400, 401, 404, 500, 501])(
    'does not treat %d as retryable',
    (status) => {
      expect(isRetryableError(apiError(status))).toBe(false)
    }
  )

  it('recognises network and timeout errors by name only', () => {
    expect(isRetryableError(new TypeError('x'))).toBe(true)
    expect(isRetryableError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isRetryableError(new DOMException('x', 'TimeoutError'))).toBe(true)
    expect(isRetryableError(new Error('x'))).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError('TypeError')).toBe(false)
  })

  it('isNotFound only matches ApiError 404', () => {
    expect(isNotFound(apiError(404))).toBe(true)
    expect(isNotFound(apiError(500))).toBe(false)
    expect(isNotFound(new Error('404'))).toBe(false)
  })

  it('optional resolves undefined on 404 and rethrows everything else', async () => {
    expect(await optional(Promise.resolve(5))).toBe(5)
    expect(await optional(Promise.reject(apiError(404)))).toBeUndefined()
    await expect(optional(Promise.reject(apiError(500)))).rejects.toMatchObject(
      { status: 500 }
    )
    await expect(optional(Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom'
    )
  })
})
