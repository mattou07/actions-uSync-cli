import { getAccessToken, normalizeServerUrl } from '../src/lib/auth'

describe('normalizeServerUrl', () => {
  it('leaves a well-formed https URL unchanged (minus trailing slash)', () => {
    expect(normalizeServerUrl('https://example.com')).toBe(
      'https://example.com'
    )
  })

  it('prepends https:// when no protocol is supplied', () => {
    expect(normalizeServerUrl('example.com')).toBe('https://example.com')
  })

  it('prepends https:// for bare Azure hostnames', () => {
    expect(normalizeServerUrl('wa-usync-cli-internal.azurewebsites.net')).toBe(
      'https://wa-usync-cli-internal.azurewebsites.net'
    )
  })

  it('strips trailing slashes after normalisation', () => {
    expect(normalizeServerUrl('example.com/')).toBe('https://example.com')
    expect(normalizeServerUrl('https://example.com/')).toBe(
      'https://example.com'
    )
  })

  it('preserves an explicit http:// protocol', () => {
    expect(normalizeServerUrl('http://example.com')).toBe('http://example.com')
  })

  it('throws for a value that cannot form a valid URL', () => {
    expect(() => normalizeServerUrl('not a url!!')).toThrow(
      'Invalid server URL'
    )
  })
})

describe('getAccessToken', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('returns the access token on a successful response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'test-token', token_type: 'Bearer' })
    })

    const token = await getAccessToken(
      'https://example.com',
      'my-client-id',
      'my-secret'
    )

    expect(token).toBe('test-token')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/umbraco/management/api/v1/security/back-office/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('grant_type=client_credentials')
      })
    )
  })

  it('includes client_id and client_secret in the request body', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok' })
    })

    await getAccessToken('https://example.com', 'my-client-id', 'my-secret')

    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string
    expect(body).toContain('client_id=my-client-id')
    expect(body).toContain('client_secret=my-secret')
  })

  it('normalises a bare hostname by prepending https:// before fetching', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok' })
    })

    await getAccessToken('example.com', 'id', 'secret')

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toBe(
      'https://example.com/umbraco/management/api/v1/security/back-office/token'
    )
  })

  it('throws an error when the response is not ok', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    })

    await expect(
      getAccessToken('https://example.com', 'id', 'secret')
    ).rejects.toThrow('Failed to obtain access token: 401 Unauthorized')
  })
})
