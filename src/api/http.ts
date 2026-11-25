import * as core from '@actions/core'
import { sleep } from '../utils/sleep.js'
import { redactSecrets } from '../utils/redact.js'

/*
 * Structure decides, text enriches: control flow depends on HTTP status codes
 * and error names only, never on message wording.
 *
 * This client is the security boundary: the Authorization header, tokens and
 * client secrets never appear in log lines, error messages or ApiError.body.
 */

export interface AuthProvider {
  getToken(): Promise<string>
  invalidate(): void
}

/** transient = 429, 502, 503, 504 and network/timeout errors; rate-limit-only = 429 only */
export type RetryPolicy = 'transient' | 'rate-limit-only' | 'none'

export interface HttpClientOptions {
  /** Per attempt (default 60000) */
  requestTimeoutMs?: number
  /** Extra attempts after the first (default 3) */
  maxRetries?: number
  /** Exponential: base * 2^(attempt-1) (default 2000) */
  retryBaseDelayMs?: number
}

export interface RequestOptions {
  /** `undefined` values are omitted */
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  form?: Record<string, string>
  /** Default true: sends `Authorization: Bearer <token>` */
  auth?: boolean
  /** Default 'transient' */
  retry?: RetryPolicy
  /** Default 'json'. json: empty body -> undefined; binary -> Buffer */
  responseType?: 'json' | 'binary' | 'none'
}

const DEFAULT_TIMEOUT_MS = 60000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 2000
const MAX_ERROR_BODY_BYTES = 64 * 1024
const MAX_ERROR_SUMMARY_LENGTH = 500
const RETRYABLE_STATUSES = [429, 502, 503, 504]

export interface ParsedErrorBody {
  summary: string
  problemType?: string
  title?: string
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function flattenErrors(errors: unknown): string | undefined {
  if (!errors || typeof errors !== 'object') return undefined
  const parts: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.trim()) parts.push(value)
    } else if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit)
    }
  }
  visit(errors)
  return parts.length ? parts.join('; ') : undefined
}

/** OpenIddict style `{error, error_description}` */
function oauthSummary(parsed: Record<string, unknown>): string | undefined {
  const code = nonEmptyString(parsed.error)
  const description = nonEmptyString(parsed.error_description)
  if (code && description) return `${code}: ${description}`
  return description ?? code
}

/**
 * Turns an error body into a single-line summary. Handles RFC problem details
 * `{type, title, status, detail, errors}`, `{message}` and OpenIddict
 * `{error, error_description}`, falling back to the raw text.
 */
export function parseErrorBody(body: string): ParsedErrorBody {
  let summary: string | undefined
  let problemType: string | undefined
  let title: string | undefined

  const trimmed = body.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      problemType = nonEmptyString(parsed.type)
      title = nonEmptyString(parsed.title)
      summary =
        nonEmptyString(parsed.detail) ??
        nonEmptyString(parsed.message) ??
        oauthSummary(parsed) ??
        flattenErrors(parsed.errors) ??
        title
      // A non-URL type is a machine-readable code worth keeping in the text
      if (summary && problemType && !/^https?:\/\//i.test(problemType)) {
        summary = `${problemType}: ${summary}`
      }
    } catch {
      // not JSON: fall back to the raw text
    }
  }

  let single = collapseWhitespace(summary ?? trimmed)
  if (single.length > MAX_ERROR_SUMMARY_LENGTH) {
    single = `${single.slice(0, MAX_ERROR_SUMMARY_LENGTH)}…`
  }
  return { summary: single || '(empty response body)', problemType, title }
}

/** Error thrown for non-2xx responses. Carries the status so callers can decide. */
export class ApiError extends Error {
  readonly status: number
  readonly method: string
  readonly path: string
  /** Capped at 64 KB and redacted */
  readonly body: string
  readonly retryAfterSeconds?: number
  readonly problemType?: string
  readonly title?: string

  constructor(
    message: string,
    status: number,
    method: string,
    path: string,
    body: string,
    retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.method = method
    this.path = path
    this.body = body
    this.retryAfterSeconds = retryAfterSeconds
    const parsed = parseErrorBody(body)
    this.problemType = parsed.problemType
    this.title = parsed.title
  }
}

/** 429/502/503/504 responses, plus network (TypeError) and timeout/abort errors. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return RETRYABLE_STATUSES.includes(error.status)
  }
  // Go by `name` only: a DOMException is not always `instanceof Error`.
  const name = (error as { name?: unknown } | null | undefined)?.name
  return (
    name === 'AbortError' || name === 'TimeoutError' || name === 'TypeError'
  )
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/** Resolves undefined when the endpoint does not exist (404); rethrows anything else. */
export async function optional<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

