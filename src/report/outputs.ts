import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import type { CheckConnectionsData } from '../stages/check-connections.js'
import type { ConnectData } from '../stages/connect.js'
import type { PerformData } from '../stages/import.js'
import type { StageId, StageResult } from '../stages/types.js'

const RESULTS_FILE_NAME = 'usync-results.json'

function dataOf<T>(results: StageResult[], id: StageId): T | undefined {
  return results.find((r) => r.id === id)?.data as T | undefined
}

/** '' when the stage produced no data (skipped or failed before finishing). */
function count(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

export function setOutputs(results: StageResult[], resultsFile: string): void {
  const connect = dataOf<ConnectData>(results, 'connect')
  const imported = dataOf<PerformData>(results, 'import')
  const report = dataOf<PerformData>(results, 'report')
  const exported = dataOf<PerformData>(results, 'export')
  const connections = dataOf<CheckConnectionsData>(results, 'check-connections')

  const analyses = [imported, report, exported].filter(
    (d): d is PerformData => d !== undefined
  )
  const warnings =
    analyses.length === 0
      ? undefined
      : analyses.reduce((sum, d) => sum + d.analysis.warnings.length, 0)

  core.setOutput('success', String(!results.some((r) => r.status === 'failed')))
  core.setOutput(
    'stages',
    JSON.stringify(
      results.map(({ id, status, summary }) => ({ id, status, summary }))
    )
  )
  core.setOutput('imported-changes', count(imported?.analysis.changes.length))
  core.setOutput('import-errors', count(imported?.analysis.errors.length))
  core.setOutput('pending-changes', count(report?.analysis.changes.length))
  core.setOutput('warnings', count(warnings))
  core.setOutput('umbraco-version', connect?.umbracoVersion ?? '')
  core.setOutput('usync-version', connect?.usyncVersion ?? '')
  core.setOutput('export-artifact', exported?.artifactName ?? '')
  core.setOutput(
    'connections',
    connections
      ? JSON.stringify(
          connections.servers.map(({ alias, name, url, status }) => ({
            alias,
            name,
            url,
            status
          }))
        )
      : ''
  )
  core.setOutput(
    'connection-errors',
    count(connections?.servers.filter((s) => !s.healthy).length)
  )
  core.setOutput('results-file', resultsFile)
}

/** Writes the full stage results as JSON and returns the file path. */
export async function writeResultsFile(
  results: StageResult[],
  tempDir: string
): Promise<string> {
  const file = path.join(tempDir, RESULTS_FILE_NAME)
  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(file, JSON.stringify(results, null, 2), 'utf8')
  return file
}
