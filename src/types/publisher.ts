/*
 * uSync Publisher (uSync.Complete) backoffice API shapes
 * (/umbraco/usync/api/v1/Publisher/*), taken from the generated client in
 * uSync.Publisher.Client 17.6 (types.gen.ts).
 */

/**
 * SyncServerStatus. 'Success' is the only healthy value. Kept as a string so
 * values added in newer versions still parse (and count as not healthy).
 */
export type SyncServerStatus = string

export const SERVER_STATUS_SUCCESS = 'Success'

/** GET Publisher/CheckServer?server={alias} */
export interface USyncPublishServerStatus {
  enabled: boolean
  status: SyncServerStatus
  message?: string | null
}

/** GET Publisher/GetAllServers and Publisher/GetCurrent (fields we use). */
export interface SyncPublishServerView {
  key: string
  id?: string
  alias: string
  enabled: boolean
  pullEnabled?: boolean
  name: string
  description?: string | null
  url: string
  baseUrl?: string | null
  sortOrder?: number
}
