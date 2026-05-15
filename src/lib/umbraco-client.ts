import { normalizeServerUrl } from './auth'

/**
 * Thin authenticated HTTP wrapper for the Umbraco Management API.
 * Sets the Authorization header on every request and throws a descriptive
 * error for any non-2xx response.
 *
 * Reference: UmbracoClient.Generated.cs (pattern, not the generated code)
 */
export class UmbracoClient {
  private readonly base: string

  constructor(
    server: string,
    private readonly token: string
  ) {
    this.base = normalizeServerUrl(server)
  }

  /**
   * POST and throw on any non-2xx response.
   */
  async post(path: string, body?: unknown): Promise<Response> {
    const response = await this.postRaw(path, body)
    if (!response.ok) {
      const url = `${this.base}/${path.replace(/^\//, '')}`
      throw new Error(
        `POST ${url} failed: ${response.status} ${response.statusText}`
      )
    }
    return response
  }

  /**
   * POST and return the raw Response without throwing — callers handle status.
   */
  async postRaw(path: string, body?: unknown): Promise<Response> {
    const url = `${this.base}/${path.replace(/^\//, '')}`
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : ''
    })
  }

  async get(path: string): Promise<Response> {
    const url = `${this.base}/${path.replace(/^\//, '')}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` }
    })

    if (!response.ok) {
      throw new Error(
        `GET ${url} failed: ${response.status} ${response.statusText}`
      )
    }

    return response
  }
}
