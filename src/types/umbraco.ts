/*
 * Umbraco CMS Management API shapes (/umbraco/management/api/v1/*), taken from
 * the generated backoffice client in Umbraco.Cms.StaticAssets 17.8.
 */

export type RuntimeLevel =
  | 'Unknown'
  | 'Boot'
  | 'Install'
  | 'Upgrade'
  | 'Upgrading'
  | 'Run'
  | 'BootFailed'

/** GET server/status (anonymous). */
export interface ServerStatusResponse {
  serverStatus: RuntimeLevel
}

/** GET server/information. */
export interface ServerInformationResponse {
  version: string
  assemblyVersion?: string
  baseUtcOffset?: string
  runtimeMode?: string
}

/** GET published-cache/rebuild/status. */
export interface PublishedCacheRebuildStatusResponse {
  isRebuilding: boolean
}

/** POST security/back-office/token (OpenIddict client_credentials). */
export interface TokenResponse {
  access_token: string
  token_type?: string
  expires_in?: number
}
