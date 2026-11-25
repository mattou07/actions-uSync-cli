import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'

// getInput mirrors the real implementation: env lookup, trim, required check
const core = {
  getInput: jest.fn((name: string, options?: { required?: boolean }) => {
    const value = (
      process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || ''
    ).trim()
    if (options?.required && !value) {
      throw new Error(`Input required and not supplied: ${name}`)
    }
    return value
  }),
  setSecret: jest.fn(),
  notice: jest.fn()
}
jest.unstable_mockModule('@actions/core', () => core)

const { getInputs, parseServerUrl, parseBooleanInput, parseIntegerInput } =
  await import('../src/inputs.js')

function setEnv(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    process.env[`INPUT_${name.toUpperCase()}`] = value
  }
}

function baseEnv(extra: Record<string, string> = {}): void {
  setEnv({
    server: 'https://example.com',
    'client-id': 'umbraco-back-office-test',
    'client-secret': 'shh-secret',
    ...extra
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) delete process.env[key]
  }
})

describe('parseServerUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['  https://example.com/  ', 'https://example.com'],
    ['example.com', 'https://example.com'],
    ['HTTPS://Example.com///', 'https://example.com'],
    ['https://example.com:8443', 'https://example.com:8443'],
    ['https://example.com/site/', 'https://example.com/site'],
    ['example.com/site/sub//', 'https://example.com/site/sub'],
    ['localhost:44391', 'https://localhost:44391']
  ])('normalises %s', (input, expected) => {
    expect(parseServerUrl('server', input)).toBe(expected)
  })

  it.each([
    ['http://localhost:5000', 'http://localhost:5000'],
    ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080'],
    ['http://[::1]:5000', 'http://[::1]:5000'],
    ['http://site.localhost', 'http://site.localhost'],
    [
      'http://deep.site.localhost:5000/dir',
      'http://deep.site.localhost:5000/dir'
    ]
  ])('allows http for local host %s', (input, expected) => {
    expect(parseServerUrl('server', input)).toBe(expected)
  })

  it.each([
    'http://example.com',
    'http://notlocalhost.com',
    'http://localhost.example.com',
    'ftp://example.com'
  ])('rejects non-https %s', (input) => {
    expect(() => parseServerUrl('server', input)).toThrow(/must use https/)
  })

  it('rejects userinfo without echoing it', () => {
    let message = ''
    try {
      parseServerUrl('server', 'https://admin:hunter2@example.com')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/must not contain credentials/)
    expect(message).not.toContain('hunter2')
    expect(() => parseServerUrl('server', 'https://user@example.com')).toThrow(
      /credentials/
    )
  })

  it.each([
    'https://example.com?x=1',
    'https://example.com/path?token=abc',
    'https://example.com#frag',
    'https://example.com/?'
  ])('rejects query string or fragment in %s', (input) => {
    expect(() => parseServerUrl('server', input)).toThrow(
      /query string or fragment/
    )
  })

  it('rejects values that are not URLs', () => {
    expect(() => parseServerUrl('server', 'https://')).toThrow(
      'Invalid value for input "server": not a valid URL'
    )
    expect(() => parseServerUrl('server', '')).toThrow(/not a valid URL/)
  })
})

describe('parseBooleanInput', () => {
  it.each([
    ['true', false, true],
    ['TRUE', false, true],
    [' False ', true, false],
    ['false', true, false]
  ])('parses %j', (value, def, expected) => {
    expect(parseBooleanInput('x', value, def)).toBe(expected)
  })

  it('returns the default for empty input', () => {
    expect(parseBooleanInput('x', '', true)).toBe(true)
    expect(parseBooleanInput('x', '  ', false)).toBe(false)
  })

  it.each(['yes', '1', 'on', 'truee'])('throws for %j', (value) => {
    expect(() => parseBooleanInput('my-flag', value, false)).toThrow(
      `Invalid value for input "my-flag": "${value}" must be true or false`
    )
  })
})

describe('parseIntegerInput', () => {
  it('returns the default for empty or missing input', () => {
    expect(parseIntegerInput('n', '', 7)).toBe(7)
    expect(parseIntegerInput('n', '  ', 7)).toBe(7)
    expect(parseIntegerInput('n', undefined, 7)).toBe(7)
  })

  it('parses whole numbers, honouring min', () => {
    expect(parseIntegerInput('n', ' 15 ', 7)).toBe(15)
    expect(parseIntegerInput('n', '0', 7, 0)).toBe(0)
  })

  it.each(['abc', '1.5', '10m', '--1'])('rejects non-integer %j', (value) => {
    expect(() => parseIntegerInput('n', value, 7)).toThrow(
      /is not a whole number/
    )
  })

  it('rejects values below the minimum (default 1)', () => {
    expect(() => parseIntegerInput('n', '0', 7)).toThrow(
      'Invalid value for input "n": 0 must be at least 1'
    )
    expect(() => parseIntegerInput('n', '-1', 7, 0)).toThrow(/at least 0/)
  })
})

