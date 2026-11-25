/*
 * uSync Management API shapes (uSync core, /umbraco/usync/api/v1/*).
 * Taken from the generated backoffice client in uSync.Backoffice.Management.Client
 * 17.5 (types.gen.ts). Only the fields this action reads are required; the
 * rest are optional so older or newer uSync versions still parse.
 */

export type PerformAction = 'Import' | 'Report' | 'Export'

export type ChangeType =
  | 'NoChange'
  | 'Create'
  | 'Import'
  | 'Export'
  | 'Update'
  | 'Delete'
  | 'WillChange'
  | 'Information'
  | 'Rolledback'
  | 'Fail'
  | 'ImportFail'
  | 'Mismatch'
  | 'ParentMissing'
  | 'Hidden'
  | 'Clean'
  | 'Removed'

export type ChangeDetailType =
  'NoChange' | 'Create' | 'Update' | 'Delete' | 'Error' | 'Warning'

export interface USyncOptions {
  clientId: string
  force: boolean
  clean: boolean
  files: boolean
  group: string
  set: string
}

export interface PerformActionRequest {
  requestId: string
  action: PerformAction
  stepNumber: number
  options: USyncOptions
}

export interface USyncChange {
  success: boolean
  name: string
  path: string
  oldValue?: string | null
  newValue?: string | null
  change: ChangeDetailType
}

export interface USyncActionView {
  key: string
  name: string
  handler: string
  itemType: string
  change: ChangeType
  success: boolean
  details?: USyncChange[] | null
  message?: string | null
}

export type HandlerStatus = 'Pending' | 'Processing' | 'Complete' | 'Error'

export interface SyncHandlerSummary {
  icon?: string
  name: string
  status: HandlerStatus
  changes: number
  inError: boolean
}

export interface PerformActionResponse {
  requestId: string
  status?: SyncHandlerSummary[] | null
  actions?: USyncActionView[] | null
  complete: boolean
  inBackground?: boolean
  operationId?: string | null
  message?: string | null
}

/** GET /Status?operationId= (uSync 17.x background processing). */
export interface SyncOperationStatusResponse {
  operationId: string
  requestId?: string | null
  action?: string | null
  /** Enqueued | Running | Success | Failed | Stale | NotFound */
  operationStatus: string
  complete: boolean
  status?: SyncHandlerSummary[] | null
  actions?: USyncActionView[] | null
  message?: string | null
}

/** GET /Running: all fields null when nothing is running. */
export interface SyncRunningOperationResponse {
  operationId?: string | null
  requestId?: string | null
  action?: string | null
}

/** GET /StartupStatus (uSync 17.6.3+). */
export interface StartupStatusResponse {
  /** None | NotConfigured | Blocked | Running | Completed | CompletedWithErrors | Failed */
  state: string
  startedUtc?: string | null
  completedUtc?: string | null
  itemsProcessed?: number
  changes?: number
  errors?: number
  isStale?: boolean
}

export interface USyncSettings {
  rootFolder?: string
  folders?: string[]
  defaultSet?: string
  importAtStartup?: string
  exportOnSave?: string
  importOnFirstBoot?: boolean
  firstBootGroup?: string
  /** Normal | Background */
  processingMode?: string
  backgroundStartup?: boolean
  rebuildCacheOnCompletion?: boolean
  enableHistory?: boolean
  [key: string]: unknown
}

export interface USyncAddonInfo {
  version: string
}

export interface USyncHandlerSetSettings {
  enabled: boolean
  handlerGroups: string[]
  disabledHandlers: string[]
  [key: string]: unknown
}

export interface SyncSelectableSet {
  name: string
  settings: USyncHandlerSetSettings
}

export interface SyncLegacyCheckResponse {
  hasLegacy: boolean
  legacyFolder?: string | null
  legacyTypes?: string[] | null
  latestFolder?: string | null
  latestVersion?: string | null
}
