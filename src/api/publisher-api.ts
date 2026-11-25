import { HttpClient, optional } from './http.js'
import type {
  SyncPublishServerView,
  USyncPublishServerStatus
} from '../types/publisher.js'

const PREFIX = 'umbraco/usync/api/v1/Publisher'

/** uSync Publisher (uSync.Complete) API. 404 means the package is not installed. */
export class PublisherApi {
  constructor(private readonly http: HttpClient) {}

  getAllServers(
    enabledOnly: boolean
  ): Promise<SyncPublishServerView[] | undefined> {
    return optional(
      this.http.get<SyncPublishServerView[]>(`${PREFIX}/GetAllServers`, {
        query: { enabledOnly }
      })
    )
  }

  /** undefined on 404 or an empty body (no current server configured). */
  getCurrentServer(): Promise<SyncPublishServerView | undefined> {
    return optional(
      this.http.get<SyncPublishServerView | undefined>(`${PREFIX}/GetCurrent`)
    )
  }

  checkServer(alias: string): Promise<USyncPublishServerStatus> {
    return this.http.get(`${PREFIX}/CheckServer`, { query: { server: alias } })
  }
}
