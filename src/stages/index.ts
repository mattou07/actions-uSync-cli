import { checkConnectionsStage } from './check-connections.js'
import { connectStage } from './connect.js'
import { exportStage } from './export.js'
import { importStage } from './import.js'
import { rebuildCacheStage } from './rebuild-cache.js'
import { rebuildIndexesStage } from './rebuild-indexes.js'
import { preReportStage } from './pre-report.js'
import { reportStage } from './report.js'
import type { Stage } from './types.js'

/** The fixed pipeline order. */
export const STAGES: Stage[] = [
  connectStage,
  preReportStage,
  importStage,
  reportStage,
  rebuildCacheStage,
  rebuildIndexesStage,
  exportStage,
  checkConnectionsStage
]
