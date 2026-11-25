import type { ActionInputs } from '../inputs.js'
import type { UmbracoApi } from '../api/umbraco-api.js'
import type { USyncApi } from '../api/usync-api.js'
import type { PublisherApi } from '../api/publisher-api.js'
import type { USyncSettings } from '../types/usync.js'

export type StageStatus = 'success' | 'warning' | 'failed' | 'skipped'

export type StageId =
  | 'connect'
  | 'import'
  | 'report'
  | 'rebuild-cache'
  | 'rebuild-indexes'
  | 'export'
  | 'check-connections'

export interface StageResult {
  id: StageId
  title: string
  status: StageStatus
  summary: string
  data?: unknown
}

export interface SiteInfo {
  umbracoVersion?: string
  usyncVersion?: string
  settings?: USyncSettings
  set: string
}

export interface ArtifactUploader {
  upload(
    name: string,
    filePath: string,
    rootDir: string
  ): Promise<{ id?: number; size?: number }>
}

export interface StageContext {
  inputs: ActionInputs
  umbraco: UmbracoApi
  usync: USyncApi
  publisher: PublisherApi
  /** Mutated by the connect stage. */
  site: SiteInfo
  /** Results of the stages that already ran. */
  results: Partial<Record<StageId, StageResult>>
  artifacts: ArtifactUploader
  tempDir: string
}

export interface StageOutcome {
  status: StageStatus
  summary: string
  data?: unknown
}

export interface Stage {
  id: StageId
  title: string
  /** Overrides `title` when it depends on the inputs. */
  getTitle?(inputs: ActionInputs): string
  enabled(inputs: ActionInputs): boolean
  /** When this stage fails, the remaining stages are not run. */
  abortOnFailure?: boolean
  run(ctx: StageContext): Promise<StageOutcome>
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