function parseRetryAfter(response: Response, body: string): number | undefined {
  const header = response.headers.get('retry-after')
  if (header && /^\d+$/.test(header.trim())) {
    return parseInt(header, 10)
  }
  const match = body.match(/Try again in (\d+) seconds/i)
  return match ? parseInt(match[1], 10) : undefined
}

/** Reads at most `maxBytes` of a response body, cancelling the rest. */
async function readTextCapped(
  response: Response,
  maxBytes: number
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = maxBytes - received
    if (value.byteLength >= remaining) {
      text += decoder.decode(value.subarray(0, remaining))
      await reader.cancel()
      return text
    }
    received += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

export class HttpClient {
  readonly baseUrl: string
  private readonly requestTimeoutMs: number
  private readonly maxRetries: number
  private readonly retryBaseDelayMs: number
  private authProvider?: AuthProvider

  constructor(baseUrl: string, options: HttpClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.requestTimeoutMs = Math.max(
      1,
      options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    )
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES)
    this.retryBaseDelayMs = Math.max(
      0,
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    )
  }

  setAuth(provider: AuthProvider): void {
    this.authProvider = provider
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options)
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, options)
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const auth = options.auth ?? true
    const policy = options.retry ?? 'transient'
    let retries = 0
    let refreshed = false

    for (;;) {
      try {
        return await this.attempt<T>(method, path, options, auth)
      } catch (error) {
        // An expired or revoked token: fetch a fresh one and try once more.
        // This does not count against maxRetries.
        if (
          auth &&
          !refreshed &&
          error instanceof ApiError &&
          error.status === 401 &&
          this.authProvider
        ) {
          refreshed = true
          this.authProvider.invalidate()
          core.info(
            `${method} ${path} was rejected (401); requesting a new token`
          )
          continue
        }

        if (!this.shouldRetry(error, policy) || retries >= this.maxRetries) {
          throw error
        }
        retries++
        const delay =
          error instanceof ApiError && error.retryAfterSeconds !== undefined
            ? error.retryAfterSeconds * 1000 + 1000
            : this.retryBaseDelayMs * Math.pow(2, retries - 1)
        const reason =
          error instanceof ApiError
            ? `HTTP ${error.status}`
            : (error as { name?: string }).name
        core.info(
          `${method} ${path} failed (${reason}); retry ${retries}/${this.maxRetries} in ${Math.round(delay / 1000)}s...`
        )
        await sleep(delay)
      }
    }
  }

  private shouldRetry(error: unknown, policy: RetryPolicy): boolean {
    if (policy === 'none') return false
    if (policy === 'rate-limit-only') {
      return error instanceof ApiError && error.status === 429
    }
    return isRetryableError(error)
  }

  private buildUrl(path: string, query: RequestOptions['query']): string {
    let url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`
    if (query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.append(key, String(value))
      }
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }
    return url
  }

  private async attempt<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions,
    auth: boolean
  ): Promise<T> {
    const responseType = options.responseType ?? 'json'
    const headers: Record<string, string> = {}
    if (responseType === 'json') headers.Accept = 'application/json'

    if (auth) {
      if (!this.authProvider) {
        throw new Error(
          'No auth provider configured for an authenticated request'
        )
      }
      headers.Authorization = `Bearer ${await this.authProvider.getToken()}`
    }

    let body: string | undefined
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.json)
    } else if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(options.form).toString()
    }

    const response = await fetch(this.buildUrl(path, options.query), {
      method,
      headers,
      body,
      // Only ever talk to the configured server: never follow a redirect
      // (it could carry the bearer token or client secret elsewhere).
      redirect: 'error',
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    })

    if (!response.ok) {
      const text = redactSecrets(
        await readTextCapped(response, MAX_ERROR_BODY_BYTES)
      )
      const { summary } = parseErrorBody(text)
      const statusText = response.statusText ? ` ${response.statusText}` : ''
      throw new ApiError(
        `${method} ${path} failed: ${response.status}${statusText} - ${summary}`,
        response.status,
        method,
        path,
        text,
        parseRetryAfter(response, text)
      )
    }

    if (responseType === 'binary') {
      return Buffer.from(await response.arrayBuffer()) as T
    }
    if (responseType === 'none') {
      await response.body?.cancel()
      return undefined as T
    }

    const text = await response.text()
    if (!text.trim()) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(
        `${method} ${path} returned a response that is not valid JSON`
      )
    }
  }
}
