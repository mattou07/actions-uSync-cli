import * as core from '@actions/core'

export interface ActionInputs {
  /** Normalised base URL, no trailing slash */
  server: string
  clientId: string
  clientSecret: string
  wait: boolean
  waitTimeoutMinutes: number
  waitForStartupImport: boolean
  import: boolean
  force: boolean
  /** '' = the site's default set */
  set: string
  group: string
  report: boolean
  failOnChanges: boolean
  rebuildCache: boolean
  rebuildIndexes: string[]
  export: boolean
  exportClean: boolean
  downloadExport: boolean
  exportArtifactName: string
  checkConnections: boolean
  failOnConnectionError: boolean
  /** Per long operation (perform, background poll, cache rebuild) */
  timeoutMinutes: number
  requestTimeoutSeconds: number
}

const CLIENT_ID_PREFIX = 'umbraco-back-office-'

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  )
}

/**
 * Normalises the `server` input: prepends https:// when no scheme is given,
 * requires https (except for localhost), rejects credentials, query strings and
 * fragments, and strips trailing slashes. A path (virtual directory) is kept.
 * The value is never echoed in errors because it could contain credentials.
 */
export function parseServerUrl(name: string, value: string): string {
  const trimmed = value.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(`Invalid value for input "${name}": not a valid URL`)
  }

  if (url.username || url.password) {
    throw new Error(
      `Invalid value for input "${name}": the URL must not contain credentials (user:password@)`
    )
  }
  if (withScheme.includes('?') || withScheme.includes('#')) {
    throw new Error(
      `Invalid value for input "${name}": the URL must not contain a query string or fragment`
    )
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isLocalHost(url.hostname))
  ) {
    throw new Error(
      `Invalid value for input "${name}": the URL must use https so credentials are not sent in clear text (http is only allowed for localhost)`
    )
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/** '' -> default; `true`/`false` (any case); anything else throws. */
export function parseBooleanInput(
  name: string,
  value: string,
  defaultValue: boolean
): boolean {
  const normalised = value.trim().toLowerCase()
  if (!normalised) return defaultValue
  if (normalised === 'true') return true
  if (normalised === 'false') return false
  throw new Error(
    `Invalid value for input "${name}": "${value}" must be true or false`
  )
}

/**
 * Parses an integer input, falling back to a default when empty. Throws when
 * the value is not a whole number at or above `min`, so a typo fails the run
 * immediately instead of producing NaN-driven behaviour later.
 */
export function parseIntegerInput(
  name: string,
  value: string | undefined,
  defaultValue: number,
  min = 1
): number {
  const trimmed = value?.trim()
  if (!trimmed) return defaultValue

  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid value for input "${name}": "${value}" is not a whole number`
    )
  }

  const parsed = parseInt(trimmed, 10)
  if (parsed < min) {
    throw new Error(
      `Invalid value for input "${name}": ${parsed} must be at least ${min}`
    )
  }
  return parsed
}

function parseList(value: string): string[] {
  const items = value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(items)]
}

export function getInputs(): ActionInputs {
  const flag = (name: string, defaultValue: boolean): boolean =>
    parseBooleanInput(name, core.getInput(name), defaultValue)

  const clientSecret = core.getInput('client-secret', { required: true })
  core.setSecret(clientSecret)

  const server = parseServerUrl(
    'server',
    core.getInput('server', { required: true })
  )
  const clientId = core.getInput('client-id', { required: true }).trim()
  if (!clientId.startsWith(CLIENT_ID_PREFIX)) {
    throw new Error(
      `Invalid value for input "client-id": Umbraco API user client ids start with "${CLIENT_ID_PREFIX}"`
    )
  }

  const wait = flag('wait', true)
  const waitTimeoutMinutes = parseIntegerInput(
    'wait-timeout-minutes',
    core.getInput('wait-timeout-minutes'),
    10
  )
  const waitForStartupImport = flag('wait-for-startup-import', true)
  const importStage = flag('import', true)
  const force = flag('force', false)
  const set = core.getInput('set').trim()
  const group = core.getInput('group').trim() || 'all'
  const report = flag('report', true)
  const failOnChanges = flag('fail-on-changes', false)
  const rebuildCache = flag('rebuild-cache', false)
  const rebuildIndexes = parseList(core.getInput('rebuild-indexes'))
  let exportStage = flag('export', false)
  const exportClean = flag('export-clean', false)
  const downloadExport = flag('download-export', false)
  const exportArtifactName =
    core.getInput('export-artifact-name').trim() || 'usync-export'
  const checkConnections = flag('check-connections', true)
  const failOnConnectionError = flag('fail-on-connection-error', false)
  const timeoutMinutes = parseIntegerInput(
    'timeout-minutes',
    core.getInput('timeout-minutes'),
    30
  )
  const requestTimeoutSeconds = parseIntegerInput(
    'request-timeout-seconds',
    core.getInput('request-timeout-seconds'),
    60
  )

  if (downloadExport && !exportStage) {
    exportStage = true
    core.notice('download-export is true, so the export stage is turned on')
  }

  if (!/^[A-Za-z0-9._-]+$/.test(exportArtifactName)) {
    throw new Error(
      'Invalid value for input "export-artifact-name": use only letters, numbers, ".", "_" and "-"'
    )
  }

  if (
    !wait &&
    !importStage &&
    !report &&
    !rebuildCache &&
    rebuildIndexes.length === 0 &&
    !exportStage &&
    !checkConnections
  ) {
    throw new Error(
      'Nothing to do: every stage is turned off (wait, import, report, rebuild-cache, rebuild-indexes, export, check-connections)'
    )
  }

  return {
    server,
    clientId,
    clientSecret,
    wait,
    waitTimeoutMinutes,
    waitForStartupImport,
    import: importStage,
    force,
    set,
    group,
    report,
    failOnChanges,
    rebuildCache,
    rebuildIndexes,
    export: exportStage,
    exportClean,
    downloadExport,
    exportArtifactName,
    checkConnections,
    failOnConnectionError,
    timeoutMinutes,
    requestTimeoutSeconds
  }
}
