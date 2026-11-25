import * as core from '@actions/core'
import { ApiError, AuthProvider, HttpClient, parseErrorBody } from './http.js'
import type { TokenResponse } from '../types/umbraco.js'

export const TOKEN_PATH = 'umbraco/management/api/v1/security/back-office/token'

const DEFAULT_EXPIRES_IN_SECONDS = 300
const REFRESH_MARGIN_MS = 60000

/**
 * OAuth2 client-credentials tokens for the Umbraco Management API. Caches the
 * token, refreshes it shortly before expiry and shares one in-flight request
 * between concurrent callers.
 */
export class TokenProvider implements AuthProvider {
  private token?: string
  private expiresAt = 0
  private inflight?: Promise<string>

  constructor(
    private readonly http: HttpClient,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly now: () => number = Date.now
  ) {}

  getToken(): Promise<string> {
    if (this.token && this.now() < this.expiresAt) {
      return Promise.resolve(this.token)
    }
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  invalidate(): void {
    this.token = undefined
    this.expiresAt = 0
  }

  private async fetchToken(): Promise<string> {
    let response: TokenResponse | undefined
    try {
      response = await this.http.post<TokenResponse | undefined>(TOKEN_PATH, {
        auth: false,
        retry: 'transient',
        form: {
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret
        }
      })
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 400 || error.status === 401)
      ) {
        const { summary } = parseErrorBody(error.body)
        throw new Error(
          `Umbraco rejected the API user credentials (${summary}). Check client-id / client-secret and that the API user exists on this site.`
        )
      }
      throw error
    }

    if (!response?.access_token) {
      throw new Error('Umbraco token endpoint did not return an access_token')
    }
    core.setSecret(response.access_token)
    const expiresIn = response.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS
    this.token = response.access_token
    this.expiresAt = this.now() + expiresIn * 1000 - REFRESH_MARGIN_MS
    return response.access_token
  }
}
