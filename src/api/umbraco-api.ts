import { HttpClient } from './http.js'
import type {
  PublishedCacheRebuildStatusResponse,
  ServerInformationResponse,
  ServerStatusResponse
} from '../types/umbraco.js'

const PREFIX = 'umbraco/management/api/v1'

/** Umbraco Management API calls the action needs. */
export class UmbracoApi {
  constructor(private readonly http: HttpClient) {}

  /** Anonymous and never retried: callers poll it themselves while the site boots. */
  getServerStatus(): Promise<ServerStatusResponse> {
    return this.http.get(`${PREFIX}/server/status`, {
      auth: false,
      retry: 'none'
    })
  }

  getServerInformation(): Promise<ServerInformationResponse> {
    return this.http.get(`${PREFIX}/server/information`)
  }

  async rebuildIndex(name: string): Promise<void> {
    await this.http.post(
      `${PREFIX}/indexer/${encodeURIComponent(name)}/rebuild`,
      { responseType: 'none' }
    )
  }

  async rebuildPublishedCache(): Promise<void> {
    await this.http.post(`${PREFIX}/published-cache/rebuild`, {
      responseType: 'none'
    })
  }

  getPublishedCacheRebuildStatus(): Promise<PublishedCacheRebuildStatusResponse> {
    return this.http.get(`${PREFIX}/published-cache/rebuild/status`)
  }
}
