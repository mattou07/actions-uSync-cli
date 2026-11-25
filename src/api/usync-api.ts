import { HttpClient, optional } from './http.js'
import type {
  PerformActionRequest,
  PerformActionResponse,
  StartupStatusResponse,
  SyncLegacyCheckResponse,
  SyncOperationStatusResponse,
  SyncRunningOperationResponse,
  SyncSelectableSet,
  USyncAddonInfo,
  USyncSettings
} from '../types/usync.js'

const PREFIX = 'umbraco/usync/api/v1'

/**
 * uSync backoffice API. Endpoints added in later uSync versions resolve to
 * undefined on 404 so older sites degrade gracefully.
 */
export class USyncApi {
  constructor(private readonly http: HttpClient) {}

  /** Only 429 is retried: re-sending a step that may have run is not safe. */
  perform(request: PerformActionRequest): Promise<PerformActionResponse> {
    return this.http.post(`${PREFIX}/Perform`, {
      json: request,
      retry: 'rate-limit-only'
    })
  }

  getOperationStatus(
    operationId: string
  ): Promise<SyncOperationStatusResponse | undefined> {
    return optional(
      this.http.get<SyncOperationStatusResponse>(`${PREFIX}/Status`, {
        query: { operationId }
      })
    )
  }

  getRunning(): Promise<SyncRunningOperationResponse | undefined> {
    return optional(
      this.http.get<SyncRunningOperationResponse>(`${PREFIX}/Running`)
    )
  }

  getStartupStatus(): Promise<StartupStatusResponse | undefined> {
    return optional(
      this.http.get<StartupStatusResponse>(`${PREFIX}/StartupStatus`)
    )
  }

  getSettings(): Promise<USyncSettings> {
    return this.http.get(`${PREFIX}/Settings`)
  }

  getSets(): Promise<SyncSelectableSet[] | undefined> {
    return optional(this.http.get<SyncSelectableSet[]>(`${PREFIX}/Sets`))
  }

  async getVersion(): Promise<string | undefined> {
    const info = await optional(
      this.http.get<USyncAddonInfo | undefined>(`${PREFIX}/AddOns`)
    )
    return info?.version
  }

  checkLegacy(): Promise<SyncLegacyCheckResponse | undefined> {
    return optional(
      this.http.get<SyncLegacyCheckResponse>(`${PREFIX}/CheckLegacy`)
    )
  }

  download(): Promise<Buffer> {
    return this.http.post(`${PREFIX}/Download`, { responseType: 'binary' })
  }
}