describe('getInputs', () => {
  it('applies the documented defaults', () => {
    baseEnv()

    expect(getInputs()).toEqual({
      server: 'https://example.com',
      clientId: 'umbraco-back-office-test',
      clientSecret: 'shh-secret',
      wait: true,
      waitTimeoutMinutes: 10,
      waitForStartupImport: true,
      import: true,
      force: false,
      set: '',
      group: 'all',
      report: true,
      failOnChanges: false,
      rebuildCache: false,
      rebuildIndexes: [],
      export: false,
      exportClean: false,
      downloadExport: false,
      exportArtifactName: 'usync-export',
      checkConnections: true,
      failOnConnectionError: false,
      timeoutMinutes: 30,
      requestTimeoutSeconds: 60
    })
  })

  it('reads every input', () => {
    baseEnv({
      server: 'my-site.example.com/cms/',
      wait: 'false',
      'wait-timeout-minutes': '3',
      'wait-for-startup-import': 'false',
      import: 'false',
      force: 'true',
      set: ' Custom ',
      group: ' settings ',
      report: 'false',
      'fail-on-changes': 'true',
      'rebuild-cache': 'true',
      'rebuild-indexes': 'ExternalIndex',
      export: 'true',
      'export-clean': 'true',
      'download-export': 'true',
      'export-artifact-name': 'my.export_1-x',
      'check-connections': 'false',
      'fail-on-connection-error': 'true',
      'timeout-minutes': '45',
      'request-timeout-seconds': '20'
    })

    expect(getInputs()).toEqual({
      server: 'https://my-site.example.com/cms',
      clientId: 'umbraco-back-office-test',
      clientSecret: 'shh-secret',
      wait: false,
      waitTimeoutMinutes: 3,
      waitForStartupImport: false,
      import: false,
      force: true,
      set: 'Custom',
      group: 'settings',
      report: false,
      failOnChanges: true,
      rebuildCache: true,
      rebuildIndexes: ['ExternalIndex'],
      export: true,
      exportClean: true,
      downloadExport: true,
      exportArtifactName: 'my.export_1-x',
      checkConnections: false,
      failOnConnectionError: true,
      timeoutMinutes: 45,
      requestTimeoutSeconds: 20
    })
    expect(core.notice).not.toHaveBeenCalled()
  })

  it('masks the client secret as soon as it is read, even if later validation fails', () => {
    baseEnv({ server: 'http://example.com' })

    expect(() => getInputs()).toThrow(/must use https/)
    expect(core.setSecret).toHaveBeenCalledWith('shh-secret')
  })

  it('requires server, client-id and client-secret', () => {
    expect(() => getInputs()).toThrow(
      'Input required and not supplied: client-secret'
    )
    setEnv({ 'client-secret': 's' })
    expect(() => getInputs()).toThrow('Input required and not supplied: server')
    setEnv({ server: 'example.com' })
    expect(() => getInputs()).toThrow(
      'Input required and not supplied: client-id'
    )
  })

  it('requires the Umbraco API user client-id prefix', () => {
    baseEnv({ 'client-id': 'my-client' })

    expect(() => getInputs()).toThrow(
      /client-id.*start with "umbraco-back-office-"/
    )
  })

  it('splits rebuild-indexes on commas and newlines, trims, drops empties and de-duplicates', () => {
    baseEnv({
      'rebuild-indexes':
        'ExternalIndex, InternalIndex\n\n  MemberIndex ,,\r\nExternalIndex'
    })

    expect(getInputs().rebuildIndexes).toEqual([
      'ExternalIndex',
      'InternalIndex',
      'MemberIndex'
    ])
  })

  it('turns the export stage on (with a notice) when download-export is set', () => {
    baseEnv({ 'download-export': 'true', export: 'false' })

    const inputs = getInputs()

    expect(inputs.export).toBe(true)
    expect(inputs.downloadExport).toBe(true)
    expect(core.notice).toHaveBeenCalledTimes(1)
    expect(core.notice).toHaveBeenCalledWith(
      expect.stringContaining('download-export')
    )
  })

  it('does not add a notice when export is already on', () => {
    baseEnv({ 'download-export': 'true', export: 'true' })

    getInputs()

    expect(core.notice).not.toHaveBeenCalled()
  })

  it.each(['has space', 'a/b', '../x', 'name!', 'ünï'])(
    'rejects export-artifact-name %j',
    (name) => {
      baseEnv({ 'export-artifact-name': name })

      expect(() => getInputs()).toThrow(/export-artifact-name/)
    }
  )

  const allOff = {
    wait: 'false',
    import: 'false',
    report: 'false',
    'rebuild-cache': 'false',
    export: 'false',
    'check-connections': 'false'
  }

  it('throws when every stage is turned off', () => {
    baseEnv(allOff)

    expect(() => getInputs()).toThrow(
      'Nothing to do: every stage is turned off'
    )
  })

  it.each([
    ['wait', 'true'],
    ['import', 'true'],
    ['report', 'true'],
    ['rebuild-cache', 'true'],
    ['rebuild-indexes', 'MyIndex'],
    ['export', 'true'],
    ['download-export', 'true'],
    ['check-connections', 'true']
  ])('is happy when only %s is on', (name, value) => {
    baseEnv({ ...allOff, [name]: value })

    expect(() => getInputs()).not.toThrow()
  })

  it('propagates invalid booleans and integers with the input name', () => {
    baseEnv({ force: 'maybe' })
    expect(() => getInputs()).toThrow(/"force"/)

    delete process.env.INPUT_FORCE
    setEnv({ 'timeout-minutes': '0' })
    expect(() => getInputs()).toThrow(/"timeout-minutes".*at least 1/)
  })
})
